import test from 'node:test';import assert from 'node:assert/strict';import {runCase} from './helper.mjs';
for(const [name,outcome,rounds] of [['password','ok',0],['host-reject','HostRejected',0],['wrong-password','AuthFailed',0],['encrypted-key','ok',0],['wrong-key-passphrase','AuthFailed',0],['interactive-two-rounds','ok',2],['password-then-interactive','ok',2]]) {
  test(name,async()=>{const r=await runCase(name);assert.equal(r.outcome,outcome);assert.equal(r.events.filter(e=>e.type==='auth-round').length,rounds);assert.equal(r.events.filter(e=>e.type==='shell').length,outcome==='ok'?1:0);if(name==='host-reject')assert.equal(r.events.filter(e=>e.type==='authentication').length,0);});
}
for(const name of ['host-cancel','cancel-before-auth','cancel-between-rounds','cancel-late-success','cancel-before-pty'])test(name,async()=>{
  const r=await runCase(name);assert.equal(r.outcome,'Cancelled');assert.equal(r.events.filter(e=>e.type==='pty').length,0);assert.equal(r.events.filter(e=>e.type==='shell').length,0);
  const dropped=r.messages.findIndex(m=>m.stage==='owned-stream-dropped');assert.ok(dropped>=0&&dropped<r.messages.findIndex(m=>m.outcome),'SDK stream must drop before connection cleanup completes');
  if(name==='cancel-late-success'){assert.equal(r.events.find(e=>e.type==='auth-release-attempted')?.connectionOpen,true);assert.ok(r.messages.some(m=>m.stage==='late-auth-success-observed'));assert.equal(r.events.filter(e=>e.type==='closed').length,1);}
});
