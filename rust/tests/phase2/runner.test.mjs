import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,cp,readFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkTap,checkRust,checkDesktop,checkManual,checkIdentity} from './evidence.mjs';
const tap='ok 1 - required case\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const rust='Running tests/input.rs (target/input.exe)\ntest required_case ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out;\n';
test('gate counts actual TAP results and rejects missing, skipped, or cancelled cases',()=>{
 assert.deepEqual(checkTap(tap,['required case']),{passed:1,failed:0,skipped:0});
 for(const bad of [tap.replace('required case','other case'),tap.replace('# skipped 0','# skipped 1'),tap.replace('# cancelled 0','# cancelled 1'),tap.replace('ok 1','not ok 1'),tap.replace('1..1','1..2')])assert.throws(()=>checkTap(bad,['required case']));
});
test('gate rejects absent Rust suites, ignored tests, and filtered runs',()=>{
 assert.deepEqual(checkRust(rust,['input'],['required_case']),{passed:1,failed:0,skipped:0});
 for(const bad of [rust.replace('input.rs','other.rs'),rust.replace('required_case','other_case'),rust.replace('0 ignored','1 ignored'),rust.replace('0 filtered','1 filtered')])assert.throws(()=>checkRust(bad,['input'],['required_case']));
});
const desktop=()=>({webviewVersion:'154.0.4258.37',outcomes:[{name:'cpr_agent_owned',passed:true}],process:{pid:123,startedTicks:'123456789012345678',path:'app.exe',normalExit:true,forcedCleanup:false,descendantAudit:'verified',descendants:[{pid:124,startedTicks:'123456789012345679',path:'webview.exe',parent:123,dataDirectoryMatch:true,exited:true}]}});
test('gate rejects missing desktop case and any unobserved or forced normal-close cleanup',()=>{
 checkDesktop(desktop(),['cpr_agent_owned']);
 for(const mutate of [d=>d.outcomes=[],d=>d.outcomes[0].passed=false,d=>d.process.descendantAudit='unverified',d=>d.process.descendants[0].exited=false,d=>d.process.descendants[0].path=null,d=>d.process.forcedCleanup=true,d=>d.process.descendants=[]]){const d=desktop();mutate(d);assert.throws(()=>checkDesktop(d,['cpr_agent_owned']));}
});
test('gate rejects changed source, lock, or executable identity',()=>{
 const a={sourceDigest:'a',cargoLock:'b',npmLock:'c',productExecutable:'d',acceptanceExecutable:'e'};
 checkIdentity(a,{...a});for(const key of Object.keys(a))assert.throws(()=>checkIdentity(a,{...a,[key]:'changed'}));
});
test('missing manual observations stay pending and stale or absent evidence is rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-manual-gate-'));
 const identity={sourceDigest:'a',cargoLock:'b',npmLock:'c',productExecutable:'d',acceptanceExecutable:'e'};
 assert.equal(await checkManual(null,identity,dir),false);
 const file=join(dir,'screen.png');await writeFile(file,'synthetic test image');
 const sha256=createHash('sha256').update(await readFile(file)).digest('hex');
 const receipt={identity:{...identity},runId:'run',startedUtc:'2026-09-28T00:00:00Z',finishedUtc:'2026-09-28T01:00:00Z',os:'Windows',webviewVersion:'154',cases:[{id:'physical-key',confirmedBy:'tester',observedUtc:'2026-09-28T00:30:00Z',screenshots:[{path:file,sha256}],audit:{path:join(dir,'missing.json'),sha256},modes:['user_owned','agent_owned']}]};
 await assert.rejects(()=>checkManual(receipt,identity,dir,['physical-key']));
 receipt.identity.sourceDigest='old';await assert.rejects(()=>checkManual(receipt,identity,dir,['physical-key']));
 receipt.identity={...identity};
 const audit={identity,runId:'run',caseId:'physical-key',observations:[{mode:'user_owned',expectedHex:'41',receivedHex:'41',serverObserved:true},{mode:'agent_owned',expectedHex:'',receivedHex:'',serverObserved:true}]};
 const auditPath=join(dir,'audit.json');await writeFile(auditPath,JSON.stringify(audit));receipt.cases[0].audit={path:auditPath,sha256:createHash('sha256').update(await readFile(auditPath)).digest('hex')};
 assert.equal(await checkManual(receipt,identity,dir,['physical-key']),true);
 await unlink(file);await assert.rejects(()=>checkManual(receipt,identity,dir,['physical-key']));
});
test('copied verification runner propagates an external command exit code',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-runner-copy-'));
 await cp(new URL('../../scripts/verify-phase-2.ps1',import.meta.url),join(dir,'verify-phase-2.ps1'));
 await cp(new URL('../../scripts/probe-identity.ps1',import.meta.url),join(dir,'probe-identity.ps1'));
 const fake=join(dir,'cargo.ps1');await writeFile(fake,'exit 7\n');
 const run=spawnSync('pwsh',['-NoProfile','-File',join(dir,'verify-phase-2.ps1'),'-TestCargoExecutable',fake,'-RepositoryRoot',process.cwd(),'-OutputDirectory',join(dir,'out')],{encoding:'utf8',windowsHide:true});
 assert.equal(run.status,1,run.stdout+run.stderr);
 const summary=JSON.parse(await readFile(join(dir,'out','summary.json'),'utf8'));
 assert.equal(summary.failure,'fmt_exit_7');
});
test('manual recorder preserves partial observations without declaring them complete',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-record-manual-'));
 const identity={sourceDigest:'a',cargoLock:'b',npmLock:'c',productExecutable:'d',acceptanceExecutable:'e'};
 await writeFile(join(dir,'metadata.json'),JSON.stringify({identity,runId:'manual-run',os:'Windows',startedUtc:'2026-09-28T00:00:00Z',finishedUtc:'2026-09-28T01:00:00Z'}));
 await writeFile(join(dir,'result.json'),JSON.stringify({webviewVersion:'154'}));await writeFile(join(dir,'identity-current.json'),JSON.stringify(identity));
 await writeFile(join(dir,'observations.jsonl'),['user_owned','agent_owned'].map(mode=>JSON.stringify({caseId:'physical-key',mode,receivedHex:mode==='user_owned'?'41':'',serverObserved:true,observedUtc:'2026-09-28T00:30:00Z'})).join('\n'));
 await writeFile(join(dir,'screen.png'),'synthetic image');
 const observations=join(dir,'user.json');await writeFile(observations,JSON.stringify({cases:[{id:'physical-key',confirmedBy:'test author',screenshots:['screen.png'],userExpectedHex:'41',agentExpectedHex:''}]}));
 const output=join(dir,'receipt.json');const args=[fileURLToPath(new URL('./record-manual.mjs',import.meta.url)),dir,observations,output];
 let result=spawnSync(process.execPath,args,{windowsHide:true,encoding:'utf8'});assert.equal(result.status,2,result.stdout+result.stderr);
 const receipt=JSON.parse(await readFile(output,'utf8'));assert.equal(receipt.cases.length,1);assert.equal(receipt.cases[0].confirmedBy,'test author');assert.equal(receipt.status,'manual_pending');
 await unlink(join(dir,'screen.png'));result=spawnSync(process.execPath,args,{windowsHide:true,encoding:'utf8'});assert.equal(result.status,1,result.stdout+result.stderr);
});
