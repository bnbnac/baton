import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyEvidence,loadEvidence} from './verify.mjs';
import {memoryEvidence} from './test-fixture.mjs';
import {runExperiment,reserveLaunch} from './run.mjs';
test('complete short evidence stays preflight only, irrespective of summary success wording',()=>{
 const e=memoryEvidence(),v=verifyEvidence(e);assert.deepEqual(v.errors,[]);assert.equal(v.preflightPassed,true);assert.equal(v.scopePassed,false);assert.equal(v.phase5Acceptance,false);assert.equal(v.combinedTransitionMemory,'unverified');
 e.summary.status='passed';assert.equal(verifyEvidence(e).preflightPassed,true);
});
test('full natural evidence can pass its scope but a valid memory increase keeps acceptance blocked',()=>{
 const e=memoryEvidence('full');const first=verifyEvidence(e);assert.deepEqual(first.errors,[]);assert.equal(first.scopePassed,true);assert.equal(first.phase5Acceptance,false);
 for(const sample of e.memory.filter(s=>s.elapsed>=6000)){for(const p of sample.processes)p.privateBytes=121;sample.privateBytes=4114;}
 const second=verifyEvidence(e);assert.equal(second.evidenceValid,true);assert.equal(second.scopePassed,false);assert.deepEqual(second.errors,['memory_growth_over_20_percent']);
});
test('foreign output rows and epoch substitution are not ignored',()=>{
 const e=memoryEvidence();e.output.push({...e.output[0],session:'foreign'});assert.equal(verifyEvidence(e).evidenceValid,false);
 const epoch=memoryEvidence();epoch.output[0].epoch=999;assert.equal(verifyEvidence(epoch).evidenceValid,false);
});
for(const [name,change] of [
 ['missing duration',e=>e.summary.elapsedSeconds=179],['sample gap',e=>e.memory.splice(2,2)],['debugger attached',e=>e.memory[2].debugPort.established=1],
 ['forced GC',e=>e.summary.instrumentation.forcedGcCalls=1],['sum mismatch',e=>e.memory[0].privateBytes=1],['reused PID',e=>e.memory[2].processes[0].startedTicks='2'],
 ['duplicate audit effect',e=>e.audits[0].actual.push('AUDIT_0_0')],['no duplicate request',e=>{e.events=e.events.filter(row=>!(row.type==='mcp'&&row.seq===6));}],
 ['missing cleanup',e=>delete e.cleanup],['forced cleanup',e=>e.cleanup.forcedCleanup=true],['missing EOF',e=>e.events.at(-1).eofs.pop()],
 ['post boundary sample',e=>e.memory.at(-1).elapsed=180],['missing identity',e=>delete e.summary.environment.webview],['wrong image',e=>e.summary.fixtures[1].image='other'],
 ['missing output',e=>e.output.pop()],['corrupt output',e=>e.output[0].response.text=e.output[0].response.text.replace('00000002','00000004')],
 ['negative stream cursor',e=>e.output[0].response.next_cursor=-1],['early browser attach',e=>e.events.find(row=>row.type==='browser_disconnected').type='browser_attached']
])test('rejects '+name,()=>{const e=memoryEvidence();change(e);const v=verifyEvidence(e);assert.equal(v.scopePassed,false);assert.equal(v.preflightPassed,false);assert.ok(v.errors.length);});
test('truncated JSONL is a named evidence failure, not silently dropped last line',async t=>{
 const out=await mkdtemp(join(tmpdir(),'baton-evidence-'));t.after(()=>rm(out,{recursive:true,force:true}));await writeFile(join(out,'summary.json'),'{}');await writeFile(join(out,'events.jsonl'),'{"partial":');await assert.rejects(loadEvidence(out),/events.jsonl/);
});
test('launcher refuses previously used output or log paths without replacing files',async t=>{
 const root=await mkdtemp(join(tmpdir(),'baton-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'artifacts'));const out=join(root,'artifacts','run');await writeFile(out+'.log','old');await assert.rejects(reserveLaunch(root,out),/exists/);await assert.rejects(reserveLaunch(root,join(root,'outside')),/artifacts/);
});
test('workload failure still attempts shutdown and cleanup and returns failure',async()=>{
 const order=[],r={contract:{scope:'M',profile:'preflight'},summary:{},init:async()=>{},setup:async()=>{},save:async()=>{},checkHashes:async()=>{},shutdown:async()=>order.push('shutdown'),cleanup:async()=>{order.push('cleanup');return {normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]};}};
 const result=await runExperiment(r,{M:async()=>{throw Error('workload_failed');}});assert.equal(result.status,'failed');assert.match(result.failure,/workload_failed/);assert.deepEqual(order,['shutdown','cleanup']);assert.ok(result.finishedUtc);
});
