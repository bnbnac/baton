import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateEvidence, validateScope, parseRust, parseTap } from './receipt.mjs';
test('receipt rejects failed skipped or incomplete suites despite exit zero',()=>{
  assert.throws(()=>parseRust('test result: ok. 150 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out;',[]),/skipped/);
  assert.throws(()=>parseRust('test result: FAILED. 149 passed; 1 failed; 0 ignored;',[]),/failed/);
  assert.throws(()=>parseRust('test present ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored;',['missing']),/required/);
  assert.throws(()=>parseTap('# tests 3\n# pass 2\n# fail 0\n# skipped 1\n# cancelled 0'),/skipped/);
  assert.throws(()=>parseTap('# tests 3\n# pass 2\n# fail 1\n# skipped 0\n# cancelled 0'),/failed/);
  assert.equal(parseTap('# tests 3\n# pass 3\n# fail 0\n# skipped 0\n# cancelled 0').passed,3);
});
test('collector-only claims cannot hide product or test scenario changes',()=>{
  const before={files:{'rust/app/src/main.ts':'one','rust/tests/phase3/receipt.mjs':'old','rust/tests/phase3/integration.test.mjs':'test'},environment:{node:'22'}};
  validateScope(before,{...before,files:{...before.files,'rust/tests/phase3/receipt.mjs':'new'}},'collector_only');
  assert.throws(()=>validateScope(before,{...before,files:{...before.files,'rust/app/src/main.ts':'two'}},'collector_only'),/scope/);
  assert.throws(()=>validateScope(before,{...before,files:{...before.files,'rust/tests/phase3/integration.test.mjs':'changed'}},'collector_only'),/scope/);
  assert.throws(()=>validateScope(before,{...before,environment:{node:'23'}},'collector_only'),/environment/);
  assert.throws(()=>validateScope(before,{...before,files:{...before.files,'rust/tests/phase3/receipt.mjs':'new'}},'fresh'),/source/);
});
test('evidence validation rejects missing files and surviving fixtures, leaving manual observations pending',async()=>{
  const root=fileURLToPath(new URL('../../../artifacts/phase3-receipt-tests/',import.meta.url));await mkdir(root,{recursive:true});const dir=await mkdtemp(join(root,'case-'));
  const path=join(dir,'report.json');const good={outcomes:[{name:'phase3-integration',passed:true}],serverAudit:[{serverObserved:true}],process:{normalExit:true,forcedCleanup:false,descendantAudit:'verified',failure:null},fixtureCleanup:{ssh:true,adapters:true}};
  await assert.rejects(validateEvidence([path],['phase3-integration']),/missing/);
  await writeFile(path,JSON.stringify(good));assert.equal((await validateEvidence([path],['phase3-integration'])).manualSudo,'pending');
  await assert.rejects(validateEvidence([path],['phase3-integration','phase3-sudo']),/required/);
  await writeFile(path,JSON.stringify({...good,fixtureCleanup:{ssh:true,adapters:false}}));await assert.rejects(validateEvidence([path],['phase3-integration']),/fixture/);
  await writeFile(path,JSON.stringify({...good,process:{...good.process,forcedCleanup:true}}));await assert.rejects(validateEvidence([path],['phase3-integration']),/cleanup/);
});
