import assert from 'node:assert/strict';
import {mkdir,open,access,realpath,readFile} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRuntime,sha256} from './runtime.mjs';
import {resolveContract,validateConfig,compareIdentity} from './contract.mjs';
import {runMemory} from './memory.mjs';
import {runFunctional} from './transitions.mjs';
import {runNative,NativeCasesMailbox} from './native.mjs';
import {loadEvidence,verifyEvidence} from './verify.mjs';
export const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
export async function freshPath(root,out){
 const artifacts=await realpath(join(root,'artifacts')),parent=await realpath(dirname(out)),rel=relative(artifacts,join(parent,out.slice(dirname(out).length+1)));
 assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'output_outside_artifacts');
 for(const path of [out,out+'.log',out+'.launch.json'])try{await access(path);throw Error('output_already_exists:'+path);}catch(e){if(e.code!=='ENOENT')throw e;}
}
export async function reserveLaunch(root,out){await freshPath(root,out);const record=await open(out+'.launch.json','wx');try{return {record,log:await open(out+'.log','wx')};}catch(e){await record.close();throw e;}}
export async function runExperiment(r,scenarios={M:runMemory,F:runFunctional,N:runtime=>runNative(runtime,new NativeCasesMailbox(join(runtime.out,'native'),runtime.owner,runtime.now))}){
 let failure;
 try{
  await r.init();await r.setup();
  if(r.contract.profile==='full'&&['M','F'].includes(r.contract.scope)){
   const path=r.config.preflightEvidence?.[r.contract.scope];assert.ok(path,'preflight_required');const dir=resolve(r.root,path),e=await loadEvidence(dir),v=verifyEvidence(e),saved=JSON.parse(await readFile(join(dir,'verified.json'),'utf8'));
   assert.equal(v.preflightPassed,true,'preflight_invalid');assert.equal(e.summary.scope,r.contract.scope);assert.equal(saved.summarySha256,await sha256(join(dir,'summary.json')));assert.equal(compareIdentity(e.summary,r.summary).same,true,'preflight_identity');
  }
  await scenarios[r.contract.scope](r);
 }catch(e){failure=String(e);}
 try{await r.shutdown();}catch(e){failure??=String(e);r.summary.shutdownFailure=String(e);}
 try{const cleanup=await r.cleanup();if(!cleanup.normalExit||cleanup.forcedCleanup||cleanup.remainingProcesses||cleanup.remainingContainers||cleanup.failures.length)failure??='cleanup_failed';}catch(e){failure??=String(e);r.summary.cleanupFailure=String(e);}
 try{await r.checkHashes();}catch(e){failure??=String(e);}
 r.summary.status=failure?'failed':'finished';if(failure)r.summary.failure=failure;r.summary.finishedUtc=new Date().toISOString();await r.save();return r.summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [output,configPath,scope,profile]=process.argv.slice(2);assert.ok(output&&configPath,'usage: run.mjs fresh-dir config.json M|F|N preflight|full');const out=resolve(output),contract=resolveContract(scope,profile),config=validateConfig(JSON.parse((await readFile(resolve(configPath),'utf8')).replace(/^\uFEFF/,'')));
 // Launcher owns sibling reservation files; mkdir itself is the runner's exclusive claim.
 const artifacts=await realpath(join(root,'artifacts')),parent=await realpath(dirname(out)),rel=relative(artifacts,parent);assert.ok((rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))&&out!==artifacts,'output_outside_artifacts');await mkdir(out);
 const r=createRuntime({root,out,config,contract});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{r.interrupted=true;});const s=await runExperiment(r);console.log(JSON.stringify({status:s.status,failure:s.failure,finishedUtc:s.finishedUtc}));if(s.status==='failed')process.exitCode=1;
}
