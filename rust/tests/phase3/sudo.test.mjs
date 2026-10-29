import test from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from './fixture.mjs';
test('synthetic sudo authentication stays private and intervention never executes commands',async()=>{
  const report=await runCase('phase3-sudo');
  assert.deepEqual(report.outcomes,[{name:'phase3-sudo',passed:true}]);
  assert.equal(report.process.normalExit,true);assert.equal(report.process.forcedCleanup,false);assert.equal(report.process.descendantAudit,'verified');
  assert.ok(report.serverAudit.some(a=>a.sudo===2&&a.auth===1&&a.forbidden===0));assert.equal(report.fixtureCleanup.ssh,true);assert.equal(report.fixtureCleanup.adapters,true);
});
