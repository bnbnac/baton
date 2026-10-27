import test from 'node:test';
import assert from 'node:assert/strict';
import {installArmGuard} from './guard.mjs';
import {resolveArm} from './policy.mjs';
function fixture(){let time=0;const events=[],r={born:0,contract:resolveArm('B','full'),now:()=>time,event:async(type,v)=>events.push({type,...v}),tool:async()=>({ok:true}),read:async()=>{},checkStop:async()=>{},docker:async()=>{},ps:async()=>{},waitFor:async check=>check(),service:async()=>{time+=10;},sleep:async ms=>{time+=ms;}};return {r,events,set:v=>{time=v;},guard:installArmGuard(r)};}
test('long preparation does not consume measurement budget',async()=>{
 const f=fixture();f.set(899000);await f.guard.check();f.guard.startMeasurement(899000);f.set(899000+7140000);await f.guard.check();
 assert.equal(f.guard.globalDeadline,899000+7200000);
});
test('expired preparation cannot transition to measurement',async()=>{
 const f=fixture();f.set(900001);await assert.rejects(f.guard.check(),/preparation_deadline/);assert.throws(()=>f.guard.startMeasurement(900001));
 await assert.rejects(f.guard.check());assert.equal(f.events.length,1);
});
test('late response rejects completion and records a single violation',async()=>{
 const f=fixture();f.guard.startMeasurement(0);f.guard.beginRound(60000);f.set(60001);
 await assert.rejects(f.r.tool('status'),/round_deadline/);await assert.rejects(f.guard.check());assert.equal(f.events.length,1);
});
test('slot admission rejects a missed slot, reset or widened deadline',()=>{
 const f=fixture();assert.throws(()=>f.guard.beginRound(60000));f.guard.startMeasurement(0);assert.throws(()=>f.guard.startMeasurement(0));
 f.set(60000);assert.throws(()=>f.guard.beginRound(60000));assert.throws(()=>f.guard.beginRound(7200001));
});
test('freeze grace cannot authorize tool input; cleanup can run after finish',async()=>{
 const f=fixture();f.guard.startMeasurement(0);f.set(7200001);await assert.rejects(f.guard.check(),/measurement_deadline/);
 f.guard.beginFreeze();await f.guard.check();await assert.rejects(f.r.tool('send_text'),/measurement_frozen/);
 f.set(7215001);await assert.rejects(f.guard.check(),/freeze_deadline/);f.guard.finish();await f.r.tool('status');
});
test('during awaits a late operation before returning failure',async()=>{
 const f=fixture();f.guard.startMeasurement(0);f.guard.beginRound(100);let done=false;
 await assert.rejects(f.r.during(async()=>{await new Promise(resolve=>setImmediate(resolve));done=true;}));assert.equal(done,true);
});
test('waitFor caps timeout to the active deadline',async()=>{
 let received;const f=fixture(); // Install on a separate runtime so original waitFor records its argument.
 const r={...f.r,contract:resolveArm('A','preflight'),waitFor:async(check,label,timeout)=>{received=timeout;return true;}};
 const g=installArmGuard(r);g.startMeasurement(0);g.beginRound(60000);f.set(59000);await r.waitFor(()=>true,'x',45000);assert.equal(received,1000);
});
