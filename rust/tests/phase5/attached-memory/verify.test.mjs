import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyArmEvidence,verifyArmDirectory,loadArmEvidence,validateArmIdentity} from './verify.mjs';
import {armEvidence,resequence} from './test-fixture.mjs';
import {digest} from '../minimal-cdp-cadence/cdp.mjs';
import {domExpression} from '../minimal-cdp-cadence/dom.mjs';

for(const arm of ['A','B'])test(arm+' preflight verifies raw data without a memory pass',()=>{const v=verifyArmEvidence(armEvidence(arm));assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.workloadPassed,true);assert.equal(v.memoryPassed,null);assert.equal(v.completedRounds,3);});
test('full static pass and valid memory failure stay distinct',()=>{
 const e=armEvidence('A','full');let v=verifyArmEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.memoryPassed,true);
 for(const s of e.memory.filter(v=>v.elapsed>=6000)){for(const p of s.processes)p.privateBytes*=2;s.privateBytes*=2;}
 v=verifyArmEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.workloadPassed,true);assert.equal(v.memoryPassed,false);
});
test('full transitioning pass verifies all revisits',()=>{const e=armEvidence('B','full'),v=verifyArmEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.memoryPassed,true);assert.equal(v.metrics.transitions,120);e.events.filter(p=>p.type==='transition')[16].before.adapter=0;assert.equal(verifyArmEvidence(e).evidenceValid,false);});
test('raw verifier rejects duplicate timestamps even when summary counts agree',()=>{
 const e=armEvidence('A','full'),sample=e.memory.find(p=>p.elapsed===1200);e.memory=e.memory.filter(p=>p.elapsed<1200||p.elapsed>=2400);
 e.memory.push(...Array.from({length:29},(_,i)=>({...structuredClone(sample),elapsed:1200+i*1200/29})));e.memory.sort((a,b)=>a.elapsed-b.elapsed);e.summary.samples=e.memory;e.boundary.samples=e.memory.length;
 assert.equal(verifyArmEvidence(e).evidenceValid,false);e.memory.push(structuredClone(sample));e.memory.sort((a,b)=>a.elapsed-b.elapsed);e.boundary.samples=e.memory.length;
 const v=verifyArmEvidence(e);assert.equal(v.evidenceValid,false);assert.equal(v.memoryPassed,null);assert.match(v.errors.join(),/sample_boundary/);
});
test('complete early-stop evidence is negative and memory unevaluated',()=>{const v=verifyArmEvidence(armEvidence('B','preflight',true));assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.workloadPassed,false);assert.equal(v.memoryPassed,null);});
test('partial delivered audit still requires its actual effect',()=>{
 const e=armEvidence('A','preflight',true),args={session_id:'s0',control_epoch:1,request_id:'partial',text:"printf '%s\\n' 'AUDIT_0_0' >> /tmp/soak-audit-0"};
 for(let i=0;i<2;i++)e.events.push({type:'mcp',t:2000+i,owner:e.summary.owner,scope:'AM',index:0,name:'send_text',args,response:{result:'delivered'}});
 e.events.push({type:'mcp',t:2002,owner:e.summary.owner,scope:'AM',index:0,name:'send_key',args:{session_id:'s0',control_epoch:1,request_id:'partial-enter',key:'Enter'},response:{result:'delivered'}});resequence(e);
 assert.equal(verifyArmEvidence(e).evidenceValid,false);e.audits[0].actual.push('AUDIT_0_0');const v=verifyArmEvidence(e);assert.equal(v.evidenceValid,true,v.errors.join());assert.equal(v.workloadPassed,false);assert.equal(v.metrics.partialAudits.length,1);
});
for(const [name,change,arm] of [
 ['missing repeated response',e=>{const q=e.events.filter(v=>v.kind==='request'&&v.round===0)[2];e.events=e.events.filter(v=>!(v.kind==='response'&&v.id===q.id));}],
 ['duplicate repeated response',e=>e.events.push({...e.events.find(v=>v.kind==='response'&&v.round===0)})],
 ['reordered repeated response',e=>{const q=e.events.filter(v=>v.kind==='response'&&v.round===0);[q[1].id,q[2].id]=[q[2].id,q[1].id];}],
 ['A mutation expression',e=>{const q=e.events.find(v=>v.kind==='request'&&v.round===0);q.action='reclaim';q.expressionSha256=digest(domExpression(q.action,q.args));}],
 ['static epoch change',e=>e.events.find(v=>v.type==='health').values[15].sessions[0].control_epoch++],
 ['missing audit',e=>e.audits[0].actual.shift()],
 ['duplicate audit',e=>e.audits[0].actual.push(e.audits[0].actual[0])],
 ['foreign output',e=>e.output[0].session='other'],
 ['wrong stream',e=>e.output[0].stream='wrong'],
 ['extra debugger',e=>e.memory[0].debugPort.connections.push({...e.memory[0].debugPort.connections[0]})],
 ['stale renderer',e=>e.memory[0].processes[1].startedTicks='other'],
 ['sample gap',e=>{e.memory.splice(1,1);e.boundary.samples=e.memory.length;}],
 ['wrong boundary',e=>e.boundary.elapsedSeconds--],
 ['forced cleanup',e=>e.cleanup.forcedCleanup=true],
 ['leftovers',e=>e.cleanup.remaining.push({pid:555})],
 ['late response',e=>{const q=e.events.find(v=>v.kind==='request'&&v.round===0);e.events.find(v=>v.kind==='response'&&v.id===q.id).at=q.deadline+1;}],
 ['wrong transition index',e=>e.events.find(v=>v.type==='transition').index=15,'B'],
 ['fabricated geometry',e=>e.events.find(v=>v.type==='remote_geometry').remote='1 1','B'],
 ['missing initial state',e=>e.events=e.events.filter(v=>v.type!=='initial_state')],
 ['unexpected disconnect',e=>e.events.push({type:'cdp',kind:'disconnected',round:0,at:1002,t:1002,owner:e.summary.owner,scope:'AM',reason:'lost'})],
])test('rejects '+name,()=>{const e=armEvidence(arm);change(e);resequence(e);const v=verifyArmEvidence(e);assert.equal(v.evidenceValid,false,name);assert.equal(v.memoryPassed,null);});
test('raw CDP copy cannot disagree',()=>{const e=armEvidence();e.cdp.pop();assert.equal(verifyArmEvidence(e).evidenceValid,false);});
test('unplanned input hidden among successful audits is rejected',()=>{
 const e=armEvidence();e.events.push({type:'mcp',t:2000,scope:'AM',owner:e.summary.owner,index:0,name:'send_text',args:{session_id:'s0',control_epoch:1,request_id:'extra',text:'printf EXTRA'},response:{result:'delivered'}});resequence(e);assert.equal(verifyArmEvidence(e).evidenceValid,false);
});
test('duplicate ownership in raw and summarized health still fails',()=>{
 const e=armEvidence(),health=e.events.find(p=>p.type==='health'),raw=e.events.find(p=>p.type==='mcp'&&p.name==='status'&&p.index===16&&p.t===health.t-100);
 const duplicate=structuredClone(health.values[0].sessions[0]);health.values[16].sessions.push(duplicate);raw.response.sessions.push(duplicate);resequence(e);assert.equal(verifyArmEvidence(e).evidenceValid,false);
});
test('remote geometry without its delivered stty command is rejected',()=>{
 const e=armEvidence('B');e.events=e.events.filter(p=>!p.args?.text?.startsWith('stty size'));resequence(e);assert.equal(verifyArmEvidence(e).evidenceValid,false);
});
test('directory verifier writes once and preserves orphan claims',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-am-verify-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const v=await verifyArmDirectory(dir);assert.equal(v.evidenceValid,false);const path=join(dir,'attached-memory-verification.json'),before=await readFile(path,'utf8');await assert.rejects(verifyArmDirectory(dir),/EEXIST/);assert.equal(await readFile(path,'utf8'),before);
 const orphan=await mkdtemp(join(tmpdir(),'baton-am-orphan-'));t.after(()=>rm(orphan,{recursive:true,force:true}));await writeFile(join(orphan,'attached-memory-verification.claim'),'');await assert.rejects(verifyArmDirectory(orphan),/EEXIST/);
});
test('loader rejects truncated JSONL',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-am-load-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const e=armEvidence();for(const [name,value] of [['summary',e.summary],['audit-observations',e.audits],['normal-boundary',e.boundary],['process',e.process],['final-cleanup',e.cleanup]])await writeFile(join(dir,name+'.json'),JSON.stringify(value));
 for(const [name,value] of [['events',e.events],['output',e.output],['memory',e.memory],['cdp',e.cdp],['memory-post',[]]])await writeFile(join(dir,name+'.jsonl'),value.map(v=>JSON.stringify(v)+'\n').join(''));
 await writeFile(join(dir,'events.jsonl'),'{}');await assert.rejects(loadArmEvidence(dir),/truncated_jsonl/);
});
test('identity manifest pins all common and diagnostic keys and both baseline receipts',()=>{
 const s=armEvidence().summary,hash='a'.repeat(64),common=Object.fromEntries(Array.from({length:23},(_,i)=>['common'+i,hash]));s.sources={...common,'extra.mjs':hash};
 s.cadenceBaselines=['M','F'].map(scope=>({scope,evidence:scope,summarySha256:hash,receiptSha256:hash,sources:common}));
 const peers=s.cadenceBaselines.map(b=>({evidence:b.evidence,summary:{...s,scope:b.scope,sources:common},receipt:{preflightPassed:true,summarySha256:hash},summarySha256:hash,receiptSha256:hash}));
 assert.doesNotThrow(()=>validateArmIdentity(s,peers,['extra.mjs']));
 for(const mode of ['unknown','missing','changed','receipt','summaryHash','environment','commonCount']){
  const candidate=structuredClone(s),baseline=structuredClone(peers);
  if(mode==='unknown')candidate.sources.unknown=hash;if(mode==='missing')delete candidate.sources['extra.mjs'];if(mode==='changed')candidate.sources.common0='b'.repeat(64);
  if(mode==='receipt')baseline[0].receipt.preflightPassed=false;if(mode==='summaryHash')baseline[0].summarySha256='b'.repeat(64);
  if(mode==='environment')baseline[1].summary.environment.webview='other';if(mode==='commonCount')delete baseline[1].summary.sources.common0;
  assert.throws(()=>validateArmIdentity(candidate,baseline,['extra.mjs']),mode);
 }
});
