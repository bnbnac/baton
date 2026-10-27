// Adapted from minimal-cdp-cadence/verify.mjs at b977593; historical verifier stays immutable.
import assert from 'node:assert/strict';
import {readFile,writeFile,open} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

import {selectOwnedTarget,digest} from '../minimal-cdp-cadence/cdp.mjs';
import {domExpression} from '../minimal-cdp-cadence/dom.mjs';
import {validateAttachedSample,validateDebugger} from '../minimal-cdp-cadence/sampling.mjs';
import {commonSources,diagnosticSources} from '../minimal-cdp-cadence/run.mjs';
import {LogOracle} from '../soak-oracle.mjs';
import {verifyTransition} from '../separated/transitions.mjs';
import {validateShutdown,assertProcessIdentity,sha256} from '../separated/runtime.mjs';
import {compareIdentity} from '../separated/contract.mjs';
const only=(rows,label)=>{assert.equal(rows.length,1,label);return rows[0];};
const same=assert.deepEqual;
const binding=s=>({session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream});
function errorDetails(d){
 assert.ok(d&&typeof d==='object'&&!Array.isArray(d),'missing_cdp_error_details');assert.equal(typeof d.truncated,'boolean');assert.ok(Buffer.byteLength(JSON.stringify(d))<=4096,'cdp_error_size');
 const text=(v,n)=>assert.ok(typeof v==='string'&&v.length<=n,'cdp_error_text');
 if(d.kind==='protocol'){same(Object.keys(d).sort(),['kind','code','message','truncated'].sort());assert.ok(d.code===null||Number.isSafeInteger(d.code));text(d.message,512);}
 else{assert.equal(d.kind,'javascript');same(Object.keys(d).sort(),['kind','text','description','lineNumber','columnNumber','truncated'].sort());text(d.text,128);text(d.description,384);for(const key of ['lineNumber','columnNumber'])assert.ok(d[key]===null||(Number.isSafeInteger(d[key])&&d[key]>=0));}
}

function cdpEvidence(e,start,end,starts){
 const {events,summary:s}=e,trace=events.filter(v=>v.type==='cdp');same(e.cdp,trace,'raw_cdp_mismatch');
 const opened=only(trace.filter(v=>v.kind==='open'),'cdp_open'),closed=only(trace.filter(v=>v.kind==='closed'),'cdp_close');
 same(selectOwnedTarget([opened.target],s.debugPort),s.cdpTarget,'cdp_target');assert.ok(opened.seq<start.seq&&closed.seq>end.seq,'cdp_boundaries');
 const endpoint=only(events.filter(v=>v.type==='cdp_endpoint'),'cdp_endpoint');assert.ok(endpoint.seq<opened.seq);assertProcessIdentity(e.process,endpoint.ownership);
 for(const p of endpoint.ownership.descendants)assert.ok(e.process.descendants.some(v=>v.pid===p.pid&&String(v.startedTicks)===String(p.startedTicks)&&v.dataDirectoryMatch),'foreign_endpoint_owner');
 validateDebugger(endpoint.debugPort,endpoint.ownership,s.debugPort,0);
 const reqs=trace.filter(v=>v.kind==='request'),actions=events.filter(v=>v.type==='cdp_action'),aborts=events.filter(v=>v.type==='cdp_action_aborted');let previous=opened.seq,evals=0,queries=0,failed=false;
 assert.ok(aborts.length<=1,'multiple_action_aborts');
 for(const d of [...trace.filter(v=>v.kind==='disconnected'),...aborts]){
  assert.equal(s.status,'failed','connection_or_action_failure');assert.ok(d.reason&&d.seq>opened.seq&&d.seq<closed.seq);
  assert.ok(!events.some(v=>v.seq>d.seq&&['cdp_action','transition','arm_round_end','arm_round_start'].includes(v.type)),'success_after_abort');
  assert.ok(!reqs.some(v=>v.seq>d.seq),'request_after_abort');
 }
 assert.ok(trace.filter(v=>v.kind==='disconnected').length<=1,'duplicate_disconnect');
 const expected=[];expected.push({method:'Network.disable',round:-1});expected.push({action:'identity',round:-1,args:{sessionId:s.sessions.find(v=>v.index===0).id}});
 for(const r of starts)for(const action of s.arm==='A'?Array(6).fill('identity'):['select','identity','resize','reclaim','choose_connection','handoff'])expected.push({action,round:r.round});
 assert.ok(reqs.length>=2&&reqs.length<=expected.length,'cdp_request_count');
 for(const [i,q] of reqs.entries()){
  assert.equal(q.id,i+1,'cdp_id');assert.ok(q.seq>previous&&!failed,'cdp_request_order');assert.ok(q.at>=s.clockOrigin&&q.at<=s.clockOrigin+q.t&&q.at<q.deadline,'cdp_request_time');
  const ex=expected[i];assert.equal(q.round,ex.round);assert.equal(q.method,ex.method??'Runtime.evaluate','cdp_method');assert.equal(q.action,ex.action);
  const round=starts[q.round],cap=round?.deadline??s.clockOrigin+900000;assert.ok(q.deadline<=cap,'cdp_deadline');if(round)assert.ok(q.seq>round.seq,'cdp_before_round');
  if(q.method==='Runtime.evaluate'){
   evals++;if(q.action==='identity')queries++;assert.equal(q.expressionSha256,digest(domExpression(q.action,q.args)),'expression_hash');assert.ok(Number.isFinite(q.timeout)&&q.timeout>0,'evaluate_timeout');
   if(ex.args)same(q.args,ex.args);else{
    assert.equal(q.args.sessionId,round.binding.session,'cdp_session');if(q.action==='select')assert.equal(q.args.label,`soak-${String(round.index).padStart(2,'0')}`);
    if(['choose_connection','handoff'].includes(q.action))assert.equal(q.args.connectionId,s.connections[(round.binding.adapter+16)%32],'cdp_connection');
   }
  }
  const responses=trace.filter(v=>v.kind==='response'&&v.id===q.id),failures=trace.filter(v=>v.kind==='failure'&&v.id===q.id);assert.ok(responses.length<=1&&failures.length<=1&&responses.length+failures.length>=1,'cdp_outcome');
  const response=responses[0],failure=failures[0];
  const dispatches=trace.filter(v=>v.kind==='dispatch'&&v.id===q.id);assert.ok(dispatches.length<=1,'dispatch_count');const dispatch=dispatches[0];
  if(dispatch){assert.ok(dispatch.seq>q.seq&&dispatch.at>=q.at&&dispatch.at<q.deadline&&dispatch.at<=s.clockOrigin+dispatch.t,'dispatch_time');if(q.action)assert.ok(dispatch.timeout>0&&dispatch.timeout<=Math.min(q.timeout,q.deadline-dispatch.at),'dispatch_timeout');}
  if(response||failure?.uncertain)assert.ok(dispatch,'missing_dispatch');
  for(const out of [...responses,...failures])assert.ok(out.seq>(dispatch??q).seq&&out.seq<closed.seq&&out.at>=(dispatch??q).at&&out.at<=s.clockOrigin+out.t,'cdp_outcome_time');
  if(failure){assert.ok(typeof failure.uncertain==='boolean'&&failure.reason);if(failure.reason==='cdp_response_error')errorDetails(failure.details);else assert.equal(failure.details,undefined,'unexpected_cdp_error_details');failed=true;assert.equal(i,reqs.length-1,'request_after_failure');}
  if(response){assert.ok(response.at<=q.deadline,'late_cdp_response');assert.ok(!response.result?.exceptionDetails&&!response.result?.error,'cdp_exception');}
  const nextRequest=reqs[i+1]?.seq??closed.seq;
  const matches=actions.filter(v=>v.seq>q.seq&&v.seq<nextRequest&&v.action===q.action&&v.round===q.round),abort=aborts.find(v=>v.seq>q.seq&&v.seq<nextRequest&&v.action===q.action&&v.round===q.round);
  if(abort){assert.equal(matches.length,0);same(abort.args,q.args);assert.ok(abort.seq>(failure??response).seq&&abort.seq<closed.seq);failed=true;previous=abort.seq;assert.equal(i,reqs.length-1);}
  else if(!failure&&q.action){
   const a=only(matches,'cdp_action');assert.ok(a.seq>response.seq&&a.seq<closed.seq&&s.clockOrigin+a.t<=cap,'late_cdp_action');same(a.args,q.args);same(a.result,response.result.result?.value,'cdp_value');assert.equal(a.result.sessionId,q.args.sessionId);
   if(q.args.connectionId)assert.equal(a.result.connectionId,q.args.connectionId);if(q.action==='resize')assert.equal(a.result.width,q.args.width);
   previous=a.seq;
  }else{assert.equal(matches.length,0,'action_without_response');previous=(failure??response).seq;}
 }
 for(const a of aborts)if(!reqs.some(q=>q.action===a.action&&q.round===a.round)){const ex=expected[reqs.length];assert.ok(ex&&ex.action===a.action&&ex.round===a.round,'orphan_abort');assert.ok(a.seq>previous);domExpression(a.action,a.args);assert.equal(a.args.sessionId,starts[a.round]?.binding.session??s.sessions.find(v=>v.index===0).id);}
 for(const t of trace){assert.ok(['open','closed','request','dispatch','response','failure','event','disconnected'].includes(t.kind),'cdp_kind');if(['dispatch','response','failure'].includes(t.kind))assert.ok(reqs.some(q=>q.id===t.id),'orphan_response');if(t.kind==='event')assert.ok(!t.method.startsWith('Network.'),'unexpected_network_event');}
 for(const a of actions)assert.ok(reqs.some((q,i)=>q.action===a.action&&q.round===a.round&&a.seq>q.seq&&a.seq<(reqs[i+1]?.seq??closed.seq)),'orphan_action');
 assert.equal(s.instrumentation.evaluateCalls,evals);assert.equal(s.instrumentation.domQueries,queries);assert.equal(s.instrumentation.domActions,evals-queries);
 assert.ok(!events.some(v=>v.type==='shutdown'&&v.seq<closed.seq),'shutdown_before_detach');return actions;
}

function failureObservation(e,end){
 const {events,summary:s}=e,rows=events.filter(v=>v.type==='failure_status');
 if(s.status!=='failed'){assert.equal(rows.length,0);assert.equal(s.failureObservation,undefined);return null;}
 const begin=only(events.filter(v=>v.type==='failure_observation_start'),'failure_observation_start'),finish=only(events.filter(v=>v.type==='failure_observation_end'),'failure_observation_end');
 const closed=only(events.filter(v=>v.type==='cdp'&&v.kind==='closed'),'cdp_close'),shutdown=only(events.filter(v=>v.type==='shutdown'),'shutdown');
 assert.ok(begin.seq>end.seq&&begin.seq>closed.seq&&finish.seq>begin.seq&&finish.seq<shutdown.seq);assert.equal(begin.deadline,begin.startedAt+15000);assert.ok(begin.startedAt<=s.clockOrigin+begin.t);
 assert.equal(rows.length,32);let observed=0,previous=begin.seq,lastAttempt=begin.startedAt;
 for(const [index,row] of rows.entries()){
  assert.equal(row.index,index);assert.ok(row.seq>previous&&row.seq<finish.seq&&row.attemptedAt>=lastAttempt&&row.attemptedAt<=s.clockOrigin+row.t);lastAttempt=row.attemptedAt;
  const raw=events.filter(v=>v.type==='mcp'&&v.name==='status'&&v.index===index&&v.seq>previous&&v.seq<row.seq);
  if(row.attempted){assert.ok(row.attemptedAt<=begin.deadline-5000,'late_status_query');if(row.response){observed++;same(only(raw,'raw_failure_status').response,row.response);assert.equal(row.response.connection_id,s.connections[index]);assert.ok(Array.isArray(row.response.sessions));
    for(const p of row.response.sessions){assert.ok(s.sessions.some(v=>v.id===p.session_id),'foreign_failure_session');assert.ok(typeof p.state==='string'&&Number.isSafeInteger(p.control_epoch));assert.ok(p.stream_id===null||typeof p.stream_id==='string');}
   }else{assert.ok(row.error&&raw.length===0,'unrecorded_status_result');}}
  else{assert.equal(row.error,'observation_budget');assert.ok(row.attemptedAt>begin.deadline-5000&&raw.length===0);}
  previous=row.seq;
 }
 const result={startedAt:begin.startedAt,deadline:begin.deadline,finishedAt:finish.finishedAt,observed,complete:observed===32};same(s.failureObservation,result);for(const [key,value] of Object.entries(result))same(finish[key],value);
 assert.ok(finish.finishedAt>=lastAttempt&&finish.finishedAt<=s.clockOrigin+finish.t);
 assert.ok(!events.some(v=>v.seq>begin.seq&&v.seq<shutdown.seq&&v.type==='mcp'&&v.name!=='status'),'input_after_failure');
 return {complete:result.complete,observed,observations:rows.map(({index,response,error})=>({index,...(response?{response}:{error})}))};
}

function transitions(e,starts,ends,actions){
 const {events,summary:s}=e,state=new Map(),seenStreams=new Set();
 for(const session of s.sessions){const initial=only(events.filter(v=>v.type==='session_ready'&&v.id===session.id),'initial_session');assert.equal(initial.index,session.index);assert.equal(initial.adapter,initial.index);state.set(session.id,binding(initial));assert.ok(!seenStreams.has(initial.stream));seenStreams.add(initial.stream);}
 const rows=events.filter(v=>v.type==='transition');
 if(s.arm==='A'){assert.equal(rows.length,0,'static_transition');assert.equal(events.filter(v=>v.type==='binding'||v.type==='transition_boundary').length,0,'static_binding');return [];}
 assert.ok(rows.length>=ends.length&&rows.length<=starts.length);
 for(const [i,r] of rows.entries()){
  const start=starts[i];assert.equal(r.round,i);assert.equal(r.index,i%16);same(r.before,start.binding);same(r.before,state.get(r.before.session),'binding_chain');verifyTransition(r);
  assert.equal(r.adapter,(r.before.adapter+16)%32);assert.equal(r.targetConnection,s.connections[r.adapter]);assert.equal(r.oldOwner.connection_id,s.connections[r.before.adapter]);assert.ok(!seenStreams.has(r.assigned.session.stream_id),'reused_stream');seenStreams.add(r.assigned.session.stream_id);
  assert.ok(r.seq>start.seq&&s.clockOrigin+r.t<=start.deadline,'late_transition');const byAction={};
  for(const name of ['select','identity','resize','reclaim','choose_connection','handoff']){const a=only(actions.filter(v=>v.round===i&&v.action===name),'transition_action');assert.ok(a.seq>start.seq&&a.seq<r.seq);byAction[name]=a;}
  assert.equal(byAction.resize.args.width,r.width);const between=events.filter(v=>v.seq>start.seq&&v.seq<r.seq),statuses=between.filter(v=>v.type==='mcp'&&v.name==='status');
  const geom=(v,g)=>v.index===r.before.adapter&&v.response.sessions.some(p=>p.session_id===r.before.session&&p.state==='agent_owned'&&p.control_epoch===r.before.epoch&&p.stream_id===r.before.stream&&isDeepStrictEqual(p.geometry,g));
  const selected=statuses.filter(v=>v.seq>byAction.identity.seq&&v.seq<byAction.resize.seq&&geom(v,r.selected.geometry));assert.ok(selected.length>=2&&selected.at(-1).t-selected[0].t>=750,'raw_selected_geometry');
  assert.ok(statuses.some(v=>v.seq>byAction.resize.seq&&v.seq<byAction.reclaim.seq&&geom(v,r.resized.geometry)),'raw_resized_geometry');
  const remote=only(between.filter(v=>v.type==='remote_geometry'&&v.round===i&&v.session===r.before.session),'raw_stty');assert.ok(remote.seq>byAction.resize.seq&&remote.seq<byAction.reclaim.seq);assert.equal(remote.remote,r.remote);same(remote.geometry,r.resized.geometry);
  for(const [action,index,expected] of [['reclaim',r.before.adapter,r.reclaimed],['handoff',r.adapter,r.assigned.session]])assert.ok(statuses.some(v=>v.seq>byAction[action].seq&&v.index===index&&v.response.sessions.some(p=>isDeepStrictEqual(p,expected))),'raw_'+action);
  const release=statuses.find(v=>v.seq>byAction.handoff.seq&&v.index===r.before.adapter&&v.response.connection_id===r.oldOwner.connection_id&&isDeepStrictEqual(v.response.sessions,r.oldOwner.sessions));assert.ok(release,'raw_release');
  const b=only(between.filter(v=>v.type==='binding'&&v.session===r.before.session),'raw_binding');assert.ok(b.seq>release.seq);const after={adapter:r.adapter,epoch:r.assigned.session.control_epoch,stream:r.assigned.session.stream_id};same(b.after,after);state.set(r.before.session,{session:r.before.session,...after});
  assert.ok(e.output.some(v=>v.session===r.before.session&&v.stream===after.stream&&v.t>=b.t&&v.response.text?.includes('SOAK:')),'new_stream_output');
 }
 for(const b of events.filter(v=>v.type==='binding')){const prev=events.filter(v=>v.type==='binding'&&v.session===b.session&&v.seq<b.seq).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===b.session);assert.ok(prev);same({adapter:b.before.adapter,epoch:b.before.epoch,stream:b.before.stream},{adapter:prev.adapter,epoch:prev.epoch,stream:prev.stream});assert.equal(b.after.adapter,(b.before.adapter+16)%32);assert.ok(b.after.epoch>b.before.epoch&&b.after.stream!==b.before.stream);}
 for(const session of s.sessions){const b=events.filter(v=>v.type==='binding'&&v.session===session.id).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===session.id);same({adapter:session.adapter,epoch:session.epoch,stream:session.stream},{adapter:b.adapter,epoch:b.epoch,stream:b.stream},'final_binding');}
 return rows;
}

function auditsAndHealth(e,starts,ends){
 const {events,summary:s}=e;assert.equal(e.audits.length,16);assert.equal(new Set(e.audits.map(v=>v.index)).size,16);const partial=[];
 // Compare from RPCs to fixture effects as well as fixture effects to RPCs.
 // Otherwise a missing effect in an unfinished round would vanish silently.
 const pending=[];
 for(const start of starts)for(const session of s.sessions){
  const token=`AUDIT_${session.index}_${start.round}`,text=`printf '%s\\n' '${token}' >> /tmp/soak-audit-${session.index}`;
  const limit=starts[start.round+1]?.seq??events.find(v=>v.type==='measurement_end').seq;
  const sends=events.filter(v=>v.type==='mcp'&&v.name==='send_text'&&v.args.session_id===session.id&&v.args.text===text&&v.seq>start.seq&&v.seq<limit);
  if(!sends.length)continue;
  const nextText=events.find(v=>v.type==='mcp'&&v.name==='send_text'&&v.args.session_id===session.id&&v.seq>sends.at(-1).seq);
  const enter=events.find(v=>v.type==='mcp'&&v.name==='send_key'&&v.args.session_id===session.id&&v.args.key==='Enter'&&v.seq>sends.at(-1).seq&&v.seq<Math.min(limit,nextText?.seq??Infinity));
  const actual=e.audits.find(a=>a.index===session.index)?.actual??[];
  if(enter?.response.result==='delivered')assert.ok(actual.includes(token),'delivered_audit_effect_missing');
  else{assert.ok(!actual.includes(token),'unproven_audit_effect');pending.push({index:session.index,round:start.round,token,textResponses:sends.length,enterResult:enter?.response??null,effect:'not_observed'});}
 }
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
 return {partial,pending};
}

function outputEvidence(e,start,end){
 const rates=[];
 for(const row of e.output)assert.ok(e.summary.sessions.some(s=>s.id===row.session&&s.index===row.index),'foreign_output');
 for(const s of e.summary.sessions){
  const oracle=new LogOracle(s.index);let stream=null,cursor=0,records=0,previous=-Infinity,privateStart=null,privateMs=0;
  const history=e.events.filter(v=>v.type==='binding'&&v.session===s.id);let h=0,b=e.events.find(v=>v.type==='session_ready'&&v.id===s.id);
  for(const row of e.output.filter(v=>v.session===s.id)){
   assert.ok(row.t>=previous);previous=row.t;while(history[h]?.t<=row.t)b=history[h++].after;
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
  assert.ok(Number.isFinite(sample.elapsed)&&sample.elapsed>=previous&&sample.elapsed<duration,'sample_boundary');assert.ok(sample.elapsed-previous<=45,'sample_gap');previous=sample.elapsed;
  validateAttachedSample(sample);assert.equal(sample.debugPort.port,e.summary.debugPort);
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


export function commandEvidence(e,start,end,starts){
 const groups=new Map(),ids=new Map(),{summary:s,events}=e;
 const rows=events.filter(v=>v.type==='mcp'&&v.seq>start.seq&&v.seq<end.seq);
 const groupFor=(q,round)=>{
  const session=s.sessions.find(v=>v.id===q.args.session_id);assert.ok(session,'input_session');
  const audit=`printf '%s\\n' 'AUDIT_${session.index}_${round.round}' >> /tmp/soak-audit-${session.index}`;
  const stty=`stty size > /tmp/separated-size-${session.index}-${round.round}`;
  const kind=q.args.text===audit?'audit':s.arm==='B'&&round.index===session.index&&q.args.text===stty?'stty':null;
  assert.ok(kind,'unplanned_input');const id=`${round.round}:${session.index}:${kind}`;
  if(!groups.has(id))groups.set(id,{round:round.round,index:session.index,kind,text:[],keys:[]});return groups.get(id);
 };
 for(const q of rows){
  assert.ok(['status','read_output','send_text','send_key'].includes(q.name),'unplanned_tool');
  if(!['send_text','send_key'].includes(q.name))continue;
  const round=starts.find((p,i)=>q.seq>p.seq&&q.seq<(starts[i+1]?.seq??end.seq));assert.ok(round,'input_outside_round');assert.ok(s.clockOrigin+q.t<=round.deadline,'late_input');
  const b=events.filter(v=>v.type==='binding'&&v.session===q.args.session_id&&v.seq<q.seq).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===q.args.session_id);
  assert.ok(b);assert.equal(q.index,b.adapter);assert.equal(q.args.control_epoch,b.epoch);assert.ok(q.args.request_id);
  const id=q.index+':'+q.args.request_id,identity={name:q.name,args:q.args};if(ids.has(id))same(ids.get(id),identity,'reused_request_id');else ids.set(id,identity);
  if(q.name==='send_text')groupFor(q,round).text.push(q);
  else{
   assert.equal(q.args.key,'Enter','unplanned_key');
   const text=rows.filter(v=>v.name==='send_text'&&v.args.session_id===q.args.session_id&&v.seq<q.seq&&v.seq>round.seq).at(-1);assert.ok(text,'key_without_text');groupFor(text,round).keys.push(q);
  }
 }
 for(const g of groups.values()){assert.ok(g.text.length<=(g.kind==='audit'?2:1),'extra_text');assert.ok(g.keys.length<=1,'extra_enter');}
 for(const transition of events.filter(v=>v.type==='transition')){
  const group=groups.get(`${transition.round}:${transition.index}:stty`);assert.ok(group,'missing_stty_command');assert.equal(group.text.length,1);assert.equal(group.keys.length,1);
  const remote=only(events.filter(v=>v.type==='remote_geometry'&&v.round===transition.round),'stty_observation');
  for(const q of [...group.text,...group.keys]){assert.equal(q.response.result,'delivered');assert.ok(q.seq<remote.seq);}
 }
 for(const health of events.filter(v=>v.type==='health'&&v.seq>start.seq&&v.seq<end.seq)){
  const seen=new Set();
  for(const [index,p] of health.values.entries())for(const session of p.sessions){
   assert.ok(!seen.has(session.session_id),'duplicate_health_owner');seen.add(session.session_id);
   const b=events.filter(v=>v.type==='binding'&&v.session===session.session_id&&v.seq<health.seq).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===session.session_id);
   assert.ok(b,'foreign_health_session');assert.equal(b.adapter,index);assert.equal(session.state,'agent_owned');assert.equal(session.control_epoch,b.epoch);assert.equal(session.stream_id,b.stream);
  }
  assert.equal(seen.size,16,'health_session_count');
 }
}
export {cdpEvidence,failureObservation,transitions,auditsAndHealth,outputEvidence,memoryEvidence};
