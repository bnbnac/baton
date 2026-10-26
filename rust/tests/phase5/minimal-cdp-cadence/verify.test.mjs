import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {verifyCdpCadenceEvidence,verifyCdpCadenceDirectory} from './verify.mjs';
import {cdpEvidence,syncTrace} from './test-fixture.mjs';
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
