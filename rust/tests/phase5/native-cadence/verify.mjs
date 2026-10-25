import assert from 'node:assert/strict';
import {readFile,readdir,writeFile,open} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {CADENCE} from './policy.mjs';
import {LogOracle} from '../soak-oracle.mjs';
import {verifyTransition} from '../separated/transitions.mjs';
import {validateShutdown,assertProcessIdentity,sha256} from '../separated/runtime.mjs';
import {compareIdentity} from '../separated/contract.mjs';

const only=(rows,label)=>{assert.equal(rows.length,1,label);return rows[0];};
const same=assert.deepEqual;
const binding=s=>({session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream});
const withoutEvent=v=>{const {type,t,seq,utc,owner,scope,...rest}=v;return rest;};

function nativeEvidence(e,starts){
 const {events,summary:s,nativeFiles:f}=e,origin=s.clockOrigin;
 const requests=events.filter(v=>v.type==='native_request'),results=events.filter(v=>v.type==='native'),abandoned=events.filter(v=>v.type==='native_abandoned');
 same(f.requests.length,requests.length,'native_request_count');same(f.results.length,results.length,'native_result_count');assert.ok(abandoned.length<=1,'abandoned_count');
 for(const kind of ['requests','starts','responses','acceptances','results'])assert.equal(new Set(f[kind].map(v=>(v.request??v).id)).size,f[kind].length,'duplicate_native_file');
 const actions=['select','resize','reclaim','choose_connection','handoff'];let previous=origin;
 for(let i=0;i<requests.length;i++){
  const ev=requests[i],q=ev.request;assert.equal(q.owner,s.owner);assert.ok(q.issuedAt>=previous&&q.issuedAt<=origin+ev.t,'native_issue_order');
  const expected=i===0?{action:'window_mode',round:-1}:{action:actions[(i-1)%5],round:Math.floor((i-1)/5)};
  assert.equal(q.action,expected.action,'native_action_order');assert.equal(q.round,expected.round,'native_round');
  const start=q.round<0?null:only(starts.filter(v=>v.round===q.round),'native_round_start');
  assert.equal(q.expiresAt,start?.deadline??origin+900000,'native_deadline');
  if(start)assert.equal(q.session,start.binding.session,'native_target_session');else assert.equal(q.windowMode,'restored');
  same(only(f.requests.filter(v=>v.id===q.id),'native_request_file'),q);
  const outcome=only([...results,...abandoned].filter(v=>v.request.id===q.id),'native_outcome');
  const active=outcome.request,{inputStartedAt,inputDeadline,responseReceivedAt,verifyDeadline,...issued}=active;same(issued,q,'native_issued_changed');
  if(inputStartedAt!==undefined){same(only(f.starts.filter(v=>v.id===q.id),'native_start'),{id:q.id,owner:s.owner});assert.ok(inputStartedAt>=q.issuedAt&&inputStartedAt<=q.expiresAt);assert.equal(inputDeadline,Math.min(inputStartedAt+120000,q.expiresAt));}
  if(responseReceivedAt!==undefined){
   assert.ok(responseReceivedAt>=inputStartedAt&&responseReceivedAt<=inputDeadline);assert.equal(verifyDeadline,Math.min(responseReceivedAt+45000,q.expiresAt));
   const acceptance={id:q.id,owner:s.owner,responseReceivedAt,verifyDeadline};same(only(f.acceptances.filter(v=>v.id===q.id),'native_acceptance'),acceptance);
   const received=only(events.filter(v=>v.type==='native_received'&&v.id===q.id),'native_received');for(const [k,v] of Object.entries(acceptance))assert.equal(received[k],v);
   assert.ok(received.seq>ev.seq&&received.seq<outcome.seq);
  }
  if(outcome.type==='native'){
   assert.ok(responseReceivedAt!==undefined,'native_not_accepted');const {response,observation,verifiedAt}=outcome;
   same(only(f.responses.filter(v=>v.id===q.id),'native_response'),response);
   same(only(f.results.filter(v=>v.request.id===q.id),'native_result'),{request:active,response,observation,verifiedAt});
   assert.equal(response.id,q.id);assert.equal(response.owner,s.owner);assert.equal(response.status,'performed');assert.ok(response.observation?.screenshotId);assert.equal(observation.verified,true);
   assert.ok(verifiedAt>=responseReceivedAt&&verifiedAt<=verifyDeadline&&verifiedAt<=origin+outcome.t,'native_verification_time');
   if(q.action==='select')assert.equal(response.observation.selectedSession,q.session);
   if(q.action==='choose_connection')assert.equal(response.observation.targetConnection,q.targetConnection);
   if(['resize','window_mode'].includes(q.action))assert.equal(response.observation.windowMode,q.windowMode);
   const statuses=events.filter(v=>v.type==='mcp'&&v.name==='status'&&origin+v.t>=responseReceivedAt&&origin+v.t<=verifiedAt&&v.seq<outcome.seq);
   if(['select','resize'].includes(q.action)){
    const matches=statuses.filter(v=>v.index===start.binding.adapter&&v.response.sessions.some(p=>p.session_id===q.session&&p.state==='agent_owned'&&p.control_epoch===start.binding.epoch&&p.stream_id===start.binding.stream&&isDeepStrictEqual(p.geometry,observation.geometry)));
    assert.ok(matches.length&&(q.action!=='select'||matches.length>=2&&matches.at(-1).t-matches[0].t>=750),'native_geometry_after_receipt');
   }
   if(['reclaim','handoff'].includes(q.action)){
    const target=q.action==='reclaim'?observation:observation.session;
    assert.ok(statuses.some(v=>v.index===(q.action==='reclaim'?start.binding.adapter:(start.binding.adapter+16)%32)&&v.response.sessions.some(p=>Object.entries(target).filter(([k])=>k!=='verified').every(([k,x])=>isDeepStrictEqual(p[k],x)))),'native_state_after_receipt');
   }
   previous=verifiedAt;
  }else{assert.equal(i,requests.length-1,'abandoned_not_last');previous=origin+outcome.t;}
 }
 for(const kind of ['starts','responses','acceptances','results'])for(const file of f[kind])assert.ok(f.requests.some(q=>q.id===(file.request??file).id),'orphan_native_file');
 assert.equal(f.acceptances.length,events.filter(v=>v.type==='native_received').length,'acceptance_count');
 return results;
}

function transitions(e,starts,ends,native){
 const {events,summary:s}=e,state=new Map(),seenStreams=new Set();
 for(const session of s.sessions){const initial=only(events.filter(v=>v.type==='session_ready'&&v.id===session.id),'initial_session');assert.equal(initial.index,session.index);assert.equal(initial.adapter,initial.index);state.set(session.id,binding(initial));assert.ok(!seenStreams.has(initial.stream));seenStreams.add(initial.stream);}
 const rows=events.filter(v=>v.type==='transition');assert.ok(rows.length>=ends.length&&rows.length<=starts.length,'transition_count');
 for(let i=0;i<rows.length;i++){
  const r=rows[i],start=starts[i];assert.equal(r.round,i);assert.equal(r.index,CADENCE.sessionOrder[i]);same(r.before,start.binding);same(r.before,state.get(r.before.session),'binding_chain');
  verifyTransition(r);assert.equal(r.adapter,(r.before.adapter+16)%32);assert.equal(r.targetConnection,s.connections[r.adapter]);assert.equal(r.oldOwner.connection_id,s.connections[r.before.adapter]);assert.ok(!seenStreams.has(r.assigned.session.stream_id),'reused_stream');seenStreams.add(r.assigned.session.stream_id);
  assert.ok(r.seq>start.seq&&s.clockOrigin+r.t<=start.deadline,'late_transition');
  for(const action of ['select','resize','reclaim','choose_connection','handoff']){
   const n=only(native.filter(v=>v.request.round===i&&v.request.action===action),'transition_native_missing');assert.ok(n.seq>start.seq&&n.seq<r.seq);
   const expected={select:r.selected,resize:r.resized,reclaim:r.reclaimed,choose_connection:{targetConnection:r.targetConnection},handoff:r.assigned}[action];
   for(const [k,v] of Object.entries(expected))same(n.observation[k],v,'native_transition_observation');
   if(['choose_connection','handoff'].includes(action))assert.equal(n.request.targetConnection,r.targetConnection);
  }
  const between=events.filter(v=>v.seq>start.seq&&v.seq<r.seq);
  const resized=only(native.filter(v=>v.request.round===i&&v.request.action==='resize'),'resize');
  const reclaim=only(native.filter(v=>v.request.round===i&&v.request.action==='reclaim'),'reclaim');
  assert.ok(between.some(v=>v.type==='remote_geometry'&&v.round===i&&v.session===r.before.session&&v.remote===r.remote&&v.seq>resized.seq&&v.seq<reclaim.seq),'raw_stty');
  const handoff=only(native.filter(v=>v.request.round===i&&v.request.action==='handoff'),'handoff');
  const release=between.find(v=>v.type==='mcp'&&v.name==='status'&&v.seq>handoff.seq&&v.index===r.before.adapter&&v.response.connection_id===r.oldOwner.connection_id&&isDeepStrictEqual(v.response.sessions,r.oldOwner.sessions));assert.ok(release,'raw_release');
  const b=only(between.filter(v=>v.type==='binding'&&v.session===r.before.session),'raw_binding');assert.ok(b.seq>release.seq);same({adapter:b.before.adapter,epoch:b.before.epoch,stream:b.before.stream},{adapter:r.before.adapter,epoch:r.before.epoch,stream:r.before.stream});
  const after={adapter:r.adapter,epoch:r.assigned.session.control_epoch,stream:r.assigned.session.stream_id};same(b.after,after);state.set(r.before.session,{session:r.before.session,...after});
  assert.ok(e.output.some(v=>v.session===r.before.session&&v.stream===after.stream&&v.t>=b.t&&v.response.text?.includes('SOAK:')),'new_stream_output');
 }
 // An incomplete round may have adopted a binding before audit timed out.
 // Account for it explicitly, never silently drop the raw binding.
 for(const b of events.filter(v=>v.type==='binding')){
  const preceding=events.filter(v=>v.type==='binding'&&v.session===b.session&&v.seq<b.seq).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===b.session);
  assert.ok(preceding,'foreign_binding');same({adapter:b.before.adapter,epoch:b.before.epoch,stream:b.before.stream},{adapter:preceding.adapter,epoch:preceding.epoch,stream:preceding.stream});assert.equal(b.after.adapter,(b.before.adapter+16)%32);assert.ok(b.after.epoch>b.before.epoch&&b.after.stream!==b.before.stream);
 }
 for(const session of s.sessions){const b=events.filter(v=>v.type==='binding'&&v.session===session.id).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===session.id);same({adapter:session.adapter,epoch:session.epoch,stream:session.stream},{adapter:b.adapter,epoch:b.epoch,stream:b.stream},'final_binding');}
 return rows;
}

function auditsAndHealth(e,starts,ends){
 const {events,summary:s}=e;assert.equal(e.audits.length,16);assert.equal(new Set(e.audits.map(v=>v.index)).size,16);const partial=[];
 for(const a of e.audits){assert.equal(a.session,s.sessions.find(v=>v.index===a.index)?.id);assert.equal(new Set(a.actual).size,a.actual.length,'duplicate_audit');
  for(let round=0;round<ends.length;round++)assert.ok(a.actual.includes(`AUDIT_${a.index}_${round}`),'missing_audit');
  for(const token of a.actual){
   const match=new RegExp(`^AUDIT_${a.index}_(\\d+)$`).exec(token);assert.ok(match,'audit_token');const round=Number(match[1]),start=starts[round];assert.ok(start,'audit_without_round');
   const limit=ends[round]?.seq??Infinity,text=`printf '%s\\n' '${token}' >> /tmp/soak-audit-${a.index}`;
   const sends=events.filter(v=>v.type==='mcp'&&v.name==='send_text'&&v.args.session_id===a.session&&v.args.text===text&&v.seq>start.seq&&v.seq<limit);
   assert.equal(sends.length,2,'audit_dedup');same(sends[0].args,sends[1].args);same(sends[0].response,sends[1].response);assert.equal(sends[0].response.result,'delivered');
   const enter=events.find(v=>v.type==='mcp'&&v.name==='send_key'&&v.args.session_id===a.session&&v.args.key==='Enter'&&v.seq>sends[1].seq&&v.seq<limit);assert.equal(enter?.response.result,'delivered','audit_enter');
   const current=events.filter(v=>v.type==='binding'&&v.session===a.session&&v.seq<sends[0].seq).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===a.session);
   for(const request of [...sends,enter]){assert.equal(request.index,current.adapter);assert.equal(request.args.control_epoch,current.epoch);assert.ok(request.args.request_id);}
   if(round>=ends.length)partial.push({index:a.index,round,token});
  }
 }
 for(let i=0;i<ends.length;i++){
  const start=starts[i],end=ends[i],audit=only(events.filter(v=>v.type==='audit'&&v.round===i),'audit_event'),health=only(events.filter(v=>v.type==='health'&&v.seq>audit.seq&&v.seq<end.seq),'health_event');
  assert.ok(audit.seq>start.seq);assert.equal(health.values.length,32);
  for(let index=0;index<32;index++){
   const p=health.values[index];assert.equal(p.app_state,'online');assert.equal(p.connection_id,s.connections[index]);
   assert.ok(events.some(v=>v.type==='mcp'&&v.name==='status'&&v.index===index&&v.seq>audit.seq&&v.seq<health.seq&&isDeepStrictEqual(v.response,p)),'raw_health_missing');
  }
  for(const session of s.sessions){const b=events.filter(v=>v.type==='binding'&&v.session===session.id&&v.seq<health.seq).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===session.id);const p=health.values[b.adapter].sessions.find(v=>v.session_id===session.id);assert.ok(p?.state==='agent_owned'&&p.control_epoch===b.epoch&&p.stream_id===b.stream,'health_binding');}
 }
 return partial;
}

function outputEvidence(e,start,end){
 const rates=[];
 for(const row of e.output)assert.ok(e.summary.sessions.some(s=>s.id===row.session&&s.index===row.index),'foreign_output');
 for(const s of e.summary.sessions){
  const oracle=new LogOracle(s.index);let stream=null,cursor=0,records=0,previous=-Infinity,privateStart=null,privateMs=0;
  for(const row of e.output.filter(v=>v.session===s.id)){
   assert.ok(row.t>=previous);previous=row.t;const b=e.events.filter(v=>v.type==='binding'&&v.session===s.id&&v.t<=row.t).at(-1)?.after??e.events.find(v=>v.type==='session_ready'&&v.id===s.id);
   assert.equal(row.epoch,b.epoch);assert.equal(row.stream,b.stream);if(stream!==row.stream){stream=row.stream;cursor=0;oracle.reset();}
   assert.equal(row.cursor,cursor,'cursor_chain');const p=row.response;assert.ok(Number.isSafeInteger(p.next_cursor)&&p.next_cursor>=cursor);assert.ok(Number.isSafeInteger(p.oldest_cursor)&&p.oldest_cursor<=cursor,'output_gap');cursor=p.next_cursor;
   const before=oracle.count;oracle.push(p.text??'');if(row.phase==='normal'){assert.ok(row.t>=start.t&&row.t<=end.t);records+=oracle.count-before;}
  }
  for(const b of e.events.filter(v=>v.t>=start.t&&v.t<=end.t&&v.session===s.id)){
   if(b.type==='transition_boundary'&&b.stage==='reclaimed'){assert.equal(privateStart,null);privateStart=b.t;}
   if(b.type==='binding'){assert.notEqual(privateStart,null,'binding_without_reclaim');privateMs+=b.t-privateStart;privateStart=null;}
  }
  if(privateStart!==null)privateMs+=end.t-privateStart;
  const publicSeconds=(end.t-start.t-privateMs)/1000;assert.ok(records>0&&publicSeconds>0,'missing_output');rates.push({index:s.index,records,publicSeconds,bytesPerSecond:records*(1024+String(s.index).length)/publicSeconds});
 }
 return rates;
}

function memoryEvidence(e,duration){
 same(e.memory,e.summary.samples,'raw_memory_mismatch');assert.ok(e.memory.length,'missing_samples');let previous=0,identities;
 const key=p=>`${p.pid}:${p.startedTicks}`;
 for(const sample of e.memory){
  assert.ok(Number.isFinite(sample.elapsed)&&sample.elapsed>=previous&&sample.elapsed<=duration,'sample_boundary');assert.ok(sample.elapsed-previous<=45,'sample_gap');previous=sample.elapsed;
  assert.equal(sample.phase,'natural');assert.equal(sample.debugPort.established,0,'debugger');assert.ok(sample.debugPort.listening>=1);
  const owned=sample.ownership;assertProcessIdentity(e.process,owned);same(owned.adapters,e.summary.adapterIdentities);assert.equal(owned.adapters.length,32);
  for(const p of owned.descendants)assert.ok(p.dataDirectoryMatch&&e.process.descendants.some(v=>key(v)===key(p)&&v.dataDirectoryMatch),'foreign_descendant');
  same(sample.processes.map(key).sort(),[owned,...owned.adapters,...owned.descendants].map(key).sort(),'foreign_process');assert.equal(new Set(sample.processes.map(v=>v.pid)).size,sample.processes.length);
  for(const [role,count] of [['app',1],['renderer',1],['adapter',32]])assert.equal(sample.processes.filter(p=>p.role===role).length,count);
  for(const p of sample.processes){if(p.role==='app')assertProcessIdentity(owned,p);else if(p.role==='adapter')assert.ok(owned.adapters.some(a=>key(a)===key(p)));else assert.ok(owned.descendants.some(a=>key(a)===key(p)));}
  const ids=sample.processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(key).sort();if(identities)same(ids,identities);else identities=ids;
  for(const k of ['privateBytes','workingSetBytes']){assert.ok(sample.processes.every(p=>Number.isFinite(p[k])&&p[k]>0));assert.equal(sample[k],sample.processes.reduce((sum,p)=>sum+p[k],0),'memory_sum');}
 }
 assert.ok(duration-previous<=45,'sample_end_gap');
}

export function verifyCadenceEvidence(e){
 const v={evidenceValid:false,completedRounds:0,cadenceObserved:false,longRunReadiness:'unproven',memoryAcceptance:'not_evaluated',phase5Acceptance:false,errors:[],metrics:{}};
 try{
  const {summary:s,events}=e;assert.equal(s.scope,'NC');assert.equal(s.profile,'diagnostic');same(s.contract,CADENCE);assert.ok(s.finishedUtc);assert.ok(Number.isFinite(s.clockOrigin));assert.equal(s.phase5Acceptance,false);
  assert.equal(s.longRunReadiness,'unproven');assert.equal(s.memoryAcceptance,'not_evaluated');assert.equal(s.nativeResponseLatency,'not_measured');
  assert.equal(s.sessions.length,16);assert.equal(new Set(s.sessions.map(v=>v.id)).size,16);same(s.sessions.map(v=>v.index).sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i));assert.equal(s.connections.length,32);assert.equal(new Set(s.connections).size,32);assert.equal(s.fixtures.length,2);
  let previous=-Infinity;for(const [i,row] of events.entries()){assert.equal(row.seq,i+1);assert.equal(row.owner,s.owner);assert.equal(row.scope,'NC');assert.ok(Number.isFinite(row.t)&&row.t>=previous,'event_time_order');previous=row.t;}
  const start=only(events.filter(v=>v.type==='measurement_start'),'measurement_start'),end=only(events.filter(v=>v.type==='measurement_end'),'measurement_end');assert.ok(end.t>start.t);
  same(e.boundary.eventSeq,end.seq);assert.equal(s.elapsedSeconds,(end.t-start.t)/1000,'duration');assert.equal(e.boundary.elapsedSeconds,s.elapsedSeconds);assert.equal(e.boundary.samples,e.memory.length);
  assert.ok(events.some(v=>v.type==='browser_disconnected'&&v.seq<start.seq));assert.ok(!events.some(v=>v.type==='browser_attached'&&v.seq>start.seq),'browser_reattached');
  for(const k of ['forcedGcCalls','jsProbes','rawCdpSessions'])assert.equal(s.instrumentation[k],0,'instrumentation');
  const starts=events.filter(v=>v.type==='cadence_round_start'),ends=events.filter(v=>v.type==='cadence_round_end');assert.ok(starts.length<=3&&ends.length<=starts.length&&starts.length<=ends.length+1);
  v.completedRounds=ends.length;assert.equal(s.completedRounds,ends.length,'summary_round_count');
  for(const [i,r] of starts.entries()){
   assert.equal(r.round,i);assert.equal(r.index,CADENCE.sessionOrder[i]);assert.ok(r.seq>=start.seq&&r.seq<end.seq);assert.ok(r.startedAt>=s.clockOrigin+start.t&&r.startedAt<=s.clockOrigin+r.t);
   if(i){assert.equal(r.previousStartedAt,starts[i-1].startedAt);assert.ok(r.startedAt>=r.previousStartedAt+60000,'early_start');}
   assert.equal(r.deadline,Math.min(r.startedAt+60000,s.clockOrigin+900000));
   const latest=events.filter(v=>v.type==='binding'&&v.session===r.binding.session&&v.seq<r.seq).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===r.binding.session);
   assert.equal(r.binding.session,s.sessions.find(s=>s.index===r.index).id);same({adapter:r.binding.adapter,epoch:r.binding.epoch,stream:r.binding.stream},{adapter:latest.adapter,epoch:latest.epoch,stream:latest.stream});
   if(ends[i]){const f=ends[i];assert.equal(f.round,i);assert.equal(f.index,r.index);assert.equal(f.startedAt,r.startedAt);assert.equal(f.deadline,r.deadline);assert.ok(f.seq>r.seq&&f.seq<end.seq&&f.finishedAt>=r.startedAt&&f.finishedAt<=r.deadline&&s.clockOrigin+f.t<=r.deadline,'late_round_end');assert.ok(f.finishedAt<=s.clockOrigin+f.t);}
  }
  if(ends.length<3){assert.equal(s.status,'failed');const stop=only(events.filter(v=>v.type==='cadence_stopped'),'missing_stop');assert.equal(stop.completedRounds,ends.length);assert.equal(stop.reason,s.stopReason);assert.ok(stop.seq<end.seq);}
  else{assert.equal(s.status,'finished');assert.equal(s.stopReason,null);}
  const native=nativeEvidence(e,starts);const rounds=transitions(e,starts,ends,native);v.metrics.partialAudits=auditsAndHealth(e,starts,ends);v.metrics.rates=outputEvidence(e,start,end);memoryEvidence(e,s.elapsedSeconds);
  for(const d of events.filter(v=>v.type==='cadence_deadline')){assert.ok(d.observedAt>d.deadline);assert.ok(d.observedAt<=s.clockOrigin+d.t);assert.ok(!events.some(v=>v.seq>d.seq&&v.seq<end.seq&&['transition','cadence_round_end'].includes(v.type)),'success_after_deadline');}
  const shutdown=only(events.filter(v=>v.type==='shutdown'),'shutdown');assert.ok(shutdown.seq>end.seq);assert.equal(shutdown.exit.code,0);same(shutdown.process,e.process);validateShutdown(e.process,shutdown.eofs);
  assert.equal(e.cleanup.owner,s.owner);same(e.cleanup.process,e.process);same(e.cleanup.fixtures,s.fixtures);same(e.cleanup.remaining,[]);same(e.cleanup.containers,[]);
  for(const key of ['normalExit','forcedCleanup','remainingProcesses','remainingContainers','failures'])same(e.cleanup[key],s.cleanup[key]);
  assert.equal(e.cleanup.normalExit,true);assert.equal(e.cleanup.forcedCleanup,false);assert.equal(e.cleanup.remainingProcesses,0);assert.equal(e.cleanup.remainingContainers,0);same(e.cleanup.failures,[]);assert.ok(s.fixtures.every(f=>f.removed&&f.image===s.imageId));
  v.metrics.rounds=ends.map(r=>({round:r.round,index:r.index,startedAt:r.startedAt,finishedAt:r.finishedAt,durationMs:r.finishedAt-r.startedAt}));v.metrics.transitions=rounds.length;v.metrics.samples=e.memory.length;
  v.evidenceValid=true;v.cadenceObserved=ends.length===3;assert.equal(s.cadenceObserved,v.cadenceObserved,'summary_cadence');
 }catch(error){v.evidenceValid=false;v.cadenceObserved=false;v.errors.push(String(error));}
 return v;
}

export async function loadCadenceEvidence(out){
 const json=async name=>JSON.parse((await readFile(join(out,name),'utf8')).replace(/^\uFEFF/,''));
 const lines=async name=>{const text=await readFile(join(out,name),'utf8');assert.ok(!text||text.endsWith('\n'),'truncated_jsonl');return text.split('\n').filter(Boolean).map(JSON.parse);};
 const nativeFiles={};for(const kind of ['requests','starts','responses','acceptances','results']){const names=await readdir(join(out,'native',kind));assert.ok(names.every(n=>n.endsWith('.json')));nativeFiles[kind]=await Promise.all(names.map(n=>json('native/'+kind+'/'+n)));}
 return {summary:await json('summary.json'),events:await lines('events.jsonl'),output:await lines('output.jsonl'),memory:await lines('memory.jsonl'),nativeFiles,audits:await json('audit-observations.json'),boundary:await json('normal-boundary.json'),process:await json('process.json'),cleanup:await json('final-cleanup.json')};
}

export async function verifyCadenceDirectory(out){
 // Exclusive claim also prevents repeating verification after a crashed verifier.
 const claim=await open(join(out,'cadence-verification.claim'),'wx');await claim.close();
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');let verdict;
 try{
  const before=await sha256(join(out,'summary.json')),e=await loadCadenceEvidence(out);verdict=verifyCadenceEvidence(e);
  for(const [p,h] of Object.entries(e.summary.sources)){assert.equal(await sha256(join(root,p)),h,'source_changed:'+p);}
  const common=Object.fromEntries(Object.entries(e.summary.sources).filter(([p])=>!p.startsWith('rust/tests/phase5/native-cadence/')));assert.equal(Object.keys(common).length,23);
  for(const file of (await readdir(dirname(fileURLToPath(import.meta.url)))).filter(f=>f.endsWith('.mjs')&&!f.endsWith('.test.mjs')&&f!=='test-fixture.mjs'))assert.ok(e.summary.sources['rust/tests/phase5/native-cadence/'+file],'missing_diagnostic_source');
  for(const key of ['app','adapter']){const b=e.summary.binaries[key];assert.equal(await sha256(b.path),b.sha256,'binary_changed');}
  assert.deepEqual(e.summary.cadenceBaselines.map(v=>v.scope),['M','F']);
  for(const b of e.summary.cadenceBaselines){
   const peerDir=resolve(root,b.evidence),peer=JSON.parse(await readFile(join(peerDir,'summary.json'),'utf8')),receipt=JSON.parse(await readFile(join(peerDir,'verified.json'),'utf8'));
   assert.equal(await sha256(join(peerDir,'summary.json')),b.summarySha256);assert.equal(receipt.summarySha256,b.summarySha256);assert.equal(await sha256(join(peerDir,'verified.json')),b.receiptSha256);assert.equal(receipt.preflightPassed,true);assert.equal(peer.scope,b.scope);same(b.sources,peer.sources);
   assert.equal(compareIdentity({...e.summary,sources:common},peer).same,true,'baseline_identity_changed');
  }
  assert.equal(await sha256(join(out,'summary.json')),before,'summary_changed_during_verification');verdict.summarySha256=before;
  verdict.rawHashes={};for(const name of ['events.jsonl','output.jsonl','memory.jsonl','normal-boundary.json','audit-observations.json','process.json','final-cleanup.json'])verdict.rawHashes[name]=await sha256(join(out,name));
 }catch(error){verdict??={evidenceValid:false,completedRounds:0,cadenceObserved:false,longRunReadiness:'unproven',memoryAcceptance:'not_evaluated',phase5Acceptance:false,metrics:{},errors:[]};verdict.evidenceValid=false;verdict.cadenceObserved=false;verdict.errors.push(String(error));}
 verdict.verifiedUtc=new Date().toISOString();await writeFile(join(out,'cadence-verification.json'),JSON.stringify(verdict,null,2)+'\n',{flag:'wx'});return verdict;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.ok(process.argv[2],'usage: verify.mjs evidence-dir');const result=await verifyCadenceDirectory(resolve(process.argv[2]));console.log(JSON.stringify(result,null,2));if(!result.evidenceValid)process.exitCode=1;
}
