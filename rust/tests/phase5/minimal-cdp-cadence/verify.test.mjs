import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCdpCadenceEvidence,verifyCdpCadenceDirectory} from './verify.mjs';
import {cdpEvidence,syncTrace} from './test-fixture.mjs';
import {digest} from './cdp.mjs';
import {domExpression} from './dom.mjs';
function resequence(e){e.events.sort((a,b)=>a.t-b.t);e.events.forEach((v,i)=>v.seq=i+1);e.boundary.eventSeq=e.events.find(v=>v.type==='measurement_end').seq;syncTrace(e);}
test('accepts three rounds and valid negative deadline evidence separately',()=>{
 for(const timeout of [false,true]){const v=verifyCdpCadenceEvidence(cdpEvidence(timeout));assert.equal(v.evidenceValid,true,v.errors.join('\n'));assert.equal(v.cadenceObserved,!timeout);assert.equal(v.completedRounds,timeout?0:3);assert.equal(v.phase5Acceptance,false);assert.equal(v.memoryAcceptance,'not_evaluated');}
});
const changeRequest=(e,change)=>change(e.events.find(v=>v.type==='cdp'&&v.kind==='request'&&v.action==='resize'));
for(const [name,change] of [
 ['foreign target',e=>e.events.find(v=>v.kind==='open').target.webSocketDebuggerUrl='ws://other:9222/a'],
 ['forbidden method',e=>changeRequest(e,v=>v.method='Network.enable')],
 ['wrong expression',e=>changeRequest(e,v=>v.expressionSha256='bad')],
 ['late response',e=>{const q=e.events.find(v=>v.kind==='request'&&v.action==='resize');e.events.find(v=>v.kind==='response'&&v.id===q.id).at=q.deadline+1;}],
 ['wrong value',e=>e.events.find(v=>v.kind==='response'&&v.result?.result?.value?.width).result.result.value.sessionId='other'],
 ['missing geometry',e=>{for(const v of e.events.filter(v=>v.type==='mcp'&&v.name==='status'))for(const s of v.response.sessions)s.geometry={rows:1,columns:1};}],
 ['revisit owner',e=>e.events.filter(v=>v.type==='transition').at(-1).before.adapter=0],
 ['reused stream',e=>{const t=e.events.find(v=>v.type==='transition');t.assigned.session.stream_id=t.before.stream;}],
 ['missing audit',e=>e.audits[0].actual.shift()],
 ['duplicate audit',e=>e.audits[0].actual.push(e.audits[0].actual[0])],
 ['extra connection',e=>e.memory[0].debugPort.connections.push({...e.memory[0].debugPort.connections[0]})],
 ['gap',e=>{e.memory.splice(0,2);e.summary.samples=e.memory;e.boundary.samples=e.memory.length;}],
 ['forced cleanup',e=>e.cleanup.forcedCleanup=true],
 ['short duration',e=>e.summary.elapsedSeconds--],
 ['false instrumentation',e=>e.summary.instrumentation.evaluateCalls=0],
 ['missing trace',e=>e.events.find(v=>v.kind==='response').kind='omitted'],
])test('rejects '+name,()=>{const e=cdpEvidence();change(e);syncTrace(e);const v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,false,JSON.stringify(v));assert.equal(v.cadenceObserved,false);});
test('raw trace cannot disagree with event copy',()=>{const e=cdpEvidence();e.cdp.pop();assert.equal(verifyCdpCadenceEvidence(e).evidenceValid,false);});
test('partial audit delivered Enter requires an effect even without a completed round',()=>{
 const e=cdpEvidence(true),template=e.events[0],args={session_id:'s0',control_epoch:1,request_id:'partial',text:"printf '%s\\n' 'AUDIT_0_0' >> /tmp/soak-audit-0"};
 for(let i=0;i<2;i++)e.events.push({...template,type:'mcp',t:2000+i,index:0,name:'send_text',args,response:{result:'delivered'}});
 e.events.push({...template,type:'mcp',t:2002,index:0,name:'send_key',args:{session_id:'s0',control_epoch:1,request_id:'partial-enter',key:'Enter'},response:{result:'delivered'}});
 e.events.sort((a,b)=>a.t-b.t);e.events.forEach((v,i)=>v.seq=i+1);e.boundary.eventSeq=e.events.find(v=>v.type==='measurement_end').seq;syncTrace(e);
 assert.equal(verifyCdpCadenceEvidence(e).evidenceValid,false);e.audits[0].actual.push('AUDIT_0_0');const v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.metrics.partialAudits.length,1);
});
test('directory verifier records missing evidence once and never overwrites',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-cc-verify-'));t.after(()=>rm(dir,{recursive:true,force:true}));const v=await verifyCdpCadenceDirectory(dir);assert.equal(v.evidenceValid,false);const before=await readFile(join(dir,'cdp-cadence-verification.json'),'utf8');await assert.rejects(verifyCdpCadenceDirectory(dir),/EEXIST/);assert.equal(await readFile(join(dir,'cdp-cadence-verification.json'),'utf8'),before);
});
test('host completion after transport deadline is allowed inside the round',()=>{
 const e=cdpEvidence(),q=e.events.find(v=>v.kind==='request'&&v.action==='resize');q.deadline=q.at+1;q.timeout=1;e.events.find(v=>v.kind==='dispatch'&&v.id===q.id).timeout=1;syncTrace(e);const v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());
});
test('transport success with a host abort remains valid negative evidence',()=>{
 const e=cdpEvidence(true),args={sessionId:'s0',label:'soak-00'},base={owner:e.summary.owner,scope:'CC',round:0};
 e.events.push({...base,type:'cdp',kind:'request',id:3,t:60988,at:60988,deadline:60990,timeout:2,method:'Runtime.evaluate',action:'select',args,expressionSha256:digest(domExpression('select',args))},
 {...base,type:'cdp',kind:'dispatch',id:3,t:60988,at:60988,timeout:2},
 {...base,type:'cdp',kind:'response',id:3,t:60989,at:60989,result:{result:{value:{sessionId:'s0'}}}},
 {...base,type:'cdp_action_aborted',action:'select',args,t:61000,reason:'Error: service_failure'});
 e.summary.instrumentation.evaluateCalls++;e.summary.instrumentation.domActions++;resequence(e);const v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.cadenceObserved,false);
});
test('disconnect requires stopped evidence and cannot be erased by closed',()=>{
 for(const negative of [true,false]){const e=cdpEvidence(negative),t=negative?61000:130999;e.events.push({type:'cdp',kind:'disconnected',reason:'cdp_closed',at:t,t,scope:'CC',owner:e.summary.owner,round:negative?0:2});resequence(e);const v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,negative,v.errors.join());assert.equal(v.cadenceObserved,false);}
});
test('failure observations are required and must match raw MCP status',()=>{
 for(const tamper of [e=>e.events.find(v=>v.type==='failure_status').response={connection_id:'foreign',sessions:[]},e=>{e.events=e.events.filter(v=>v.type!=='failure_status');}]){const e=cdpEvidence(true);tamper(e);resequence(e);assert.equal(verifyCdpCadenceEvidence(e).evidenceValid,false);}
});
test('partial ownership observations remain separate from acknowledged bindings',()=>{
 const e=cdpEvidence(true),row=e.events.find(v=>v.type==='failure_status'&&v.index===0),raw=e.events.find(v=>v.type==='mcp'&&v.name==='status'&&v.index===0&&v.t===row.t);
 for(const v of [row,raw])v.response.sessions[0]={session_id:'s0',state:'user_owned',control_epoch:2,stream_id:null};
 const unknown=e.events.find(v=>v.type==='failure_status'&&v.index===1);e.events=e.events.filter(v=>!(v.type==='mcp'&&v.index===1&&v.t===unknown.t));delete unknown.response;unknown.error='Error: mcp_timeout';
 Object.assign(e.summary.failureObservation,{observed:31,complete:false});Object.assign(e.events.find(v=>v.type==='failure_observation_end'),{observed:31,complete:false});resequence(e);
 const v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.metrics.failureObservation.complete,false);assert.equal(v.metrics.failureObservation.observations[0].response.sessions[0].control_epoch,2);assert.equal(e.summary.sessions[0].epoch,1);
});
test('dispatch cannot exceed remaining deadline or disappear behind a response',()=>{
 for(const change of [e=>{e.events.find(v=>v.kind==='dispatch'&&v.timeout).timeout=900001;},e=>{e.events.splice(e.events.findIndex(v=>v.kind==='dispatch'),1);}]){const e=cdpEvidence();change(e);resequence(e);assert.equal(verifyCdpCadenceEvidence(e).evidenceValid,false);}
});
test('initial identity must be session zero even if a different session is internally consistent',()=>{
 const e=cdpEvidence(),q=e.events.find(v=>v.kind==='request'&&v.action==='identity');q.args.sessionId='s15';q.expressionSha256=digest(domExpression(q.action,q.args));
 e.events.find(v=>v.kind==='response'&&v.id===q.id).result.result.value.sessionId='s15';const a=e.events.find(v=>v.type==='cdp_action'&&v.round===-1);a.args.sessionId='s15';a.result.sessionId='s15';syncTrace(e);assert.equal(verifyCdpCadenceEvidence(e).evidenceValid,false);
});
test('response error details are bounded, typed failure evidence, never action success',()=>{
 const e=cdpEvidence(true),base={owner:e.summary.owner,scope:'CC',round:0},args={sessionId:'s0',label:'soak-00'};
 e.events.push({...base,type:'cdp',kind:'request',id:3,t:2000,at:2000,deadline:3000,timeout:1000,method:'Runtime.evaluate',action:'select',args,expressionSha256:digest(domExpression('select',args))},
 {...base,type:'cdp',kind:'dispatch',id:3,t:2000,at:2000,timeout:1000},
 {...base,type:'cdp',kind:'failure',id:3,t:2001,at:2001,reason:'cdp_response_error',uncertain:true,details:{kind:'javascript',text:'Uncaught',description:'Error: dom_session',lineNumber:4,columnNumber:8,truncated:false}},
 {...base,type:'cdp_action_aborted',action:'select',args,t:2002,reason:'Error: cdp_response_error'});
 e.summary.instrumentation.evaluateCalls++;e.summary.instrumentation.domActions++;resequence(e);let v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.cadenceObserved,false);
 const f=e.events.find(v=>v.kind==='failure');f.details.description='x'.repeat(5000);syncTrace(e);assert.equal(verifyCdpCadenceEvidence(e).evidenceValid,false);
 f.details={kind:'protocol',code:-32602,message:'Invalid parameters',truncated:false};syncTrace(e);v=verifyCdpCadenceEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());
 delete f.details;syncTrace(e);assert.equal(verifyCdpCadenceEvidence(e).evidenceValid,false);
});
