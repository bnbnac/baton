import assert from 'node:assert/strict';
import {readFile,writeFile,open,access,unlink,realpath} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {release as osRelease} from 'node:os';
import {reserveLaunch,freshPath,root as workspace} from '../separated/run.mjs';
import {sha256} from '../separated/runtime.mjs';
import {compareIdentity,validateConfig} from '../separated/contract.mjs';
import {checkBaselines} from '../minimal-cdp-cadence/run.mjs';
import {createAttachedRuntime} from './run.mjs';
import {resolveArm} from './policy.mjs';
import {readVerifiedArm,readComparison,canStartB,clean} from './compare.mjs';
const execute=promisify(execFile),json=async p=>JSON.parse((await readFile(p,'utf8')).replace(/^\uFEFF/,''));
const lockPath=root=>join(root,'artifacts','attached-memory.active.json');
const exclusive=async(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
async function absent(path){try{await access(path);throw Error('output_already_exists:'+path);}catch(e){if(e.code!=='ENOENT')throw e;}}
export async function collectIdentity(root,configPath){
 const config=validateConfig(await json(configPath)),r=createAttachedRuntime({root,out:join(root,'artifacts'),config,arm:'A',profile:'preflight'});
 await r.manifest();const peer=await json(join(resolve(root,config.preflightEvidence?.M??''),'summary.json'));
 // WebView's actual version is only knowable after its fresh process starts.
 // Freeze the required baseline version now; runner setup must match it.
 r.summary.environment={platform:process.platform,arch:process.arch,osRelease:osRelease(),node:process.version,webview:peer.environment.webview,playwright:(await json(join(dirname(config.playwrightPath),'package.json'))).version};
 r.summary.imageId=(await execute('docker',['image','inspect',config.imageId,'--format','{{.Id}}'],{cwd:root,windowsHide:true})).stdout.trim();assert.equal(r.summary.imageId,config.imageId);
 const cadenceBaselines=await checkBaselines(r);return {sources:r.summary.sources,binaries:r.summary.binaries,imageId:r.summary.imageId,environment:r.summary.environment,cadenceBaselines};
}
export async function validateEligibility({arm,profile,aEvidence,preflightPair},identity){
 resolveArm(arm,profile);const references=[];
 if(profile==='full'){
  assert.ok(preflightPair,'preflight_required');const path=resolve(preflightPair),hash=await sha256(path),pair=await readComparison(path);
  assert.equal(pair.preflightPassed,true,'preflight_invalid');assert.equal(pair.profile,'preflight');
  for(const p of [pair.aEvidence,pair.bEvidence]){const a=await readVerifiedArm(p.out);assert.equal(compareIdentity(a.summary,identity).same,true,'preflight_identity');}
  assert.equal(await sha256(path),hash,'preflight_changed');references.push({path,sha256:hash});
 }else assert.ok(!preflightPair,'unexpected_preflight_reference');
 if(arm==='B'){
  assert.ok(aEvidence,'A_required');const a=await readVerifiedArm(aEvidence),gate=canStartB(a,identity,profile);assert.equal(gate.allowed,true,'A_ineligible:'+gate.reasons.join(','));
  assert.ok(Date.parse(a.summary.finishedUtc)<=Date.now(),'A_not_finished');references.push({path:join(a.out,'attached-memory-verification.json'),sha256:a.receiptSha256});
 }else assert.ok(!aEvidence,'unexpected_A_reference');
 return references;
}
export async function validateRunnerInputs(root,out,configPath,arm,profile,currentIdentity){
 const claim=await json(out+'.claim.json'),lock=await json(lockPath(root)),snapshot=await json(out+'.inputs.json');
 assert.equal(claim.out,out);assert.equal(lock.out,out);assert.equal(lock.token,claim.token);assert.equal(snapshot.token,claim.token);assert.equal(await sha256(out+'.inputs.json'),claim.inputsSha256,'inputs_hash');
 assert.equal(snapshot.arm,arm);assert.equal(snapshot.profile,profile);assert.equal(snapshot.configPath,resolve(configPath));assert.equal(await sha256(configPath),snapshot.configSha256,'config_hash');
 for(const [path,hash] of Object.entries(snapshot.identity.sources))assert.equal(await sha256(resolve(root,path)),hash,'source_hash:'+path);
 for(const b of Object.values(snapshot.identity.binaries))assert.equal(await sha256(b.path),b.sha256,'binary_hash');
 for(const b of snapshot.identity.cadenceBaselines??[]){const dir=resolve(root,b.evidence);assert.equal(await sha256(join(dir,'summary.json')),b.summarySha256,'baseline_summary_hash');assert.equal(await sha256(join(dir,'verified.json')),b.receiptSha256,'baseline_receipt_hash');}
 if(currentIdentity)assert.equal(compareIdentity(snapshot.identity,currentIdentity).same,true,'runner_identity');
 const references=await validateEligibility(snapshot,snapshot.identity);assert.deepEqual(references,snapshot.references,'eligibility_reference_changed');
 assert.equal(await sha256(out+'.inputs.json'),claim.inputsSha256,'inputs_hash');return snapshot;
}
export async function releaseRunnerLock(root,out,summary){
 assert.ok(clean(summary.cleanup),'unclean_runner');const claim=await json(out+'.claim.json'),lock=await json(lockPath(root));assert.equal(lock.out,out,'foreign_lock');assert.equal(lock.token,claim.token,'foreign_lock');await unlink(lockPath(root));
}
async function spawnRunner(args,options,configPath){
 const child=spawn(process.execPath,args,options);await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',no);});child.unref();
 const config=await json(configPath),command=`(Get-Process -Id ${child.pid}).StartTime.ToUniversalTime().ToString('o')`;
 const startedUtc=(await execute(config.pwsh,['-NoProfile','-Command',command],{windowsHide:true})).stdout.trim();assert.ok(Number.isFinite(Date.parse(startedUtc)),'runner_start_identity');return {pid:child.pid,startedUtc};
}
export async function launchArm(options,deps={}){
 const root=await realpath(deps.root??workspace),out=resolve(options.out),configPath=resolve(options.configPath),arm=options.arm,profile=options.profile;
 resolveArm(arm,profile);await freshPath(root,out);for(const suffix of ['.claim.json','.inputs.json'])await absent(out+suffix);
 const aEvidence=options.aEvidence?await realpath(options.aEvidence):undefined,preflightPair=options.preflightPair?await realpath(options.preflightPair):undefined;
 const configSha256=await sha256(configPath),identity=await (deps.identity??collectIdentity)(root,configPath),references=await validateEligibility({arm,profile,aEvidence,preflightPair},identity);
 assert.equal(await sha256(configPath),configSha256,'config_changed');const commit=await (deps.commit??(async()=> (await execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true})).stdout.trim()))();
 const token=randomUUID(),snapshot={out,configPath,arm,profile,aEvidence,preflightPair,token,commit,configSha256,identity,references};
 // The global reservation is deliberately retained after a crash: never infer
 // that an absent launcher means its child/resources are gone.
 await exclusive(lockPath(root),{out,token,reservedUtc:new Date().toISOString()});
 const {record,log}=await reserveLaunch(root,out);
 try{
  await exclusive(out+'.inputs.json',snapshot);await exclusive(out+'.claim.json',{out,token,inputsSha256:await sha256(out+'.inputs.json')});
  await validateRunnerInputs(root,out,configPath,arm,profile,identity);
  const child=await (deps.spawn??((args,opts)=>spawnRunner(args,opts,configPath)))([join(root,'rust/tests/phase5/attached-memory/run.mjs'),out,configPath,arm,profile],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
  assert.ok(Number.isInteger(child.pid)&&child.pid>0&&Number.isFinite(Date.parse(child.startedUtc)),'runner_identity');
  const receipt={...child,out,configPath,arm,profile,commit,configSha256,token,status:'launched',launchedUtc:new Date().toISOString()};await record.writeFile(JSON.stringify(receipt,null,2)+'\n');return receipt;
 }catch(error){await record.writeFile(JSON.stringify({status:'launch_failed',out,token,error:String(error),failedUtc:new Date().toISOString()},null,2)+'\n');throw error;}
 finally{await log.close();await record.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [out,configPath,arm,profile,...flags]=process.argv.slice(2),options={out,configPath,arm,profile};assert.ok(out&&configPath,'usage: launch.mjs out config A|B preflight|full [--a dir] [--preflight comparison.json]');
 for(let i=0;i<flags.length;i+=2){assert.ok(['--a','--preflight'].includes(flags[i])&&flags[i+1],'invalid_argument');const key=flags[i]==='--a'?'aEvidence':'preflightPair';assert.ok(!options[key],'duplicate_argument');options[key]=flags[i+1];}
 console.log(JSON.stringify(await launchArm(options),null,2));
}
