import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sha256} from '../separated/runtime.mjs';
import {RAW_FILES} from './verify.mjs';
import {canStartB,compareArms,readVerifiedArm,writeComparison,readComparison} from './compare.mjs';
export function pair(profile='full'){
 const identity={sources:{'test.mjs':'a'.repeat(64)},binaries:{app:{sha256:'b'.repeat(64)},adapter:{sha256:'c'.repeat(64)}},imageId:'sha256:'+'d'.repeat(64),environment:{platform:'win32',arch:'x64',osRelease:'test',node:'test',webview:'test',playwright:'test'}};
 const arm=(name,start,finish)=>({out:'/arm-'+name,summary:{...structuredClone(identity),scope:'AM',arm:name,profile,status:'finished',owner:name,startedUtc:start,finishedUtc:finish,cleanup:{normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]}},verdict:{arm:name,profile,evidenceValid:true,workloadPassed:true,memoryPassed:profile==='full',phase5Acceptance:false}});
 const a=arm('A','2026-10-27T00:00:00Z','2026-10-27T02:10:00Z'),b=arm('B','2026-10-27T02:11:00Z','2026-10-27T04:21:00Z');if(profile==='preflight')a.verdict.memoryPassed=b.verdict.memoryPassed=null;return {a,b,identity};
}
export async function diskArm(out,value){
 await mkdir(out);await writeFile(join(out,'summary.json'),JSON.stringify(value.summary));const v=structuredClone(value.verdict);v.summarySha256=await sha256(join(out,'summary.json'));v.rawHashes={};
 for(const name of RAW_FILES){await writeFile(join(out,name),'{}\n');v.rawHashes[name]=await sha256(join(out,name));}
 await writeFile(join(out,'attached-memory-verification.json'),JSON.stringify(v));return readVerifiedArm(out);
}
test('valid A memory failure still permits B; comparison retains independent failure',()=>{
 const {a,b,identity}=pair();a.verdict.memoryPassed=false;assert.equal(canStartB(a,identity,'full').allowed,true);const c=compareArms(a,b);assert.equal(c.comparable,true);assert.equal(c.a.memoryPassed,false);assert.equal(c.b.memoryPassed,true);assert.equal(c.memoryPassed,false);assert.equal(c.phase5Acceptance,false);
});
test('preflight pair has no memory verdict and qualifies only when both workloads pass',()=>{
 const {a,b}=pair('preflight');const c=compareArms(a,b);assert.equal(c.comparable,true);assert.equal(c.preflightPassed,true);assert.equal(c.memoryPassed,null);b.verdict.workloadPassed=false;assert.equal(compareArms(a,b).preflightPassed,false);
});
for(const [name,mutate] of Object.entries({invalid:a=>a.verdict.evidenceValid=false,incomplete:a=>a.verdict.workloadPassed=false,cleanup:a=>a.summary.cleanup.normalExit=false,forced:a=>a.summary.cleanup.forcedCleanup=true,leftover:a=>a.summary.cleanup.remainingProcesses=1,arm:a=>a.summary.arm='B',profile:a=>a.summary.profile='preflight',image:a=>a.summary.imageId='sha256:'+'e'.repeat(64),source:a=>a.summary.sources['test.mjs']='e'.repeat(64),environment:a=>a.summary.environment.webview='changed',receipt:a=>a.verdict.profile='preflight'}))test('B gate rejects '+name,()=>{const {a,identity}=pair();mutate(a);assert.equal(canStartB(a,identity,'full').allowed,false);});
for(const [name,mutate] of Object.entries({swapped:(a,b)=>{a.summary.arm='B';b.summary.arm='A';},overlap:(a,b)=>b.summary.startedUtc=a.summary.startedUtc,owner:(a,b)=>b.summary.owner=a.summary.owner,directory:(a,b)=>b.out=a.out,profile:(a,b)=>b.summary.profile='preflight',identity:(a,b)=>b.summary.environment.webview='changed',badTime:(a,b)=>b.summary.startedUtc='invalid'}))test('comparison rejects '+name,()=>{const {a,b}=pair();mutate(a,b);assert.equal(compareArms(a,b).comparable,false);});
test('saved arm hashes are checked without verification rewrite',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-arm-read-'));t.after(()=>rm(dir,{recursive:true,force:true}));const {a}=pair();const saved=await diskArm(join(dir,'a'),a);const before=await readFile(join(saved.out,'attached-memory-verification.json'),'utf8');assert.equal(saved.summary.arm,'A');await writeFile(join(saved.out,'events.jsonl'),'changed\n');await assert.rejects(readVerifiedArm(saved.out),/hash/);assert.equal(await readFile(join(saved.out,'attached-memory-verification.json'),'utf8'),before);
});
test('immutable comparison rechecks arm receipts and rejects collisions/tampering',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-pair-read-'));t.after(()=>rm(dir,{recursive:true,force:true}));const {a,b}=pair('preflight');await diskArm(join(dir,'a'),a);await diskArm(join(dir,'b'),b);const out=join(dir,'comparison.json');await writeComparison(join(dir,'a'),join(dir,'b'),out);assert.equal((await readComparison(out)).preflightPassed,true);await assert.rejects(writeComparison(join(dir,'a'),join(dir,'b'),out));await writeFile(join(dir,'a','attached-memory-verification.json'),'{}');await assert.rejects(readComparison(out),/hash|receipt/);
});
