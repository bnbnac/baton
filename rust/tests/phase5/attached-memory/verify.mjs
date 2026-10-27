import assert from 'node:assert/strict';
import {readFile,writeFile,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {root} from '../separated/run.mjs';
import {validateShutdown,sha256,assertProcessIdentity} from '../separated/runtime.mjs';
import {compareIdentity} from '../separated/contract.mjs';
import {commonSources} from '../minimal-cdp-cadence/run.mjs';
import {validateAttachedSample} from '../minimal-cdp-cadence/sampling.mjs';
import {resolveArm,slot,memoryResult} from './policy.mjs';
import {diagnosticSources} from './run.mjs';
import {staticState} from './scenario.mjs';
import {cdpEvidence,failureObservation,transitions,auditsAndHealth,outputEvidence,memoryEvidence,commandEvidence} from './verify-trace.mjs';

export const RAW_FILES=['events.jsonl','output.jsonl','memory.jsonl','memory-post.jsonl','cdp.jsonl','normal-boundary.json','audit-observations.json','process.json','final-cleanup.json'];
const only=(rows,label)=>{assert.equal(rows.length,1,label);return rows[0];};
const same=assert.deepEqual;
const empty=s=>({evidenceValid:false,workloadPassed:false,memoryPassed:null,arm:s?.arm??null,profile:s?.profile??null,completedRounds:0,metrics:{},errors:[],phase5Acceptance:false});
export function validateArmIdentity(s,baselines,extras){
 same(s.cadenceBaselines.map(p=>p.scope),['M','F']);assert.equal(baselines.length,2);let expected;
 for(const [i,b] of s.cadenceBaselines.entries()){
  const actual=baselines[i],peer=actual.summary,saved=actual.receipt;
  assert.equal(actual.evidence,b.evidence);assert.equal(actual.summarySha256,b.summarySha256);assert.equal(saved.summarySha256,b.summarySha256);assert.equal(actual.receiptSha256,b.receiptSha256);assert.equal(saved.preflightPassed,true);assert.equal(peer.scope,b.scope);same(b.sources,peer.sources);
  const sources=commonSources(s.sources,peer.sources);assert.equal(compareIdentity({...s,sources},peer).same,true,'baseline_identity');
  const keys=[...Object.keys(sources),...extras].sort();if(expected)same(keys,expected);else expected=keys;
 }
 same(Object.keys(s.sources).sort(),expected,'source_manifest_keys');return expected;
}

export function verifyArmEvidence(e){
 const s=e.summary,v=empty(s);
 try{
  const c=resolveArm(s.arm,s.profile);same(s.contract,c);assert.equal(s.scope,'AM');assert.equal(s.phase5Acceptance,false);assert.ok(s.finishedUtc);assert.ok(Number.isFinite(s.clockOrigin));
  assert.equal(s.sessions.length,16);same(s.sessions.map(p=>p.index).sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i));assert.equal(new Set(s.sessions.map(p=>p.id)).size,16);
  assert.equal(s.connections.length,32);assert.equal(new Set(s.connections).size,32);assert.equal(s.fixtures.length,2);
  let previous=-Infinity;for(const [i,row] of e.events.entries()){assert.equal(row.seq,i+1);assert.equal(row.owner,s.owner);assert.equal(row.scope,'AM');assert.ok(Number.isFinite(row.t)&&row.t>=previous,'event_clock');previous=row.t;}
  const start=only(e.events.filter(p=>p.type==='measurement_start'),'measurement_start'),end=only(e.events.filter(p=>p.type==='measurement_end'),'measurement_end');
  assert.ok(start.t>=0&&start.t<=900000,'preparation_duration');assert.ok(end.t>start.t);same(e.boundary.eventSeq,end.seq);assert.equal(s.elapsedSeconds,(end.t-start.t)/1000);assert.equal(e.boundary.elapsedSeconds,s.elapsedSeconds);assert.equal(e.boundary.samples,e.memory.length);
  assert.ok(e.events.some(p=>p.type==='browser_disconnected'&&p.seq<start.seq));assert.ok(!e.events.some(p=>p.type==='browser_attached'&&p.seq>start.seq),'browser_reattached');
  const normalized=only(e.events.filter(p=>p.type==='normalized_view'),'normalized_view');same(normalized.viewport,{width:1280,height:900});assert.equal(normalized.workspaceWidth,1000);assert.equal(normalized.session,s.sessions.find(p=>p.index===0).id);assert.ok(normalized.stableAt-normalized.selectedAt>=750);assert.ok(normalized.seq<e.events.find(p=>p.type==='browser_disconnected').seq);
  const initial=only(e.events.filter(p=>p.type==='initial_state'),'initial_state');same(initial.sessions,s.initialState);assert.ok(initial.seq<start.seq);assert.equal(initial.sessions.length,16);
  same(initial.sessions.map(p=>p.index).sort((a,b)=>a-b),Array.from({length:16},(_,i)=>i));
  for(const b of initial.sessions){
   const ready=only(e.events.filter(p=>p.type==='session_ready'&&p.id===b.session.session_id),'initial_session');assert.equal(ready.index,b.index);assert.equal(ready.adapter,b.adapter);assert.equal(b.session.state,'agent_owned');assert.equal(b.session.control_epoch,ready.epoch);assert.equal(b.session.stream_id,ready.stream);
   assert.ok(e.events.some(p=>p.type==='mcp'&&p.name==='status'&&p.index===b.adapter&&p.seq>normalized.seq&&p.seq<initial.seq&&p.response.sessions.some(q=>isDeepStrictEqual(staticState(q),b.session))),'initial_status');
  }
  for(const k of ['forcedGcCalls','jsProbes','heapDiagnosticCalls'])assert.equal(s.instrumentation[k],0);assert.equal(s.instrumentation.rawCdpSessions,1);
  const starts=e.events.filter(p=>p.type==='arm_round_start'),ends=e.events.filter(p=>p.type==='arm_round_end');
  assert.ok(starts.length<=c.rounds&&ends.length<=starts.length&&starts.length<=ends.length+1,'round_count');v.completedRounds=ends.length;assert.equal(s.completedRounds,ends.length);
  for(const [k,b] of starts.entries()){
   const expected=slot(c,s.clockOrigin+start.t,k);assert.equal(b.round,k);assert.equal(b.index,expected.index);assert.equal(b.scheduledAt,expected.startMs);assert.equal(b.deadline,expected.deadlineMs);assert.ok(b.startedAt>=expected.startMs&&b.startedAt<expected.deadlineMs&&b.startedAt<=s.clockOrigin+b.t,'round_start');assert.ok(b.seq>start.seq&&b.seq<end.seq);
   const state=e.events.filter(p=>p.type==='binding'&&p.session===b.binding.session&&p.seq<b.seq).at(-1)?.after??e.events.find(p=>p.type==='session_ready'&&p.id===b.binding.session);
   assert.equal(b.binding.session,s.sessions.find(p=>p.index===b.index).id);same({adapter:b.binding.adapter,epoch:b.binding.epoch,stream:b.binding.stream},{adapter:state.adapter,epoch:state.epoch,stream:state.stream});
   if(ends[k]){const f=ends[k];for(const key of ['round','index','startedAt','deadline'])same(f[key],b[key]);assert.ok(f.seq>b.seq&&f.seq<end.seq&&f.finishedAt>=b.startedAt&&f.finishedAt<=b.deadline&&s.clockOrigin+f.t<=b.deadline&&f.finishedAt<=s.clockOrigin+f.t,'round_end');}
  }
  const complete=ends.length===c.rounds;
  if(s.status==='finished'){assert.ok(complete,'incomplete_finished');assert.equal(s.stopReason,null);assert.equal(s.workloadPassed,true);}
  else {assert.equal(s.status,'failed');const stop=only(e.events.filter(p=>p.type==='arm_stopped'),'arm_stop');assert.equal(stop.completedRounds,ends.length);assert.equal(stop.reason,s.stopReason);assert.equal(s.workloadPassed,false);}
  const actions=cdpEvidence(e,start,end,starts),rows=transitions(e,starts,ends,actions);
  const measured=e.events.filter(p=>p.type==='cdp'&&p.kind==='request'&&p.method==='Runtime.evaluate'&&p.seq>start.seq&&p.seq<end.seq),prep=e.events.filter(p=>p.type==='cdp'&&p.kind==='request'&&p.method==='Runtime.evaluate'&&p.seq<start.seq);
  const counts=a=>({calls:a.length,queries:a.filter(p=>p.action==='identity').length,actions:a.filter(p=>p.action!=='identity').length});same(s.evaluations,{preparation:counts(prep),measurement:counts(measured)});
  if(complete)assert.equal(measured.length,c.rounds*6,'measurement_evaluations');
  const audits=auditsAndHealth(e,starts,ends);commandEvidence(e,start,end,starts);v.metrics.partialAudits=audits.partial;v.metrics.pendingAudits=audits.pending;
  if(s.arm==='A'){
   for(const f of ends){
    const b=starts[f.round],health=only(e.events.filter(p=>p.type==='health'&&p.seq>b.seq&&p.seq<f.seq),'static_health');
    for(const state of initial.sessions){const p=health.values[state.adapter].sessions.find(q=>q.session_id===state.session.session_id);assert.ok(p);same(staticState(p),state.session,'static_state_changed');}
    const observed=only(e.events.filter(p=>p.type==='static_observation'&&p.round===f.round),'static_observation');assert.ok(observed.seq>health.seq&&observed.seq<f.seq);
   }
  }
  v.metrics.rates=outputEvidence(e,start,end);memoryEvidence(e,Math.min(s.elapsedSeconds,c.seconds));
  for(const row of e.postMemory){validateAttachedSample(row);assert.ok(row.elapsed>=c.seconds&&row.elapsed<=s.elapsedSeconds,'post_sample_boundary');assertProcessIdentity(e.process,row.ownership);}
  for(const d of e.events.filter(p=>p.type==='attached_deadline')){assert.ok(d.observedAt>d.deadline&&d.observedAt<=s.clockOrigin+d.t);assert.ok(!e.events.some(p=>p.seq>d.seq&&p.seq<end.seq&&['transition','arm_round_end','arm_round_start'].includes(p.type)),'success_after_deadline');}
  if(complete&&s.status==='finished'){
   const tail=only(e.events.filter(p=>p.type==='measurement_tail'),'measurement_tail');assert.ok(tail.seq>ends.at(-1).seq&&tail.seq<end.seq);assert.equal(tail.deadline,s.clockOrigin+start.t+c.seconds*1000+15000);
   assert.ok(!e.events.some(p=>p.seq>tail.seq&&p.seq<end.seq&&(p.type==='cdp'&&p.kind==='request'||p.type==='mcp'&&!['status','read_output'].includes(p.name))),'mutation_in_tail');
   for(const rate of v.metrics.rates)assert.ok(rate.bytesPerSecond>=1024,'output_rate');
   v.metrics.memory=memoryResult(e.memory,s.elapsedSeconds,s.profile);v.memoryPassed=v.metrics.memory.memoryPassed;
  }
  v.metrics.failureObservation=failureObservation(e,end);
  const shutdown=only(e.events.filter(p=>p.type==='shutdown'),'shutdown');assert.ok(shutdown.seq>end.seq);assert.equal(shutdown.exit.code,0);same(shutdown.process,e.process);validateShutdown(e.process,shutdown.eofs);
  assert.equal(e.cleanup.owner,s.owner);same(e.cleanup.process,e.process);same(e.cleanup.fixtures,s.fixtures);same(e.cleanup.remaining,[]);same(e.cleanup.containers,[]);
  for(const key of ['normalExit','forcedCleanup','remainingProcesses','remainingContainers','failures'])same(e.cleanup[key],s.cleanup[key]);
  assert.equal(e.cleanup.normalExit,true);assert.equal(e.cleanup.forcedCleanup,false);assert.equal(e.cleanup.remainingProcesses,0);assert.equal(e.cleanup.remainingContainers,0);same(e.cleanup.failures,[]);assert.ok(s.fixtures.every(f=>f.removed&&f.image===s.imageId));
  v.metrics.transitions=rows.length;v.metrics.samples=e.memory.length;v.metrics.evaluations=s.evaluations;v.evidenceValid=true;v.workloadPassed=complete&&s.status==='finished';
 }catch(error){v.evidenceValid=false;v.workloadPassed=false;v.memoryPassed=null;v.errors.push(String(error));}
 return v;
}
export async function loadArmEvidence(out){
 const json=async name=>JSON.parse((await readFile(join(out,name),'utf8')).replace(/^\uFEFF/,''));
 const lines=async name=>{const text=await readFile(join(out,name),'utf8');assert.ok(!text||text.endsWith('\n'),'truncated_jsonl');return text.split('\n').filter(Boolean).map(JSON.parse);};
 return {summary:await json('summary.json'),events:await lines('events.jsonl'),output:await lines('output.jsonl'),memory:await lines('memory.jsonl'),postMemory:await lines('memory-post.jsonl'),cdp:await lines('cdp.jsonl'),audits:await json('audit-observations.json'),boundary:await json('normal-boundary.json'),process:await json('process.json'),cleanup:await json('final-cleanup.json')};
}
export async function verifyArmDirectory(out){
 const claim=await open(join(out,'attached-memory-verification.claim'),'wx');await claim.close();let verdict;
 try{
  const before={};for(const name of ['summary.json',...RAW_FILES])before[name]=await sha256(join(out,name));
  const e=await loadArmEvidence(out);verdict=verifyArmEvidence(e);const s=e.summary,extras=await diagnosticSources(root),baselines=[];
  same(s.cadenceBaselines.map(p=>p.scope),['M','F']);
  for(const b of s.cadenceBaselines){
   const dir=resolve(root,b.evidence),peer=JSON.parse(await readFile(join(dir,'summary.json'),'utf8')),saved=JSON.parse(await readFile(join(dir,'verified.json'),'utf8'));
   baselines.push({evidence:b.evidence,summary:peer,receipt:saved,summarySha256:await sha256(join(dir,'summary.json')),receiptSha256:await sha256(join(dir,'verified.json'))});
  }
  validateArmIdentity(s,baselines,extras);
  for(const [path,hash] of Object.entries(s.sources))assert.equal(await sha256(join(root,path)),hash,'source_changed:'+path);
  for(const b of Object.values(s.binaries))assert.equal(await sha256(b.path),b.sha256,'binary_changed');
  for(const name of Object.keys(before))assert.equal(await sha256(join(out,name)),before[name],'evidence_changed:'+name);
  verdict.summarySha256=before['summary.json'];delete before['summary.json'];verdict.rawHashes=before;
 }catch(error){verdict??=empty();verdict.evidenceValid=false;verdict.workloadPassed=false;verdict.memoryPassed=null;verdict.errors.push(String(error));}
 verdict.verifiedUtc=new Date().toISOString();await writeFile(join(out,'attached-memory-verification.json'),JSON.stringify(verdict,null,2)+'\n',{flag:'wx'});return verdict;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.ok(process.argv[2],'usage: verify.mjs arm-dir');const v=await verifyArmDirectory(resolve(process.argv[2]));console.log(JSON.stringify(v,null,2));if(!v.evidenceValid||!v.workloadPassed||v.memoryPassed===false)process.exitCode=1;
}
