import test from 'node:test';
import assert from 'node:assert/strict';
import {runMemory} from './memory.mjs';
function runtime({grow=false,fail=false,skip=false}={}){
 let time=0;const trace=[],audits=[];
 const r={contract:{scope:'M',profile:'full',seconds:7200,rounds:120},summary:{samples:[]},sessions:[],trace,audits,
  now:()=>time*1000,elapsed:()=>time,sleep:async()=>{time++;},disconnectBrowser:async()=>trace.push('disconnect'),startMeasurement:async()=>trace.push('start'),
  event:async()=>{},service:async()=>{if(fail&&time===90)throw Error('broken_output');},health:async()=>[],audit:async n=>audits.push({n,time}),verifyAudits:async()=>{},
  sampleMemory:async()=>{if(skip&&time>=1200&&time<1260)return;r.summary.samples.push({elapsed:time,phase:'natural',debugPort:{established:0},privateBytes:grow&&time>=6000?121:100,workingSetBytes:100});},
  freeze:async()=>{r.measurementFrozen=true;r.summary.elapsedSeconds=time;trace.push('freeze');},
  overload:async()=>{assert.equal(r.measurementFrozen,true);trace.push('overload');return {passed:true};},outputRates:()=>Array.from({length:16},(_,index)=>({index,bytesPerSecond:1100})),save:async()=>{}};
 return r;
}
test('static workload runs all 120 spaced audits for 7200 seconds and freezes before overload',async()=>{
 const r=runtime();const result=await runMemory(r);assert.equal(r.summary.elapsedSeconds,7200);assert.equal(r.audits.length,120);assert.deepEqual(r.audits.slice(-2),[{n:118,time:7080},{n:119,time:7140}]);assert.deepEqual(r.trace,['disconnect','start','freeze','overload']);assert.equal(result.memory.passed,true);
});
test('memory threshold failure does not prevent overload control',async()=>{
 const r=runtime({grow:true});const result=await runMemory(r);assert.equal(result.memory.passed,false);assert.deepEqual(r.trace.slice(-2),['freeze','overload']);
});
test('invalid output freezes evidence and skips overload, never fabricates full duration',async()=>{
 const r=runtime({fail:true});await assert.rejects(runMemory(r),/broken_output/);assert.equal(r.summary.elapsedSeconds,90);assert.deepEqual(r.trace,['disconnect','start','freeze']);assert.equal(r.summary.overload.reason,'normal_workload_invalid');
});
test('missing sample coverage is not a passed natural memory result',async()=>{
 const r=runtime({skip:true});await assert.rejects(runMemory(r),/memory_sample_gap/);assert.deepEqual(r.trace.slice(-2),['freeze','overload']);
});
test('final server audit latency is outside the frozen natural measurement',async()=>{
 const r=runtime();r.verifyAudits=async()=>{for(let i=0;i<60;i++)await r.sleep();};await runMemory(r);assert.equal(r.summary.elapsedSeconds,7200);
});
