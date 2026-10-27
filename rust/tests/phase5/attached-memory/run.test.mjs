import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAttachedRuntime,executeAttached,diagnosticSources,installLaunchChecks} from './run.mjs';
test('launch inputs are checked before setup, after actual environment and before measurement',async()=>{
 const calls=[],r={root:'.',out:'.',summary:{sources:{},environment:{}},setup:async()=>calls.push('setup'),startMeasurement:async()=>calls.push('measurement')};
 installLaunchChecks(r,{configPath:'config',arm:'A',profile:'preflight'},async(...args)=>{calls.push(args.at(-1)?'actual_identity':'frozen_inputs');});
 await r.setup();await r.startMeasurement();assert.deepEqual(calls,['frozen_inputs','setup','actual_identity','actual_identity','measurement']);
});
test('a changed source between setup and measurement prevents measurement',async()=>{
 let checks=0,started=false;const r={root:'.',out:'.',summary:{},setup:async()=>{},startMeasurement:async()=>{started=true;}};
 installLaunchChecks(r,{configPath:'config',arm:'B',profile:'full'},async()=>{if(++checks===3)throw Error('source_changed');});await r.setup();await assert.rejects(r.startMeasurement(),/source_changed/);assert.equal(started,false);
});
test('measurement and preparation evaluations are separately counted',async()=>{
 let time=0;const r=createAttachedRuntime({root:'.',out:'.',config:{},arm:'A',profile:'preflight'},{now:()=>time});r.append=async()=>{};r.json=async()=>{};r.save=async()=>{};
 await r.event('cdp',{kind:'request',method:'Runtime.evaluate',action:'identity'});time=899000;await r.startMeasurement();
 for(let k=0;k<18;k++)await r.event('cdp',{kind:'request',method:'Runtime.evaluate',action:'identity'});
 assert.deepEqual(r.summary.evaluations,{preparation:{calls:1,queries:1,actions:0},measurement:{calls:18,queries:18,actions:0}});
 time+=180000;r.cadenceGuard.beginFreeze();await r.freeze();assert.equal(r.summary.elapsedSeconds,180);assert.equal(r.contract.scope,'AM');
});
test('supervisor watchdog exceeds full and preflight budgets without scope forgery',async()=>{
 const shared=await readFile(new URL('../separated/runtime.mjs',import.meta.url),'utf8');assert.ok(shared.includes("this.contract.rounds*240+900"));
 for(const [profile,timeout] of [['full',29700],['preflight',1620]]){const r=createAttachedRuntime({root:'.',out:'.',config:{},arm:'B',profile});assert.equal(r.contract.scope,'AM');assert.equal(r.contract.rounds*240+900,timeout);}
});
test('all extra non-test source files are manifested',async()=>{
 const root=new URL('../../../../',import.meta.url);const paths=await diagnosticSources(root);assert.ok(paths.includes('rust/tests/phase5/attached-memory/policy.mjs'));assert.ok(paths.includes('rust/tests/phase5/minimal-cdp-cadence/cdp.mjs'));assert.ok(paths.every(p=>!p.endsWith('.test.mjs')&&!p.endsWith('test-fixture.mjs')));
});
test('every failure path shuts down, cleans owned resources and checks hashes',async()=>{
 for(const where of ['setup','scenario','shutdown']){const calls=[],r={summary:{},init:async()=>{},setup:async()=>{if(where==='setup')throw Error(where);},shutdown:async()=>{calls.push('shutdown');if(where==='shutdown')throw Error(where);},cleanup:async()=>{calls.push('cleanup');return {normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]};},checkHashes:async()=>calls.push('hashes'),save:async()=>{}};
 await executeAttached(r,async()=>{if(where==='scenario')throw Error(where);});assert.equal(r.summary.status,'failed');assert.deepEqual(calls,['shutdown','cleanup','hashes']);}
});
