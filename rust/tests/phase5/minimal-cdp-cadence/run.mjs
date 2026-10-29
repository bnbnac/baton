import assert from 'node:assert/strict';
import {mkdir,readFile,readdir,realpath,open} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRuntime,sha256} from '../separated/runtime.mjs';
import {runExperiment,root} from '../separated/run.mjs';
import {compareIdentity,validateConfig} from '../separated/contract.mjs';
import {installCadenceGuard} from '../native-cadence/run.mjs';
import {CONTRACT,runCdpCadence} from './scenario.mjs';
import {sampleAttached} from './sampling.mjs';
export function commonSources(sources,baseline){
 assert.equal(Object.keys(baseline).length,23,'baseline_source_count');const result={};
 for(const [p,h] of Object.entries(baseline)){assert.equal(sources[p],h,'baseline_source:'+p);result[p]=h;}return result;
}
export async function checkBaselines(r){
 const reports=[];
 for(const scope of ['M','F']){
  const path=r.config.preflightEvidence?.[scope];assert.equal(typeof path,'string','baseline_required');const dir=resolve(r.root,path),peer=JSON.parse(await readFile(join(dir,'summary.json'),'utf8')),receipt=JSON.parse(await readFile(join(dir,'verified.json'),'utf8'));
  assert.equal(peer.scope,scope);const summarySha256=await sha256(join(dir,'summary.json'));assert.equal(receipt.summarySha256,summarySha256);assert.equal(receipt.preflightPassed,true);
  const sources=commonSources(r.summary.sources,peer.sources);assert.equal(compareIdentity({...r.summary,sources},peer).same,true,'baseline_identity');
  reports.push({scope,evidence:path,summarySha256,receiptSha256:await sha256(join(dir,'verified.json')),sources:peer.sources});
 }return reports;
}
export async function diagnosticSources(root){
 const paths=[];for(const dir of ['rust/tests/phase5/native-cadence','rust/tests/phase5/minimal-cdp-cadence'])for(const file of await readdir(join(root,dir)))if((file.endsWith('.mjs')||file.endsWith('.ps1'))&&!file.endsWith('.test.mjs')&&file!=='test-fixture.mjs')paths.push(dir+'/'+file);return paths.sort();
}
export function createCdpCadenceRuntime(options,deps={}){
 const r=createRuntime({...options,contract:CONTRACT},deps);installCadenceGuard(r);r.summary.clockEpoch=performance.timeOrigin;
 Object.assign(r.summary.instrumentation,{evaluateCalls:0,domActions:0,domQueries:0,heapDiagnosticCalls:0,jsProbes:0});
 const init=r.init.bind(r);r.init=async()=>{await init();const f=await open(join(r.out,'cdp.jsonl'),'wx');await f.close();};
 r.sampleMemory=()=>sampleAttached(r);
 r.startMeasurement=async()=>{const row=await r.event('measurement_start');r.measurementStartT=row.t;r.loadStart=r.born+row.t;for(const s of r.sessions){s.startCount=s.oracle.count;s.privateMs=0;}r.summary.loadStartedUtc=row.utc;r.summary.status='running';await r.save();};
 r.freeze=async()=>{r.measurementFrozen=true;const row=await r.event('measurement_end');r.summary.elapsedSeconds=(row.t-r.measurementStartT)/1000;r.summary.loadFinishedUtc=row.utc;await r.json('normal-boundary.json',{elapsedSeconds:r.summary.elapsedSeconds,finishedUtc:row.utc,eventSeq:row.seq,samples:r.summary.samples.length});await r.save();};
 const manifest=r.manifest.bind(r);r.manifest=async()=>{await manifest();for(const p of await diagnosticSources(r.root))r.summary.sources[p]=await sha256(join(r.root,p));};
 const setup=r.setup.bind(r);r.setup=async()=>{await setup();await r.cadenceGuard.check();r.summary.cadenceBaselines=await checkBaselines(r);await r.save();};
 return r;
}
export async function executeCdpCadence(r,scenario=runCdpCadence){
 const shutdown=r.shutdown.bind(r);r.shutdown=async()=>{r.cadenceGuard?.finish();try{if(r.cdp&&r.cdp.state!=='closed')await r.cdp.close();}catch(e){r.summary.cdpCloseFailure=String(e);}const value=await shutdown();if(r.summary.cdpCloseFailure)throw Error(r.summary.cdpCloseFailure);return value;};
 r.contract??=CONTRACT;return runExperiment(r,{CC:scenario});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [output,configPath]=process.argv.slice(2);assert.ok(output&&configPath,'usage: run.mjs fresh-dir config.json');const out=resolve(output),config=validateConfig(JSON.parse((await readFile(resolve(configPath),'utf8')).replace(/^\uFEFF/,'')));
 const artifacts=await realpath(join(root,'artifacts')),parent=await realpath(dirname(out)),rel=relative(artifacts,parent);assert.ok((rel===''||(!rel.startsWith('..')&&!isAbsolute(rel)))&&out!==artifacts,'output_outside_artifacts');await mkdir(out);
 const r=createCdpCadenceRuntime({root,out,config});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{r.interrupted=true;});const s=await executeCdpCadence(r);console.log(JSON.stringify({status:s.status,failure:s.failure,finishedUtc:s.finishedUtc}));if(s.status==='failed')process.exitCode=1;
}
