import assert from 'node:assert/strict';
import {open,readdir,mkdir,readFile,realpath} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRuntime,sha256} from '../separated/runtime.mjs';
import {root,runExperiment} from '../separated/run.mjs';
import {validateConfig} from '../separated/contract.mjs';
import {checkBaselines} from '../minimal-cdp-cadence/run.mjs';
import {sampleAttached} from '../minimal-cdp-cadence/sampling.mjs';
import {resolveArm} from './policy.mjs';
import {installArmGuard} from './guard.mjs';
import {runAttachedArm} from './scenario.mjs';

export async function diagnosticSources(base){
 if(base instanceof URL)base=fileURLToPath(base);
 const paths=[];
 for(const dir of ['native-cadence','minimal-cdp-cadence','attached-memory']){
  const relativeDir='rust/tests/phase5/'+dir;
  for(const name of await readdir(join(base,relativeDir)))if((name.endsWith('.mjs')||name.endsWith('.ps1'))&&!name.endsWith('.test.mjs')&&name!=='test-fixture.mjs')paths.push(relativeDir+'/'+name);
 }
 return paths.sort();
}
export function createAttachedRuntime({arm,profile,...options},deps={}){
 const r=createRuntime({...options,contract:resolveArm(arm,profile)},deps);installArmGuard(r);
 Object.assign(r.summary,{arm,evaluations:{preparation:{calls:0,queries:0,actions:0},measurement:{calls:0,queries:0,actions:0}}});
 Object.assign(r.summary.instrumentation,{evaluateCalls:0,domActions:0,domQueries:0,heapDiagnosticCalls:0,jsProbes:0});
 const event=r.event.bind(r);r.event=async(type,detail={})=>{
  const row=await event(type,detail);
  if(type==='cdp'&&detail.kind==='request'&&detail.method==='Runtime.evaluate'){
   const count=r.summary.evaluations[r.loadStart===undefined?'preparation':'measurement'];count.calls++;count[detail.action==='identity'?'queries':'actions']++;
  }
  return row;
 };
 const init=r.init.bind(r);r.init=async()=>{await init();for(const name of ['cdp.jsonl','memory-post.jsonl']){const file=await open(join(r.out,name),'wx');await file.close();}};
 r.startMeasurement=async()=>{
  await r.cadenceGuard.check();const row=await r.event('measurement_start'),start=r.born+row.t;r.cadenceGuard.startMeasurement(start);
  r.loadStart=start;r.measurementStartT=row.t;
  for(const s of r.sessions){s.startCount=s.oracle.count;s.privateMs=0;}
  r.summary.loadStartedUtc=row.utc;r.summary.status='running';await r.save();
 };
 r.freeze=async()=>{
  assert.ok(!r.measurementFrozen,'duplicate_freeze');r.measurementFrozen=true;const row=await r.event('measurement_end');
  r.summary.elapsedSeconds=(row.t-r.measurementStartT)/1000;r.summary.loadFinishedUtc=row.utc;
  await r.json('normal-boundary.json',{elapsedSeconds:r.summary.elapsedSeconds,finishedUtc:row.utc,eventSeq:row.seq,samples:r.summary.samples.length});await r.save();
 };
 // Reuse the validated collector through a forwarding view: a collection that
 // lands at/after the fixed end is preserved separately, never in the verdict.
 r.sampleMemory=async()=>{
  const view=Object.create(r);view.summary={...r.summary,samples:[]};view.identities=r.identities;
  view.append=async(name,row)=>r.append(name==='memory.jsonl'&&row.elapsed>=r.contract.seconds?'memory-post.jsonl':name,row);
  await sampleAttached(view);r.identities=view.identities;
  for(const s of view.summary.samples)if(s.elapsed<r.contract.seconds)r.summary.samples.push(s);
 };
 const manifest=r.manifest.bind(r);r.manifest=async()=>{await manifest();for(const p of await diagnosticSources(r.root))r.summary.sources[p]=await sha256(join(r.root,p));};
 const setup=r.setup.bind(r);r.setup=async()=>{await setup();await r.cadenceGuard.check();r.summary.cadenceBaselines=await checkBaselines(r);await r.save();};
 return r;
}
export async function executeAttached(r,scenario=runAttachedArm){
 r.contract??=resolveArm('A','preflight');
 const shutdown=r.shutdown.bind(r);r.shutdown=async()=>{
  r.cadenceGuard?.finish();try{if(r.cdp&&r.cdp.state!=='closed')await r.cdp.close();}catch(e){r.summary.cdpCloseFailure=String(e);}
  const value=await shutdown();if(r.summary.cdpCloseFailure)throw Error(r.summary.cdpCloseFailure);return value;
 };
 return runExperiment(r,{AM:scenario});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [output,configPath,arm,profile]=process.argv.slice(2);assert.ok(output&&configPath,'usage: run.mjs fresh-dir config.json A|B preflight|full');
 const config=validateConfig(JSON.parse((await readFile(resolve(configPath),'utf8')).replace(/^\uFEFF/,''))),out=resolve(output);
 const artifacts=await realpath(join(root,'artifacts')),parent=await realpath(dirname(out)),rel=relative(artifacts,parent);
 assert.ok((rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))&&out!==artifacts,'output_outside_artifacts');await mkdir(out);
 const r=createAttachedRuntime({root,out,config,arm,profile});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{r.interrupted=true;});
 const summary=await executeAttached(r);console.log(JSON.stringify({status:summary.status,failure:summary.failure,finishedUtc:summary.finishedUtc}));if(summary.status==='failed')process.exitCode=1;
}
