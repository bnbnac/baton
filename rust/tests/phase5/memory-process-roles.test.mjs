import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const execute=promisify(execFile),pwsh='C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const script=resolve('rust/scripts/sample-test-process-roles.ps1');
test('sampler verifies start time, ownership and duplicate identity; exited check only reports matching live identities',async()=>{
 const ticks=(await execute(pwsh,['-NoProfile','-Command',`(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().Ticks.ToString()`],{windowsHide:true})).stdout.trim();
 const dir=await mkdtemp(join(tmpdir(),'baton-memory-roles-')),file=join(dir,'receipt.json');
 const evidence={pid:process.pid,startedTicks:ticks,adapters:[],descendants:[]};
 const run=async(value,extra=[])=>{await writeFile(file,JSON.stringify(value));return execute(pwsh,['-NoProfile','-File',script,'-Evidence',file,...extra],{windowsHide:true,timeout:15000});};
 try{
  const live=JSON.parse((await run(evidence)).stdout);assert.equal(live[0].role,'app');assert.equal(live[0].pid,process.pid);assert.ok(live[0].privateBytes>0);
  const remaining=JSON.parse((await run(evidence,['-VerifyExited'])).stdout);assert.equal(remaining.length,1);
  await assert.rejects(run({...evidence,startedTicks:'1'}),e=>e.stderr.includes('identity_changed'));
  assert.deepEqual(JSON.parse((await run({...evidence,startedTicks:'1'},['-VerifyExited'])).stdout),[]);
  await assert.rejects(run({...evidence,adapters:[{pid:process.pid,startedTicks:ticks}]}),e=>e.stderr.includes('duplicate_pid'));
  await assert.rejects(run({...evidence,descendants:[{pid:123,startedTicks:'1',exited:false,dataDirectoryMatch:false}]}),e=>e.stderr.includes('unowned_descendant'));
 }finally{await rm(file,{force:true});await rmdir(dir);}
});
