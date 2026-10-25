import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,realpath} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRuntime,sha256} from '../separated/runtime.mjs';
import {runExperiment,root} from '../separated/run.mjs';
import {compareIdentity,validateConfig} from '../separated/contract.mjs';
import {NativeCasesMailbox} from '../separated/native.mjs';
import {CADENCE} from './policy.mjs';
import {runCadence} from './scenario.mjs';

// Instance-local limits. In-flight operations are awaited, never raced against
// a timer: cleanup must not overlap a late RPC or a pending setup operation.
export function installCadenceGuard(r){
 let enabled=true,roundDeadline=null,reported=false;
 const globalDeadline=r.born+CADENCE.seconds*1000;
 const g={globalDeadline,get deadline(){return Math.min(globalDeadline,roundDeadline??Infinity);},
  beginRound(deadline){roundDeadline=deadline;},betweenRounds(){roundDeadline=null;},finish(){enabled=false;},
  async check(){if(!enabled)return;const observedAt=r.now();if(observedAt<=g.deadline)return;
   const reason=observedAt>globalDeadline?'run_expired':'round_deadline';
   if(!reported){reported=true;await r.event('cadence_deadline',{observedAt,deadline:g.deadline,reason});}throw Error(reason);
  }};
 r.cadenceGuard=g;
 for(const name of ['tool','read','checkStop','docker','ps'])if(typeof r[name]==='function'){
  const original=r[name].bind(r);r[name]=async(...args)=>{await g.check();try{const value=await original(...args);await g.check();return value;}catch(error){await g.check();throw error;}};
 }
 if(r.waitFor){const original=r.waitFor.bind(r);r.waitFor=async(check,label,timeout=45000,options)=>{
  await g.check();try{const result=await original(check,label,enabled?Math.min(timeout,Math.max(0,g.deadline-r.now())):timeout,options);await g.check();return result;}catch(error){await g.check();throw error;}
 };}
 if(r.during)r.during=async operation=>{
  await g.check();let done=false,result,failure;
  const pending=Promise.resolve().then(operation).then(v=>{result=v;},e=>{failure=e;}).finally(()=>{done=true;});
  try{while(!done){await r.service();await r.sleep(100);}}finally{await pending;}
  await g.check();if(failure)throw failure;return result;
 };
 return g;
}

export async function checkBaselines(root,paths,summary){
 const reports=[];
 for(const scope of ['M','F']){
  assert.equal(typeof paths?.[scope],'string','baseline_required_'+scope);
  const dir=resolve(root,paths[scope]),peer=JSON.parse(await readFile(join(dir,'summary.json'),'utf8'));
  const saved=JSON.parse(await readFile(join(dir,'verified.json'),'utf8')),summarySha256=await sha256(join(dir,'summary.json'));
  assert.equal(peer.scope,scope);assert.equal(saved.summarySha256,summarySha256,'baseline_summary_changed');assert.equal(saved.preflightPassed,true,'baseline_not_verified');
  const sources=Object.fromEntries(Object.entries(summary.sources).filter(([p])=>!p.startsWith('rust/tests/phase5/native-cadence/')));
  assert.equal(Object.keys(sources).length,23,'baseline_source_count');
  const comparison=compareIdentity({...summary,sources},peer);assert.equal(comparison.same,true,'baseline_identity:'+comparison.differences.join(','));
  reports.push({scope,evidence:paths[scope],summarySha256,receiptSha256:await sha256(join(dir,'verified.json')),sources:peer.sources});
 }
 return reports;
}

export function createCadenceRuntime(options,deps={}){
 const r=createRuntime({...options,contract:CADENCE},deps);installCadenceGuard(r);
 const manifest=r.manifest.bind(r);r.manifest=async()=>{
  await manifest();const dir='rust/tests/phase5/native-cadence';
  for(const file of (await readdir(join(r.root,dir))).filter(f=>f.endsWith('.mjs')&&!f.endsWith('.test.mjs')&&f!=='test-fixture.mjs'))r.summary.sources[dir+'/'+file]=await sha256(join(r.root,dir,file));
 };
 const setup=r.setup.bind(r);r.setup=async()=>{
  await setup();await r.cadenceGuard.check();
  r.summary.cadenceBaselines=await checkBaselines(r.root,r.config.preflightEvidence,r.summary);await r.save();
 };
 return r;
}

export async function executeCadence(r,scenario){
 const shutdown=r.shutdown.bind(r);r.shutdown=async()=>{r.cadenceGuard?.finish();return shutdown();};
 // The stock lifecycle also records setup failures and attempts every cleanup
 // stage. The diagnostic supplies only its scenario and its separate contract.
 r.contract??=CADENCE;
 return runExperiment(r,{NC:scenario??(runtime=>runCadence(runtime,new NativeCasesMailbox(join(runtime.out,'native'),runtime.owner,runtime.now)))});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [output,configPath]=process.argv.slice(2);assert.ok(output&&configPath,'usage: run.mjs fresh-dir config.json');
 const out=resolve(output),config=validateConfig(JSON.parse((await readFile(resolve(configPath),'utf8')).replace(/^\uFEFF/,'')));
 const artifacts=await realpath(join(root,'artifacts')),parent=await realpath(dirname(out)),rel=relative(artifacts,parent);
 assert.ok((rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))&&out!==artifacts,'output_outside_artifacts');await mkdir(out);
 const r=createCadenceRuntime({root,out,config});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{r.interrupted=true;});
 const s=await executeCadence(r);console.log(JSON.stringify({status:s.status,failure:s.failure,finishedUtc:s.finishedUtc}));if(s.status==='failed')process.exitCode=1;
}
