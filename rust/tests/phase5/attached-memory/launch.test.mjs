import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256} from '../separated/runtime.mjs';
import {RAW_FILES} from './verify.mjs';
import {writeComparison} from './compare.mjs';
import {launchArm,validateEligibility,validateRunnerInputs,releaseRunnerLock,collectIdentity} from './launch.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'baton-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'artifacts'));const out=join(root,'artifacts','a'),configPath=join(root,'config.json');await writeFile(configPath,'{}');await writeFile(join(root,'source.mjs'),'source');await writeFile(join(root,'app'),'app');await writeFile(join(root,'adapter'),'adapter');
 const identity={sources:{'source.mjs':await sha256(join(root,'source.mjs'))},binaries:{app:{path:join(root,'app'),sha256:await sha256(join(root,'app'))},adapter:{path:join(root,'adapter'),sha256:await sha256(join(root,'adapter'))}},imageId:'sha256:'+'d'.repeat(64),environment:{platform:'win32',arch:'x64',osRelease:'test',node:'test',webview:'test',playwright:'test'}};
 const spawned=[],deps={root,identity:async()=>structuredClone(identity),commit:async()=>'commit',spawn:async(args,options)=>{spawned.push({args,options});return {pid:12345,startedUtc:'2026-10-27T00:00:00Z'};}};return {root,out,configPath,identity,spawned,deps,options:{out,configPath,arm:'A',profile:'preflight'}};
}
test('launch reserves immutable inputs and records hidden child identity',async t=>{
 const f=await fixture(t),r=await launchArm(f.options,f.deps);assert.equal(r.pid,12345);assert.equal(r.startedUtc,'2026-10-27T00:00:00Z');assert.equal(r.commit,'commit');assert.equal(r.configSha256,await sha256(f.configPath));assert.equal(f.spawned.length,1);assert.equal(f.spawned[0].options.windowsHide,true);assert.equal(f.spawned[0].options.detached,true);await access(f.out+'.claim.json');const snapshot=await validateRunnerInputs(f.root,f.out,f.configPath,'A','preflight',f.identity);assert.deepEqual(snapshot.identity,f.identity);
});
for(const suffix of ['', '.log','.launch.json','.claim.json','.inputs.json'])test('existing '+(suffix||'directory')+' prevents launch without spawning',async t=>{
 const f=await fixture(t);if(suffix)await writeFile(f.out+suffix,'old');else await mkdir(f.out);await assert.rejects(launchArm(f.options,f.deps));assert.equal(f.spawned.length,0);
});
test('failed spawn preserves error receipt and consumed paths without retry',async t=>{
 const f=await fixture(t);f.deps.spawn=async()=>{throw Error('spawn_failed');};await assert.rejects(launchArm(f.options,f.deps),/spawn_failed/);const r=JSON.parse(await readFile(f.out+'.launch.json','utf8'));assert.equal(r.status,'launch_failed');assert.match(r.error,/spawn_failed/);await assert.rejects(launchArm(f.options,f.deps));
});
test('a second arm cannot launch while an earlier reservation remains active',async t=>{
 const f=await fixture(t);await launchArm(f.options,f.deps);await assert.rejects(launchArm({...f.options,out:join(f.root,'artifacts','another')},f.deps),/active|EEXIST/);assert.equal(f.spawned.length,1);
});
test('B first, full without preflight and wrong profile are rejected',async t=>{
 const f=await fixture(t);for(const patch of [{arm:'B'},{profile:'full'},{profile:'invalid'}])await assert.rejects(launchArm({...f.options,...patch},f.deps));assert.equal(f.spawned.length,0);
});
test('runner rejects source/config changes and mismatched arm after precheck',async t=>{
 const f=await fixture(t);await launchArm(f.options,f.deps);await assert.rejects(validateRunnerInputs(f.root,f.out,f.configPath,'B','preflight',f.identity));await writeFile(join(f.root,'source.mjs'),'changed');await assert.rejects(validateRunnerInputs(f.root,f.out,f.configPath,'A','preflight',f.identity),/source/);await writeFile(join(f.root,'source.mjs'),'source');await writeFile(f.configPath,'{"changed":true}');await assert.rejects(validateRunnerInputs(f.root,f.out,f.configPath,'A','preflight',f.identity),/config/);
});
test('runner actual environment mismatch blocks before measurement',async t=>{
 const f=await fixture(t);await launchArm(f.options,f.deps);const changed=structuredClone(f.identity);changed.environment.webview='updated';await assert.rejects(validateRunnerInputs(f.root,f.out,f.configPath,'A','preflight',changed),/identity/);
});
test('runner cannot bypass launch, edit snapshot, or release a foreign/unclean lock',async t=>{
 const f=await fixture(t);await assert.rejects(validateRunnerInputs(f.root,f.out,f.configPath,'A','preflight',f.identity));await launchArm(f.options,f.deps);await assert.rejects(releaseRunnerLock(f.root,f.out,{cleanup:{normalExit:false}}));await assert.rejects(releaseRunnerLock(f.root,join(f.root,'artifacts','foreign'),{cleanup:{normalExit:true}}));const snapshot=JSON.parse(await readFile(f.out+'.inputs.json','utf8'));snapshot.identity.environment.webview='forged';await writeFile(f.out+'.inputs.json',JSON.stringify(snapshot));await assert.rejects(validateRunnerInputs(f.root,f.out,f.configPath,'A','preflight',f.identity),/hash/);
});
test('normal owned cleanup releases only the active lock and preserves receipts',async t=>{
 const f=await fixture(t);await launchArm(f.options,f.deps);await releaseRunnerLock(f.root,f.out,{cleanup:{normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]}});await access(f.out+'.claim.json');await launchArm({...f.options,out:join(f.root,'artifacts','next')},f.deps);assert.equal(f.spawned.length,2);
});
async function savedArm(f,name,profile,memoryPassed){
 const out=join(f.root,'artifacts',profile+'-'+name);await mkdir(out);const summary={...f.identity,scope:'AM',arm:name,profile,status:'finished',owner:profile+name,startedUtc:name==='A'?'2020-01-01T00:00:00Z':'2020-01-01T03:00:00Z',finishedUtc:name==='A'?'2020-01-01T02:00:00Z':'2020-01-01T05:00:00Z',cleanup:{normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]}};
 await writeFile(join(out,'summary.json'),JSON.stringify(summary));const verdict={arm:name,profile,evidenceValid:true,workloadPassed:true,memoryPassed,phase5Acceptance:false,summarySha256:await sha256(join(out,'summary.json')),rawHashes:{}};
 for(const name of RAW_FILES){await writeFile(join(out,name),'{}\n');verdict.rawHashes[name]=await sha256(join(out,name));}await writeFile(join(out,'attached-memory-verification.json'),JSON.stringify(verdict));return out;
}
async function preflight(f){const a=await savedArm(f,'A','preflight',null),b=await savedArm(f,'B','preflight',null),out=join(f.root,'artifacts','preflight-comparison.json');await writeComparison(a,b,out);return out;}
test('full B accepts successful preflight and complete A with failed memory',async t=>{
 const f=await fixture(t),preflightPair=await preflight(f),aEvidence=await savedArm(f,'A','full',false);const options={...f.options,arm:'B',profile:'full',preflightPair,aEvidence};await launchArm(options,f.deps);assert.equal(f.spawned.length,1);await validateRunnerInputs(f.root,f.out,f.configPath,'B','full',f.identity);
});
test('stale preflight and changed baseline identity reject full launch',async t=>{
 const f=await fixture(t),preflightPair=await preflight(f),changed=structuredClone(f.identity);changed.environment.webview='new';await assert.rejects(validateEligibility({arm:'A',profile:'full',preflightPair},changed),/identity/);await writeFile(join(f.root,'artifacts','preflight-A','events.jsonl'),'changed');await assert.rejects(launchArm({...f.options,profile:'full',preflightPair},f.deps),/hash/);assert.equal(f.spawned.length,0);
});
test('eligibility evidence changed after reservation blocks runner',async t=>{
 const f=await fixture(t),aEvidence=await savedArm(f,'A','preflight',null);await launchArm({...f.options,arm:'B',aEvidence},f.deps);await writeFile(join(aEvidence,'output.jsonl'),'changed');await assert.rejects(validateRunnerInputs(f.root,f.out,f.configPath,'B','preflight',f.identity),/hash/);
});
