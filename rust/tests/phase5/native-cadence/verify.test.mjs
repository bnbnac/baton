import test from 'node:test';
import assert from 'node:assert/strict';
import {cadenceEvidence} from './test-fixture.mjs';
import {verifyCadenceEvidence,verifyCadenceDirectory} from './verify.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('three rounds are cadence evidence, never long-run memory acceptance',()=>{
 const v=verifyCadenceEvidence(cadenceEvidence());assert.deepEqual(v.errors,[]);assert.equal(v.evidenceValid,true);assert.equal(v.cadenceObserved,true);assert.equal(v.completedRounds,3);assert.equal(v.phase5Acceptance,false);assert.equal(v.memoryAcceptance,'not_evaluated');
});
test('an honestly recorded first deadline stops with valid negative cadence evidence',()=>{
 const v=verifyCadenceEvidence(cadenceEvidence(true));assert.deepEqual(v.errors,[]);assert.equal(v.evidenceValid,true);assert.equal(v.cadenceObserved,false);assert.equal(v.completedRounds,0);
});
const mutations={
 foreignOwner:e=>{e.events[0].owner='foreign';},
 reusedStream:e=>{e.events.findLast(v=>v.type==='transition').assigned.session.stream_id='stream0';},
 secondVisitOwner:e=>{e.events.findLast(v=>v.type==='transition').before.adapter=0;},
 fakeDuration:e=>{e.summary.elapsedSeconds=1;},
 missingAudit:e=>{e.audits[0].actual.pop();},
 duplicateAudit:e=>{e.audits[0].actual.push(e.audits[0].actual[0]);},
 missingStateAfterReceipt:e=>{for(const v of e.events.filter(v=>v.type==='mcp'&&v.name==='status'&&v.t>1120&&v.t<2000))v.response.sessions=[];},
 debugger:e=>{e.memory[0].debugPort.established=1;},
 sampleGap:e=>{e.memory.splice(1,2);},
 foreignProcess:e=>{e.memory[0].processes[1].startedTicks='2';},
 cleanup:e=>{e.cleanup.remainingProcesses=1;},
 summaryRounds:e=>{e.summary.completedRounds=2;},
 missingRawDedup:e=>{const v=e.events.find(v=>v.type==='mcp'&&v.name==='send_text');v.args.request_id='other';},
 missingNativeFile:e=>{e.nativeFiles.results.pop();},
 setupFailure:e=>{e.events=e.events.filter(v=>!['measurement_start','measurement_end'].includes(v.type));e.summary.completedRounds=0;e.summary.status='failed';}
};
for(const [name,mutate] of Object.entries(mutations))test('rejects '+name,()=>{const e=cadenceEvidence();mutate(e);const v=verifyCadenceEvidence(e);assert.equal(v.evidenceValid,false,JSON.stringify(v));assert.equal(v.cadenceObserved,false);});
test('directory verifier preserves the first receipt even for incomplete evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cadence-verifier-'));try{
  const result=await verifyCadenceDirectory(dir);assert.equal(result.evidenceValid,false);const first=await readFile(join(dir,'cadence-verification.json'),'utf8');
  await assert.rejects(verifyCadenceDirectory(dir),{code:'EEXIST'});assert.equal(await readFile(join(dir,'cadence-verification.json'),'utf8'),first);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('partial delivered audit must be present in the server file, not silently omitted',()=>{
 const e=cadenceEvidence(true),args={session_id:'s0',control_epoch:1,request_id:'partial-text',text:"printf '%s\\n' 'AUDIT_0_0' >> /tmp/soak-audit-0"};
 const base={owner:e.summary.owner,scope:'NC',type:'mcp',index:0};
 e.events.push(...[0,1].map(i=>({...base,t:2000+i,name:'send_text',args:structuredClone(args),response:{result:'delivered'}})),{...base,t:2002,name:'send_key',args:{session_id:'s0',control_epoch:1,request_id:'partial-enter',key:'Enter'},response:{result:'delivered'}});
 e.events.sort((a,b)=>a.t-b.t);e.events.forEach((v,i)=>v.seq=i+1);e.boundary.eventSeq=e.events.find(v=>v.type==='measurement_end').seq;
 assert.equal(verifyCadenceEvidence(e).evidenceValid,false);
 e.audits[0].actual=['AUDIT_0_0'];const v=verifyCadenceEvidence(e);assert.equal(v.evidenceValid,true,JSON.stringify(v.errors));assert.equal(v.metrics.partialAudits.length,1);
});
