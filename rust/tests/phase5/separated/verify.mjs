import assert from 'node:assert/strict';
import {readFile,writeFile,access,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveContract,compareIdentity} from './contract.mjs';
import {sha256,validateShutdown,assertProcessIdentity} from './runtime.mjs';
import {memoryVerdict} from '../native-soak-control.mjs';
import {LogOracle} from '../soak-oracle.mjs';
import {verifyRounds} from './transitions.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
export async function loadEvidence(out){
 async function json(name){try{return JSON.parse((await readFile(join(out,name),'utf8')).replace(/^\uFEFF/,''));}catch(e){throw Error(name+': '+e.message);}}
 async function lines(name){try{const text=await readFile(join(out,name),'utf8');assert.ok(!text||text.endsWith('\n'),'truncated_final_record');return text.split('\n').filter(Boolean).map(JSON.parse);}catch(e){throw Error(name+': '+e.message);}}
 const summary=await json('summary.json'),events=await lines('events.jsonl'),output=await lines('output.jsonl'),memory=await lines('memory.jsonl');
 const nativeFiles={};if(summary.scope==='N')for(const kind of ['requests','starts','responses','results']){const files=await readdir(join(out,'native',kind));assert.ok(files.every(f=>f.endsWith('.json')),'partial_native_file');nativeFiles[kind]=await Promise.all(files.map(f=>json('native/'+kind+'/'+f)));}
 return {summary,events,output,memory,nativeFiles,audits:await json('audit-observations.json'),boundary:await json('normal-boundary.json'),process:await json('process.json'),cleanup:await json('final-cleanup.json')};
}
function verifyOutput(e,start,end){
 const totals=[];
 for(const row of e.output)assert.ok(e.summary.sessions.some(s=>s.id===row.session&&s.index===row.index),'foreign_output_session');
 for(const s of e.summary.sessions){
  const initial=e.events.find(v=>v.type==='session_ready'&&v.id===s.id)??(e.summary.scope==='M'?s:null);assert.ok(initial,'initial_binding_missing');
  const oracle=new LogOracle(s.index);let stream=null,cursor=0,records=0,previous=-Infinity,seen=false;
  for(const row of e.output.filter(row=>row.session===s.id)){
   assert.equal(row.index,s.index);assert.ok(row.t>=previous,'output_time_order');previous=row.t;
   const binding=e.events.filter(v=>v.type==='binding'&&v.session===s.id&&v.t<=row.t).at(-1)?.after??initial;assert.equal(row.epoch,binding.epoch,'output_epoch');assert.equal(row.stream,binding.stream,'output_stream');
   if(stream!==row.stream){assert.ok(stream===null||e.events.some(v=>v.type==='binding'&&v.session===s.id&&v.after.stream===row.stream&&v.t<=row.t),'unknown_stream');stream=row.stream;cursor=0;oracle.reset();}
   assert.equal(row.cursor,cursor,'output_cursor_chain');const p=row.response;assert.ok(Number.isSafeInteger(p.next_cursor)&&p.next_cursor>=cursor,'output_cursor');assert.ok(Number.isSafeInteger(p.oldest_cursor)&&p.oldest_cursor<=cursor,'output_gap');cursor=p.next_cursor;
   const before=oracle.count;oracle.push(p.text??'');
   if(row.phase==='normal'){assert.ok(row.t>=start.t&&row.t<=end.t,'output_outside_boundary');records+=oracle.count-before;seen=true;}
  }
  assert.ok(seen,'missing_output_'+s.index);let privateMs=0;
  const boundaries=e.events.filter(v=>v.t>=start.t&&v.t<=end.t&&v.session===s.id&&['transition_boundary','binding'].includes(v.type));let privateStart=null;
  for(const b of boundaries){if(b.type==='transition_boundary'&&b.stage==='reclaimed'&&privateStart===null)privateStart=b.t;if(b.type==='binding'){assert.notEqual(privateStart,null,'binding_without_reclaim');privateMs+=b.t-privateStart;privateStart=null;}}
  assert.equal(privateStart,null,'unfinished_private_interval');const seconds=(end.t-start.t-privateMs)/1000;assert.ok(seconds>0,'no_public_interval');totals.push({index:s.index,records,publicSeconds:seconds,bytesPerSecond:records*(1024+String(s.index).length)/seconds});
 }
 return totals;
}
function verifyMemory(e,duration){
 assert.deepEqual(e.memory,e.summary.samples,'raw_memory_mismatch');let previous=0,identities;
 assert.ok(e.memory.length,'missing_memory_samples');
 for(const s of e.memory){
  const owned=s.ownership;assert.ok(owned,'sample_ownership_missing');assertProcessIdentity(e.process,owned);
  assert.deepEqual(owned.adapters,e.summary.adapterIdentities,'adapter_identity');assert.equal(owned.adapters.length,32);
  const key=p=>`${p.pid}:${p.startedTicks}`;
  for(const p of owned.descendants){assert.equal(p.dataDirectoryMatch,true);assert.ok(e.process.descendants.some(d=>key(d)===key(p)&&d.dataDirectoryMatch),'foreign_descendant');}
  assert.deepEqual(s.processes.map(key).sort(),[owned,...owned.adapters,...owned.descendants].map(key).sort(),'owned_process_set');
  for(const p of s.processes){if(p.role==='app')assertProcessIdentity(owned,p);else if(p.role==='adapter')assert.ok(owned.adapters.some(a=>key(a)===key(p)));else assert.ok(owned.descendants.some(a=>key(a)===key(p)),'webview_membership');}
  assert.ok(s.elapsed>=previous&&s.elapsed<duration,'sample_boundary');assert.ok(s.elapsed-previous<=45,'sample_gap');previous=s.elapsed;
  assert.equal(s.phase,'natural');assert.equal(s.debugPort.established,0,'debugger_connection');assert.ok(s.debugPort.listening>=1);
  assert.equal(new Set(s.processes.map(p=>p.pid)).size,s.processes.length,'duplicate_process');
  for(const [role,count] of [['app',1],['renderer',1],['adapter',32]])assert.equal(s.processes.filter(p=>p.role===role).length,count,'role_count');
  const ids=s.processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(p=>`${p.pid}:${p.startedTicks}`).sort();if(identities)assert.deepEqual(ids,identities,'process_identity');else identities=ids;
  for(const key of ['privateBytes','workingSetBytes']){assert.ok(s.processes.every(p=>Number.isFinite(p[key])&&p[key]>0));assert.equal(s[key],s.processes.reduce((n,p)=>n+p[key],0),'memory_sum');}
 }
 assert.ok(duration-previous<=45,'sample_end_gap');
}
function verifyAudits(e,rounds,start,end){
 assert.equal(e.audits.length,16);assert.equal(new Set(e.audits.map(a=>a.index)).size,16);
 const auditEvents=e.events.filter(v=>v.type==='audit');assert.equal(auditEvents.length,rounds);
 for(let round=0;round<rounds;round++){
  assert.equal(auditEvents[round].round,round);assert.ok(auditEvents[round].t>=start.t&&auditEvents[round].t<=end.t);
  if(e.summary.scope==='M')assert.ok(auditEvents[round].t-start.t>=round*60000&&auditEvents[round].t-start.t<(round*60+45)*1000,'audit_cadence');
 }
 for(const a of e.audits){
  assert.equal(a.session,e.summary.sessions.find(s=>s.index===a.index)?.id);assert.deepEqual(a.actual,Array.from({length:rounds},(_,r)=>`AUDIT_${a.index}_${r}`),'audit_effects');
  for(let round=0;round<rounds;round++){
   const text=`printf '%s\\n' 'AUDIT_${a.index}_${round}' >> /tmp/soak-audit-${a.index}`;
   const sends=e.events.filter(v=>v.type==='mcp'&&v.name==='send_text'&&v.args.session_id===a.session&&v.args.text===text);
   assert.equal(sends.length,2,'audit_dedup_missing');assert.deepEqual(sends[0].args,sends[1].args,'audit_request_identity');assert.deepEqual(sends[0].response,sends[1].response);assert.equal(sends[0].response.result,'delivered');
   const enter=e.events.find(v=>v.seq>sends[1].seq&&v.type==='mcp'&&v.name==='send_key'&&v.args.session_id===a.session&&v.args.key==='Enter');assert.ok(enter&&enter.response.result==='delivered','audit_enter');
  }
 }
}
function verifyTransitionRaw(e,records){
 const state=new Map();for(const s of e.summary.sessions){const initial=e.events.find(v=>v.type==='session_ready'&&v.id===s.id);assert.ok(initial,'initial_binding_missing');state.set(s.id,{adapter:initial.adapter,epoch:initial.epoch,stream:initial.stream});}
 assert.equal(e.events.filter(v=>v.type==='binding').length,records.length,'binding_count');let previous=0;
 for(const record of records){
  const id=record.before.session,rows=e.events.filter(v=>v.seq>previous&&v.seq<record.seq),status=rows.filter(v=>v.type==='mcp'&&v.name==='status');
  assert.deepEqual({adapter:record.before.adapter,epoch:record.before.epoch,stream:record.before.stream},state.get(id),'initial_to_transition');
  const find=(index,predicate,after=0)=>status.find(v=>v.seq>after&&v.index===index&&predicate(v.response));
  const own=p=>p.sessions.find(s=>s.session_id===id);
  const reclaim=find(record.before.adapter,p=>own(p)?.state==='user_owned'&&own(p).control_epoch===record.reclaimed.control_epoch&&own(p).stream_id===null);assert.ok(reclaim,'raw_reclaim_missing');assert.deepEqual(own(reclaim.response),record.reclaimed);
  const assigned=find(record.adapter,p=>p.connection_id===record.targetConnection&&own(p)?.state==='agent_owned'&&own(p).control_epoch===record.assigned.session.control_epoch&&own(p).stream_id===record.assigned.session.stream_id,reclaim.seq);assert.ok(assigned,'raw_handoff_missing');assert.deepEqual(own(assigned.response),record.assigned.session);
  const release=find(record.before.adapter,p=>p.connection_id===record.oldOwner.connection_id&&!own(p),assigned.seq);assert.ok(release,'raw_release_missing');assert.deepEqual(release.response.sessions,record.oldOwner.sessions);
  const geometry=(v,g)=>v.index===record.before.adapter&&own(v.response)?.state==='agent_owned'&&JSON.stringify(own(v.response).geometry)===JSON.stringify(g);
  const selected=status.filter(v=>v.seq<reclaim.seq&&geometry(v,record.selected.geometry));assert.ok(selected.length>=2&&selected.at(-1).t-selected[0].t>=750,'raw_selected_geometry');
  const resized=status.find(v=>v.seq>selected.at(-1).seq&&v.seq<reclaim.seq&&geometry(v,record.resized.geometry));assert.ok(resized,'raw_resized_geometry');
  assert.ok(rows.some(v=>v.type==='remote_geometry'&&v.session===id&&v.round===record.round&&v.remote===record.remote&&v.seq>resized.seq&&v.seq<reclaim.seq),'raw_stty_missing');
  const boundary=rows.find(v=>v.type==='transition_boundary'&&v.stage==='reclaimed'&&v.session===id&&v.seq>reclaim.seq);assert.ok(boundary,'private_boundary_missing');
  const binding=rows.find(v=>v.type==='binding'&&v.session===id&&v.seq>release.seq&&v.seq>boundary.seq);assert.ok(binding,'raw_binding_missing');assert.deepEqual({adapter:binding.before.adapter,epoch:binding.before.epoch,stream:binding.before.stream},state.get(id));
  const after={adapter:record.adapter,epoch:record.assigned.session.control_epoch,stream:record.assigned.session.stream_id};assert.deepEqual(binding.after,after);state.set(id,after);
  const next=e.events.find(v=>v.type==='binding'&&v.session===id&&v.seq>binding.seq);
  assert.ok(e.output.some(v=>v.session===id&&v.stream===after.stream&&v.epoch===after.epoch&&v.t>=binding.t&&(!next||v.t<next.t)&&v.response.text?.includes('SOAK:')),'new_stream_output_missing');
  const health=e.events.find(v=>v.type==='health'&&v.seq>record.seq);assert.ok(health,'transition_health_missing');for(const [session,b] of state){const p=health.values[b.adapter]?.sessions.find(p=>p.session_id===session);assert.ok(p?.state==='agent_owned'&&p.control_epoch===b.epoch&&p.stream_id===b.stream,'transition_health_binding');}
  previous=record.seq;
 }
 for(const s of e.summary.sessions)assert.deepEqual({adapter:s.adapter,epoch:s.epoch,stream:s.stream},state.get(s.id),'final_binding');
}
function verifyNative(e,records){
 const native=e.events.filter(v=>v.type==='native'),actions=['window_mode','select','resize','reclaim','choose_connection','handoff'];assert.equal(native.length,12);assert.equal(new Set(native.map(v=>v.request.id)).size,12,'duplicate_native_id');
 for(const kind of ['requests','starts','responses','results'])assert.equal(e.nativeFiles?.[kind]?.length,12,'native_files_missing');
 let previous=-Infinity;
 for(let i=0;i<native.length;i++){
  const v=native[i],q=v.request,r=records[Math.floor(i/6)],o=v.response.observation;assert.equal(q.action,actions[i%6],'native_action_order');assert.equal(q.round,r.round);assert.equal(q.owner,e.summary.owner);assert.equal(v.response.id,q.id);assert.equal(v.response.owner,q.owner);assert.equal(v.response.status,'performed');assert.ok(o?.screenshotId);
  if(q.action!=='window_mode')assert.equal(q.session,r.before.session);if(q.action==='select')assert.equal(o.selectedSession,q.session);
  if(['choose_connection','handoff'].includes(q.action))assert.equal(q.targetConnection,r.targetConnection);if(q.action==='choose_connection')assert.equal(o.targetConnection,q.targetConnection);
  if(['window_mode','resize'].includes(q.action)){assert.equal(q.windowMode,q.action==='window_mode'?'restored':r.windowMode);assert.equal(o.windowMode,q.windowMode);}
  const observed={window_mode:{windowMode:q.windowMode},select:r.selected,resize:r.resized,reclaim:r.reclaimed,choose_connection:{targetConnection:r.targetConnection},handoff:r.assigned}[q.action];
  for(const [key,value] of Object.entries(observed))assert.deepEqual(v.observation[key],value,'native_round_observation');
  assert.ok(Number.isFinite(e.summary.clockOrigin));assert.equal(q.expiresAt,e.summary.clockOrigin+900000,'native_watchdog');assert.ok(v.verifiedAt<=e.summary.clockOrigin+v.t&&v.seq<r.seq,'native_observation_time');
  assert.ok(q.issuedAt>=previous&&q.inputStartedAt>=q.issuedAt);assert.equal(q.verifyDeadline,Math.min(q.inputStartedAt+45000,q.expiresAt));assert.ok(v.verifiedAt>=q.inputStartedAt&&v.verifiedAt<=q.verifyDeadline);assert.equal(v.observation.verified,true);previous=v.verifiedAt;
  const {inputStartedAt,verifyDeadline,...issued}=q;
  for(const [kind,expected] of [['requests',issued],['starts',{id:q.id,owner:q.owner}],['responses',v.response],['results',{request:q,response:v.response,observation:v.observation,verifiedAt:v.verifiedAt}]]){const matching=e.nativeFiles[kind].filter(x=>(x.id??x.request?.id)===q.id);assert.equal(matching.length,1,'native_file_id');assert.deepEqual(matching[0],expected,'native_file_mismatch');}
 }
 assert.ok(e.events.find(v=>v.type==='measurement_end').t<=900000,'native_whole_run_deadline');
}
function verifyOverload(e,end,o){
 const one=type=>{const rows=e.events.filter(v=>v.type===type);assert.equal(rows.length,1,type);return rows[0];};
 const start=one('overload_control_start'),done=one('overload_control_end'),blocked=one('overload_ack_blocked'),victim=e.summary.sessions[0];
 assert.ok(end.seq<start.seq&&start.seq<done.seq&&done.seq<blocked.seq&&blocked.seq<o.seq,'overload_order');assert.equal(start.victim,victim.id);assert.equal(start.adapter,victim.adapter);assert.equal(start.epoch,victim.epoch);assert.equal(start.stream,victim.stream);assert.equal(done.victim,victim.id);assert.equal(blocked.victim,victim.id);assert.ok(blocked.droppedAcks>0);
 const burst="for j in $(seq 1 40); do head -c 32768 /dev/zero | tr '\\000' Z; sleep 0.1; done";
 const command=(lo,hi,text)=>{const send=e.events.find(v=>v.seq>lo&&v.seq<hi&&v.type==='mcp'&&v.index===victim.adapter&&v.name==='send_text'&&v.args.session_id===victim.id&&v.args.text===text&&v.response.result==='delivered');assert.ok(send,'overload_command_missing');const enter=e.events.find(v=>v.seq>send.seq&&v.seq<hi&&v.type==='mcp'&&v.index===victim.adapter&&v.name==='send_key'&&v.args.session_id===victim.id&&v.args.key==='Enter'&&v.response.result==='delivered');assert.ok(enter,'overload_enter_missing');return enter;};
 const enter=command(start.seq,done.seq,burst+"; printf '\\nCONTROL_DONE\\n'");command(blocked.seq,o.seq,burst);
 let cursor=start.cursor,z=0,tail='';const reads=e.events.filter(v=>v.seq>enter.seq&&v.seq<done.seq&&v.type==='mcp'&&v.name==='read_output');assert.ok(reads.length,'overload_control_reads');
 assert.equal(start.cursor,e.output.filter(v=>v.session===victim.id&&v.t<=start.t).at(-1).response.next_cursor,'overload_initial_cursor');
 for(const v of reads){assert.equal(v.index,victim.adapter);assert.equal(v.args.session_id,victim.id);assert.equal(v.args.control_epoch,victim.epoch);assert.equal(v.args.stream_id,victim.stream);assert.equal(v.args.cursor,cursor);assert.ok(v.response.oldest_cursor<=cursor&&Number.isSafeInteger(v.response.next_cursor)&&v.response.next_cursor>=cursor);cursor=v.response.next_cursor;z+=(v.response.text.match(/Z/g)??[]).length;tail=(tail+v.response.text).slice(-65536);}
 assert.equal(done.cursor,cursor);assert.ok(z>=1310720&&tail.includes('CONTROL_DONE'),'overload_control_payload');
 const latest=(s,lo,hi)=>e.events.filter(v=>v.seq>lo&&v.seq<hi&&v.type==='mcp'&&v.name==='status'&&v.index===s.adapter).at(-1)?.response.sessions.find(p=>p.session_id===s.id);
 assert.equal(latest(victim,start.seq,done.seq)?.state,'agent_owned','control_not_alive');assert.equal(latest(victim,blocked.seq,o.seq)?.state,'closed','victim_not_closed');
 for(const s of e.summary.sessions.slice(1))assert.equal(latest(s,blocked.seq,o.seq)?.state,'agent_owned','other_not_alive');
}
export function verifyEvidence(e){
 const result={evidenceValid:false,scopePassed:false,preflightPassed:false,phase5Acceptance:false,combinedTransitionMemory:'unverified',errors:[],metrics:{}};
 try{
  const s=e.summary,c=resolveContract(s.scope,s.profile);assert.ok(s.finishedUtc,'unfinished');assert.equal(compareIdentity(s,s).same,true,'identity_missing');
  assert.equal(s.connections.length,32);assert.equal(new Set(s.connections).size,32);assert.equal(s.sessions.length,16);assert.equal(new Set(s.sessions.map(s=>s.id)).size,16);assert.deepEqual(s.sessions.map(s=>s.index).sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i));
  assert.equal(s.fixtures.length,2);for(const f of s.fixtures){assert.equal(f.image,s.imageId,'fixture_image');assert.equal(f.removed,true,'fixture_not_removed');}
  let last=-Infinity;for(let i=0;i<e.events.length;i++){const v=e.events[i];assert.equal(v.seq,i+1,'event_sequence');assert.equal(v.owner,s.owner);assert.equal(v.scope,s.scope);assert.ok(Number.isFinite(v.t)&&v.t>=last,'event_time');last=v.t;}
  const starts=e.events.filter(v=>v.type==='measurement_start'),ends=e.events.filter(v=>v.type==='measurement_end');assert.equal(starts.length,1);assert.equal(ends.length,1);const [start]=starts,[end]=ends;
  const duration=(end.t-start.t)/1000;assert.ok(duration>0);assert.ok(Math.abs(duration-s.elapsedSeconds)<1,'elapsed_mismatch');assert.equal(e.boundary.elapsedSeconds,s.elapsedSeconds);assert.equal(e.boundary.eventSeq,end.seq);assert.equal(e.boundary.samples,e.memory.length);
  const shutdown=e.events.filter(v=>v.type==='shutdown');assert.equal(shutdown.length,1);assert.ok(shutdown[0].t>end.t);assert.equal(shutdown[0].exit.code,0);validateShutdown(shutdown[0].process,shutdown[0].eofs);validateShutdown(e.process,shutdown[0].eofs);assert.deepEqual(shutdown[0].process,e.process,'shutdown_receipt');assert.deepEqual(e.cleanup.process,e.process,'cleanup_receipt');
  assert.equal(e.cleanup.owner,s.owner);for(const key of ['normalExit','forcedCleanup','remainingProcesses','remainingContainers','failures'])assert.deepEqual(e.cleanup[key],s.cleanup[key],'cleanup_summary');
  assert.equal(e.cleanup.normalExit,true);assert.equal(e.cleanup.forcedCleanup,false);assert.equal(e.cleanup.remainingProcesses,0);assert.equal(e.cleanup.remainingContainers,0);assert.deepEqual(e.cleanup.failures,[]);assert.deepEqual(e.cleanup.remaining,[]);assert.deepEqual(e.cleanup.containers,[]);assert.deepEqual(e.cleanup.fixtures,s.fixtures);
  const rounds=s.scope==='N'?2:c.rounds;verifyAudits(e,rounds,start,end);result.metrics.rates=verifyOutput(e,start,end);
  const health=e.events.filter(v=>v.type==='health'&&v.t>=start.t&&v.t<=end.t);assert.equal(health.length,rounds,'health_rounds');for(const row of health){assert.equal(row.values.length,32);row.values.forEach((p,i)=>{assert.equal(p.app_state,'online');assert.equal(p.connection_id,s.connections[i]);});}
  if(s.scope==='M'||s.scope==='N'){
   for(const key of ['forcedGcCalls','jsProbes','rawCdpSessions'])assert.equal(s.instrumentation[key],0,'instrumentation_'+key);
   assert.ok(e.events.some(v=>v.type==='browser_disconnected'&&v.t<=start.t),'browser_not_disconnected');assert.ok(!e.events.some(v=>v.type==='browser_attached'&&v.t>start.t&&v.t<end.t),'browser_reattached');
   verifyMemory(e,s.scope==='M'?c.seconds:duration);
  }
  if(s.scope==='M'){
   assert.ok(s.elapsedSeconds>=c.seconds,'duration');assert.equal(e.events.filter(v=>v.type==='transition'||v.type==='binding').length,0,'static_ui_changed');
   for(const h of health)for(const session of s.sessions){const p=h.values[session.index].sessions.find(p=>p.session_id===session.id);assert.ok(p);assert.equal(p.state,'agent_owned');assert.equal(p.control_epoch,session.epoch);assert.equal(p.stream_id,session.stream);}
   const overload=e.events.filter(v=>v.type==='overload');assert.equal(overload.length,1);const o=overload[0];assert.ok(o.t>end.t);assert.equal(o.controlBurstPassed,true);assert.equal(o.burstBytes,1310720);assert.equal(o.state,'closed');assert.equal(o.unaffectedAlive,15);assert.ok(o.droppedAcks>0);
   verifyOverload(e,end,o);
   if(c.profile==='full')result.metrics.memory=memoryVerdict(e.memory,s.elapsedSeconds);
  }else{
   const records=e.events.filter(v=>v.type==='transition');verifyRounds(records,rounds,s.sessions,s.connections);verifyTransitionRaw(e,records);
   if(s.scope==='N'){
    assert.ok(duration<=900);assert.deepEqual(records.map(r=>r.windowMode),['restored','maximized']);
    verifyNative(e,records);
    const native=e.events.filter(v=>v.type==='native');for(let round=0;round<2;round++)for(const action of ['window_mode','select','resize','reclaim','choose_connection','handoff']){
     const matches=native.filter(v=>v.request.round===round&&v.request.action===action);assert.equal(matches.length,1,'native_receipt');const v=matches[0],q=v.request;assert.equal(q.owner,s.owner);assert.equal(v.response.id,q.id);assert.equal(v.response.owner,s.owner);assert.equal(v.response.status,'performed');assert.ok(q.inputStartedAt>=q.issuedAt);assert.equal(q.verifyDeadline,Math.min(q.inputStartedAt+45000,q.expiresAt));assert.ok(v.verifiedAt>=q.inputStartedAt&&v.verifiedAt<=q.verifyDeadline);assert.equal(v.observation.verified,true);assert.ok(v.response.observation.screenshotId);
    }
   }
  }
  result.evidenceValid=true;
  if(s.scope!=='N'&&result.metrics.rates.some(r=>r.bytesPerSecond<1024))result.errors.push('output_rate_below_1KiB_s');
  if(result.metrics.memory?.passed===false)result.errors.push('memory_growth_over_20_percent');
  if(s.status==='failed'||s.failure)result.errors.push(s.failure??'runner_failed');
  result.scopePassed=c.scopeEligible&&result.errors.length===0;result.preflightPassed=!c.scopeEligible&&result.errors.length===0;
  result.scope=s.scope;result.profile=s.profile;result.resultName=result.scopePassed?({M:'detached_static_load_passed',F:'transition_cycles_passed',N:'native_cases_passed'})[s.scope]:result.preflightPassed?'preflight_passed':'failed';
 }catch(error){result.errors.push(error.message);}
 return result;
}
export async function verifyDirectory(out,comparisons=[]){
 let result;
 try{
  try{await access(join(out,'verified.json'));throw Error('verified_file_already_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
  const evidence=await loadEvidence(out);result=verifyEvidence(evidence);
  for(const [p,hash] of Object.entries(evidence.summary.sources))assert.equal(await sha256(join(root,p)),hash,'source_changed_'+p);
  for(const b of Object.values(evidence.summary.binaries))assert.equal(await sha256(b.path),b.sha256,'binary_changed');
  for(const other of comparisons){const peer=await loadEvidence(other);assert.equal(compareIdentity(evidence.summary,peer.summary).same,true,'comparison_identity_mismatch');}
  result.summarySha256=await sha256(join(out,'summary.json'));
 }catch(error){result??={evidenceValid:false,scopePassed:false,preflightPassed:false,phase5Acceptance:false,combinedTransitionMemory:'unverified',errors:[]};result.evidenceValid=false;result.scopePassed=false;result.preflightPassed=false;result.errors.push(error.message);}
 result.verifiedUtc=new Date().toISOString();await writeFile(join(out,'verification.json'),JSON.stringify(result,null,2)+'\n');
 if(result.evidenceValid&&(result.scopePassed||result.preflightPassed))await writeFile(join(out,'verified.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.ok(process.argv[2],'usage: verify.mjs evidence-dir [comparison-dir...]');const result=await verifyDirectory(resolve(process.argv[2]),process.argv.slice(3).map(p=>resolve(p)));console.log(JSON.stringify(result,null,2));if(!result.scopePassed&&!result.preflightPassed)process.exitCode=1;
}
