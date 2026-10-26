import test from 'node:test';
import assert from 'node:assert/strict';
import {installCadenceGuard,executeCadence,createCadenceRuntime} from './run.mjs';

test('late RPC is settled, recorded, then blocks the next RPC until cleanup',async()=>{
 let time=0,calls=0;const events=[];
 const r={born:0,now:()=>time,event:async(type,detail)=>events.push({type,...detail}),tool:async()=>{calls++;time=60001;return 'delivered';},checkStop:async()=>{}};
 const g=installCadenceGuard(r);g.beginRound(60000);
 await assert.rejects(r.tool(),/round_deadline/);await assert.rejects(r.tool(),/round_deadline/);assert.equal(calls,1);
 g.finish();assert.equal(await r.tool(),'delivered');assert.equal(calls,2);assert.ok(events.some(e=>e.type==='cadence_deadline'&&e.observedAt===60001));
});
test('setup and interruption failures still shut down, clean up and check hashes',async()=>{
 for(const where of ['setup','scenario','shutdown']){
  const calls=[],summary={};const r={summary,init:async()=>{},setup:async()=>{if(where==='setup')throw Error('setup');},shutdown:async()=>{calls.push('shutdown');if(where==='shutdown')throw Error('shutdown');},cleanup:async()=>{calls.push('cleanup');return {normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]};},checkHashes:async()=>calls.push('hashes'),save:async()=>{}};
  await executeCadence(r,async()=>{if(where==='scenario')throw Error('interrupted');});
  assert.equal(summary.status,'failed');assert.deepEqual(calls,['shutdown','cleanup','hashes']);
 }
});
test('wait and setup budgets cannot extend past the global deadline',async()=>{
 let time=899990,timeout;const r={born:0,now:()=>time,event:async()=>{},checkStop:async()=>{},waitFor:async(_c,_l,t)=>{timeout=t;time+=11;return true;}};
 installCadenceGuard(r);await assert.rejects(r.waitFor(()=>true,'probe',45000),/run_expired/);assert.equal(timeout,10);
});
test('measurement duration uses exactly the emitted boundaries with an advancing clock',async()=>{
 let time=0,calls=0;const events=[];const r=createCadenceRuntime({root:'.',out:'.',config:{}},{now:()=>{time+=++calls;return time;}});
 r.event=async(type)=>{const row={seq:events.length+1,type,t:r.now()-r.born,utc:'test'};events.push(row);return row;};r.save=async()=>{};let boundary;r.json=async(_path,value)=>{boundary=value;};
 await r.startMeasurement();time+=100;await r.freeze();
 assert.equal(r.summary.elapsedSeconds,(events[1].t-events[0].t)/1000);assert.equal(boundary.elapsedSeconds,r.summary.elapsedSeconds);
});
