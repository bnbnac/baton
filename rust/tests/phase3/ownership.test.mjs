import test from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from './fixture.mjs';
test('private output never enters MCP and re-handoff creates a new public stream',async()=>{
  const report=await runCase('phase3-ownership');
  assert.deepEqual(report.outcomes,[{name:'phase3-ownership',passed:true}]);
  assert.equal(report.process.normalExit,true);assert.equal(report.process.forcedCleanup,false);assert.equal(report.process.descendantAudit,'verified');
  assert.ok(report.serverAudit.length>0);assert.equal(report.fixtureCleanup.ssh,true);assert.equal(report.fixtureCleanup.adapters,true);
});
