import assert from 'node:assert/strict';
import {readFile,writeFile,open,realpath,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {compareIdentity} from '../separated/contract.mjs';
import {sha256} from '../separated/runtime.mjs';
import {RAW_FILES} from './verify.mjs';
export const clean=c=>c?.normalExit===true&&c.forcedCleanup===false&&c.remainingProcesses===0&&c.remainingContainers===0&&Array.isArray(c.failures)&&c.failures.length===0;
const time=value=>typeof value==='string'?Date.parse(value):NaN;
function reasonsFor(a,arm,profile){
 const s=a?.summary,v=a?.verdict,reasons=[];
 if(!s||!v)return ['missing_arm'];
 if(s.arm!==arm||v.arm!==arm)reasons.push('wrong_arm');
 if(!['preflight','full'].includes(profile)||s.profile!==profile||v.profile!==profile)reasons.push('wrong_profile');
 if(s.scope!=='AM'||s.status!=='finished'||!Number.isFinite(time(s.startedUtc))||!Number.isFinite(time(s.finishedUtc))||time(s.finishedUtc)<=time(s.startedUtc))reasons.push('unfinished');
 if(v.evidenceValid!==true||v.workloadPassed!==true||v.phase5Acceptance!==false)reasons.push('invalid_workload');
 if(profile==='preflight'?v.memoryPassed!==null:typeof v.memoryPassed!=='boolean')reasons.push('missing_memory_verdict');
 if(!clean(s.cleanup))reasons.push('cleanup');
 return reasons;
}
export function canStartB(a,currentIdentity,profile){
 const reasons=reasonsFor(a,'A',profile);reasons.push(...compareIdentity(a?.summary,currentIdentity).differences);return {allowed:reasons.length===0,reasons};
}
export function compareArms(a,b){
 const profile=a.summary.profile,differences=[...reasonsFor(a,'A',profile).map(p=>'A:'+p),...reasonsFor(b,'B',profile).map(p=>'B:'+p),...compareIdentity(a.summary,b.summary).differences];
 if(time(a.summary.finishedUtc)>time(b.summary.startedUtc))differences.push('overlapping_arms');
 if(!a.summary.owner||!b.summary.owner||a.summary.owner===b.summary.owner)differences.push('shared_owner');
 if(!a.out||!b.out||resolve(a.out)===resolve(b.out))differences.push('shared_directory');
 const comparable=differences.length===0;
 return {profile,comparable,differences,a:a.verdict,b:b.verdict,preflightPassed:profile==='preflight'&&comparable,memoryPassed:profile==='full'&&comparable?a.verdict.memoryPassed&&b.verdict.memoryPassed:null,phase5Acceptance:false,
  limitations:['Single A-then-B order, not randomized replication.','Attached CDP instrumentation remains present.','Equal evaluation cadence does not imply equal action costs.','Arm memory results are independent; A is never subtracted from B.','Original failed combined soak and Phase 5 release block remain.']};
}
export async function readVerifiedArm(out){
 out=await realpath(out);const path=join(out,'attached-memory-verification.json'),receiptSha256=await sha256(path),verdict=JSON.parse(await readFile(path,'utf8'));
 assert.equal(await sha256(join(out,'summary.json')),verdict.summarySha256,'summary_hash');assert.deepEqual(Object.keys(verdict.rawHashes??{}).sort(),[...RAW_FILES].sort(),'raw_hash_keys');
 for(const name of RAW_FILES)assert.equal(await sha256(join(out,name)),verdict.rawHashes[name],'raw_hash:'+name);
 const summary=JSON.parse(await readFile(join(out,'summary.json'),'utf8'));assert.equal(await sha256(join(out,'summary.json')),verdict.summarySha256,'summary_hash');assert.equal(await sha256(path),receiptSha256,'receipt_hash');
 assert.equal(summary.arm,verdict.arm);assert.equal(summary.profile,verdict.profile);return {out,summary,verdict,receiptSha256};
}
const pointer=a=>({out:a.out,receiptSha256:a.receiptSha256,summarySha256:a.verdict.summarySha256});
export async function writeComparison(aDir,bDir,out){
 try{await access(out);throw Error('comparison_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const claim=await open(out+'.claim','wx');await claim.close();
 const a=await readVerifiedArm(aDir),b=await readVerifiedArm(bDir),result={...compareArms(a,b),aEvidence:pointer(a),bEvidence:pointer(b)};
 await writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
export async function readComparison(path){
 const hash=await sha256(path),saved=JSON.parse(await readFile(path,'utf8')),a=await readVerifiedArm(saved.aEvidence.out),b=await readVerifiedArm(saved.bEvidence.out);
 assert.deepEqual(saved.aEvidence,pointer(a),'A_receipt_hash');assert.deepEqual(saved.bEvidence,pointer(b),'B_receipt_hash');assert.deepEqual(saved,{...compareArms(a,b),aEvidence:pointer(a),bEvidence:pointer(b)},'comparison_changed');assert.equal(await sha256(path),hash,'comparison_hash');return saved;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [a,b,out]=process.argv.slice(2);assert.ok(a&&b&&out,'usage: compare.mjs A-dir B-dir fresh-result.json');const result=await writeComparison(resolve(a),resolve(b),resolve(out));console.log(JSON.stringify(result,null,2));if(!result.comparable||result.memoryPassed===false)process.exitCode=1;
}
