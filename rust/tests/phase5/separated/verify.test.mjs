import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as verification from './verify.mjs';
const {verifyEvidence,loadEvidence}=verification;
import {memoryEvidence,transitionEvidence} from './test-fixture.mjs';
import {runExperiment,reserveLaunch} from './run.mjs';
const sourcePath=name=>'rust/tests/phase5/separated/'+name;
function nativeContextPair(){
 const peer=memoryEvidence().summary;peer.sources=Object.fromEntries(['native.mjs','verify.mjs','runtime.mjs','run.mjs','transitions.mjs','stream.sh'].map(p=>[sourcePath(p),'a'.repeat(64)]));
 const current=structuredClone(peer);current.scope='N';current.nativeTimingVersion=2;current.sources[sourcePath('native.mjs')]='b'.repeat(64);current.sources[sourcePath('verify.mjs')]='c'.repeat(64);return {peer,current};
}
test('N comparison discloses changed native and verifier versions without claiming same source',()=>{
 const {peer,current}=nativeContextPair();const c=verification.compareNativeContext(current,peer);
 assert.equal(c.sameCommonInputs,true);assert.equal(c.sameHarnessSources,false);assert.deepEqual(c.changedSources.map(x=>x.path).sort(),[sourcePath('native.mjs'),sourcePath('verify.mjs')]);
});
test('N comparison never exempts shared execution, candidates, environment or missing source files',()=>{
 for(const change of [s=>s.sources[sourcePath('runtime.mjs')]='d'.repeat(64),s=>s.sources[sourcePath('stream.sh')]='d'.repeat(64),s=>delete s.sources[sourcePath('native.mjs')],s=>s.binaries.app.sha256='d'.repeat(64),s=>s.imageId='sha256:'+'d'.repeat(64),s=>s.environment.webview='other',s=>s.nativeTimingVersion=3]){
  const {peer,current}=nativeContextPair();change(current);assert.equal(verification.compareNativeContext(current,peer).sameCommonInputs,false);
 }
});
test('N baseline checks re-read saved raw evidence without rewriting historical verdicts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-baselines-'));t.after(()=>rm(dir,{recursive:true,force:true}));const {peer,current}=nativeContextPair();
 for(const scope of ['M','F']){
  const e=scope==='M'?memoryEvidence():transitionEvidence('F');e.summary.sources=peer.sources;const out=join(dir,scope);await mkdir(out);
  for(const [file,value] of [['summary',e.summary],['audit-observations',e.audits],['normal-boundary',e.boundary],['process',e.process],['final-cleanup',e.cleanup]])await writeFile(join(out,file+'.json'),JSON.stringify(value));
  for(const key of ['events','output','memory'])await writeFile(join(out,key+'.jsonl'),e[key].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const summarySha256=createHash('sha256').update(await readFile(join(out,'summary.json'))).digest('hex');await writeFile(join(out,'verified.json'),JSON.stringify({preflightPassed:true,summarySha256}));
 }
 const saved=await readFile(join(dir,'M','verified.json'),'utf8');const reports=await verification.checkNativeBaselines(dir,{M:'M',F:'F'},current);assert.equal(reports.length,2);assert.ok(reports.every(x=>x.comparison.sameCommonInputs&&!x.comparison.sameHarnessSources));assert.equal(await readFile(join(dir,'M','verified.json'),'utf8'),saved);
 await writeFile(join(dir,'M','verified.json'),JSON.stringify({preflightPassed:true,summarySha256:'f'.repeat(64)}));await assert.rejects(verification.checkNativeBaselines(dir,{M:'M',F:'F'},current),/summary_changed/);
 await writeFile(join(dir,'M','verified.json'),saved);await writeFile(join(dir,'M','output.jsonl'),'');await assert.rejects(verification.checkNativeBaselines(dir,{M:'M',F:'F'},current),/baseline_invalid/);
});
function nativeV2Evidence(nativeCase){
 const e=transitionEvidence('N',nativeCase),{peer,current}=nativeContextPair();Object.assign(e.summary,{sources:current.sources,nativeTimingVersion:2,nativeResponseLatency:'not_measured'});
 // Hand-derived separate input/acceptance times precede the raw state checks.
 const times=[[0,0],[1,2],[902,903],[3000,3001],[4002,4003],[4501,4502]];
 e.nativeFiles.acceptances=[];
 for(const v of e.events.filter(x=>x.type==='native')){
  const q=v.request,base=q.round*10000,i=['window_mode','select','resize','reclaim','choose_connection','handoff'].indexOf(q.action);
  q.timingVersion=2;q.issuedAt=q.inputStartedAt=base+times[i][0];q.inputDeadline=q.inputStartedAt+120000;q.responseReceivedAt=base+times[i][1];q.verifyDeadline=q.responseReceivedAt+45000;
  const {inputStartedAt,inputDeadline,responseReceivedAt,verifyDeadline,...issued}=q;e.nativeFiles.requests[e.nativeFiles.requests.findIndex(x=>x.id===q.id)]=issued;
  const accepted={id:q.id,owner:q.owner,responseReceivedAt,verifyDeadline};e.nativeFiles.acceptances.push(accepted);e.events.push({type:'native_received',t:responseReceivedAt,owner:q.owner,scope:'N',...accepted});
 }
 e.events.sort((a,b)=>a.t-b.t||Number(b.type==='native_received')-Number(a.type==='native_received'));resequence(e);
 e.summary.nativeBaselines=['M','F'].map(scope=>{const p=structuredClone(peer);p.scope=scope;return {scope,evidence:'artifacts/'+scope,summarySha256:'a'.repeat(64),identity:p,comparison:{sameCommonInputs:true,sameHarnessSources:false,changedSources:[{path:sourcePath('native.mjs'),kind:'native_driver',before:'a'.repeat(64),after:'b'.repeat(64)},{path:sourcePath('verify.mjs'),kind:'verifier',before:'a'.repeat(64),after:'c'.repeat(64)}],differences:[]}};});
 return e;
}

for(const mode of ['restored','maximized'])test('independent '+mode+' case requires its own audit and shutdown and cannot pass all of N',()=>{
 const e=nativeV2Evidence(mode),v=verifyEvidence(e);
 assert.deepEqual(v.errors,[]);assert.equal(v.casePassed,true);assert.equal(v.nativeCase,mode);assert.equal(v.scopePassed,false);assert.equal(v.preflightPassed,false);assert.equal(v.resultName,'native_case_passed');
 for(const mutate of [e=>e.audits[0].actual=[],e=>e.events=e.events.filter(x=>x.type!=='shutdown'),e=>e.cleanup.forcedCleanup=true,e=>e.summary.completedCases=2,e=>e.summary.nativeCase='unknown',e=>e.summary.nativeTimingVersion=1,e=>e.events.find(x=>x.type==='transition').windowMode=mode==='restored'?'maximized':'restored']){
  const broken=nativeV2Evidence(mode);mutate(broken);assert.notEqual(verifyEvidence(broken).casePassed,true);
 }
});
function nativePair(){
 return ['restored','maximized'].map(mode=>{const original=nativeV2Evidence(mode),e=JSON.parse(JSON.stringify(original).replaceAll('test-owner','owner-'+mode));e.summary.nativeBaselines=original.summary.nativeBaselines;return e;});
}
test('native aggregation revalidates both raw cases and requires identical candidates, sources and environment',()=>{
 const pair=nativePair(),v=verification.verifyNativeCasePair(pair);
 assert.equal(v.scopePassed,true);assert.equal(v.phase5Acceptance,false);assert.equal(v.combinedTransitionMemory,'unverified');assert.equal(v.publicBoundaryCompleteness,'unverified');assert.deepEqual(v.cases.map(x=>x.nativeCase),['restored','maximized']);
 for(const mutate of [p=>p.pop(),p=>p.push(structuredClone(p[0])),p=>p[1]=structuredClone(p[0]),p=>p[1].summary.owner=p[0].summary.owner,p=>p[1].summary.sources[sourcePath('native.mjs')]='d'.repeat(64),p=>p[1].summary.binaries.app.sha256='d'.repeat(64),p=>p[1].summary.environment.webview='other',p=>p[1].summary.imageId='sha256:'+'d'.repeat(64),p=>p[1].audits[0].actual=[],p=>p[1].output=[],p=>p[1].summary.status='failed',p=>p[1].summary.nativeBaselines[0].summarySha256='b'.repeat(64)]){
  const broken=nativePair();mutate(broken);assert.throws(()=>verification.verifyNativeCasePair(broken));
 }
});
test('old two-case evidence and incomplete partial runs cannot be relabeled as an independent case',()=>{
 const old=nativeV2Evidence();old.summary.nativeCase='restored';old.summary.completedCases=1;
 assert.notEqual(verifyEvidence(old).casePassed,true);
 const partial=nativeV2Evidence('restored');delete partial.summary.finishedUtc;
 assert.notEqual(verifyEvidence(partial).casePassed,true);
});
async function saveRawEvidence(out,e){
 await mkdir(out,{recursive:true});
 for(const [file,value] of [['summary',e.summary],['audit-observations',e.audits],['normal-boundary',e.boundary],['process',e.process],['final-cleanup',e.cleanup]])await writeFile(join(out,file+'.json'),JSON.stringify(value));
 for(const key of ['events','output','memory'])await writeFile(join(out,key+'.jsonl'),e[key].map(x=>JSON.stringify(x)).join('\n')+'\n');
 if(e.summary.scope==='N')for(const [kind,values] of Object.entries(e.nativeFiles)){await mkdir(join(out,'native',kind),{recursive:true});for(const v of values)await writeFile(join(out,'native',kind,(v.id??v.request.id)+'.json'),JSON.stringify(v));}
}
test('saved native cases survive independent verification and aggregation without rewriting completed evidence',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-pair-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const workspace=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..'),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const pair=nativePair(),sources={};for(const p of Object.keys(pair[0].summary.sources))sources[p]=digest(await readFile(join(workspace,p)));
 const binary=join(dir,'candidate.bin');await writeFile(binary,'candidate');const binaries=Object.fromEntries(['app','adapter'].map(key=>[key,{path:binary,sha256:digest('candidate')}]));
 const paths={M:join(dir,'M'),F:join(dir,'F')};
 for(const scope of ['M','F']){
  const e=scope==='M'?memoryEvidence():transitionEvidence('F');Object.assign(e.summary,{sources,binaries});await saveRawEvidence(paths[scope],e);
  await writeFile(join(paths[scope],'verified.json'),JSON.stringify({preflightPassed:true,summarySha256:digest(await readFile(join(paths[scope],'summary.json')))}));
 }
 const directories=[];
 for(const e of pair){
  Object.assign(e.summary,{sources,binaries});e.summary.nativeBaselines=await verification.checkNativeBaselines(workspace,paths,e.summary);
  const out=join(dir,e.summary.nativeCase);directories.push(out);await saveRawEvidence(out,e);
  const v=await verification.verifyDirectory(out);assert.deepEqual(v.errors,[]);assert.equal(v.casePassed,true);assert.equal(v.scopePassed,false);
  assert.equal(JSON.parse(await readFile(join(out,'verified.json'),'utf8')).casePassed,true);
 }
 const before=await Promise.all(directories.map(out=>readFile(join(out,'verified.json'),'utf8'))),report=join(dir,'aggregate.json');
 assert.equal((await verification.aggregateNativeDirectories(directories,report)).scopePassed,true);
 assert.deepEqual(await Promise.all(directories.map(out=>readFile(join(out,'verified.json'),'utf8'))),before);
 const saved=await readFile(report,'utf8');await assert.rejects(verification.aggregateNativeDirectories(directories,report),/EEXIST/);assert.equal(await readFile(report,'utf8'),saved);
 await writeFile(join(directories[1],'output.jsonl'),'');await assert.rejects(verification.aggregateNativeDirectories(directories,join(dir,'invalid.json')),/native_pair_invalid/);
 await assert.rejects(readFile(join(dir,'invalid.json')),/ENOENT/);
 // A persisted pass is not enough if either current binary or the summary changes.
 await writeFile(binary,'changed');const changed=join(dir,'changed-binary');await saveRawEvidence(changed,pair[0]);const invalid=await verification.verifyDirectory(changed);assert.equal(invalid.casePassed,false);assert.ok(invalid.errors.some(x=>x.includes('binary_changed')));
 await assert.rejects(verification.aggregateNativeDirectories(directories,join(dir,'binary.json')),/binary_changed/);
 await writeFile(binary,'candidate');await writeFile(join(directories[0],'summary.json'),JSON.stringify({...pair[0].summary,extra:'changed'}));
 await assert.rejects(verification.aggregateNativeDirectories(directories,join(dir,'changed.json')),/native_case_summary_changed/);
});
test('v2 native evidence verifies acceptance clock and retains the unmeasured response-latency label',()=>{
 const v=verifyEvidence(nativeV2Evidence());assert.deepEqual(v.errors,[]);assert.equal(v.scopePassed,true);assert.equal(v.nativeTimingVersion,2);assert.equal(v.nativeResponseLatency,'not_measured');
});
for(const action of ['select','resize'])test('v2 rejects '+action+' raw state collected before acceptance even with valid receipt clocks',()=>{
 const e=nativeV2Evidence(),v=e.events.find(x=>x.type==='native'&&x.request.action===action),q=v.request;
 const at=action==='select'?101:1000.5,key=action==='select'?'selectedAt':'observedAt';
 q.responseReceivedAt=at;q.verifyDeadline=at+45000;v.observation[key]=at;
 const r=e.events.find(x=>x.type==='transition');r[action==='select'?'selected':'resized'][key]=at;
 Object.assign(e.nativeFiles.acceptances.find(x=>x.id===q.id),{responseReceivedAt:at,verifyDeadline:q.verifyDeadline});
 Object.assign(e.events.find(x=>x.type==='native_received'&&x.id===q.id),{t:at,responseReceivedAt:at,verifyDeadline:q.verifyDeadline});
 e.events.sort((a,b)=>a.t-b.t);resequence(e);
 const result=verifyEvidence(e);assert.equal(result.scopePassed,false);assert.match(result.errors.join(' '),/native_geometry_status_after_acceptance/);
});
test('v2 rejects geometry raw state after verifiedAt even when before the native result event',()=>{
 const e=nativeV2Evidence(),v=e.events.find(x=>x.type==='native'&&x.request.action==='resize');
 v.verifiedAt=999;e.nativeFiles.results.find(x=>x.request.id===v.request.id).verifiedAt=999;
 const result=verifyEvidence(e);assert.equal(result.scopePassed,false);assert.match(result.errors.join(' '),/native_geometry_status_after_acceptance/);
});
test('v2 rejects late acceptance, late verification, reordered clocks and missing acceptance evidence',()=>{
 for(const change of [
  (e,v)=>v.request.responseReceivedAt=v.request.inputDeadline+1,
  (e,v)=>v.verifiedAt=v.request.verifyDeadline+1,
  (e,v)=>v.request.responseReceivedAt=v.request.inputStartedAt-1,
  e=>e.nativeFiles.acceptances.pop(),
  e=>{e.events=e.events.filter(x=>x.type!=='native_received');resequence(e);},
  e=>e.summary.nativeResponseLatency='measured',
  e=>e.summary.nativeBaselines[0].identity.sources[sourcePath('runtime.mjs')]='d'.repeat(64),
  e=>e.summary.nativeTimingVersion=99
 ]){const e=nativeV2Evidence();change(e,e.events.find(x=>x.type==='native'&&x.request.action==='resize'));assert.equal(verifyEvidence(e).scopePassed,false);}
});
test('complete short evidence stays preflight only, irrespective of summary success wording',()=>{
 const e=memoryEvidence(),v=verifyEvidence(e);assert.deepEqual(v.errors,[]);assert.equal(v.preflightPassed,true);assert.equal(v.scopePassed,false);assert.equal(v.phase5Acceptance,false);assert.equal(v.combinedTransitionMemory,'unverified');
 e.summary.status='passed';assert.equal(verifyEvidence(e).preflightPassed,true);
});
test('full natural evidence can pass its scope but a valid memory increase keeps acceptance blocked',()=>{
 const e=memoryEvidence('full');const first=verifyEvidence(e);assert.deepEqual(first.errors,[]);assert.equal(first.scopePassed,true);assert.equal(first.phase5Acceptance,false);
 for(const sample of e.memory.filter(s=>s.elapsed>=6000)){for(const p of sample.processes)p.privateBytes=121;sample.privateBytes=4114;}
 const second=verifyEvidence(e);assert.equal(second.evidenceValid,true);assert.equal(second.scopePassed,false);assert.deepEqual(second.errors,['memory_growth_over_20_percent']);
});
test('foreign output rows and epoch substitution are not ignored',()=>{
 const e=memoryEvidence();e.output.push({...e.output[0],session:'foreign'});assert.equal(verifyEvidence(e).evidenceValid,false);
 const epoch=memoryEvidence();epoch.output[0].epoch=999;assert.equal(verifyEvidence(epoch).evidenceValid,false);
});
test('uniformly substituted sample identities cannot impersonate owned processes',()=>{
 const e=memoryEvidence();for(const sample of e.memory)for(const p of sample.processes){p.pid+=10000;p.startedTicks='999';}
 assert.equal(verifyEvidence(e).evidenceValid,false);
});
test('shutdown receipt must identify the same process as the final receipt',()=>{
 const e=memoryEvidence();e.events.at(-1).process={...e.process,pid:777};assert.equal(verifyEvidence(e).evidenceValid,false);
});
function resequence(e){e.events.forEach((v,i)=>v.seq=i+1);e.boundary.eventSeq=e.events.find(v=>v.type==='measurement_end').seq;}
test('F/N success explicitly leaves reclaim-boundary completeness unverified',()=>{
 for(const scope of ['F','N']){const e=transitionEvidence(scope),v=verifyEvidence(e);assert.equal(v.publicBoundaryCompleteness,'unverified');e.summary.publicBoundaryCompleteness='verified';assert.equal(verifyEvidence(e).evidenceValid,false);}
});
for(const scope of ['F','N'])test(scope+' complete transition evidence passes only its own scope',()=>{const v=verifyEvidence(transitionEvidence(scope));assert.deepEqual(v.errors,[]);assert.equal(scope==='F'?v.preflightPassed:v.scopePassed,true);});
test('transitions require binding events and the final owned stream',()=>{
 for(const mutate of [e=>{e.events=e.events.filter(v=>v.type!=='binding');e.output=e.output.map(row=>({...row,epoch:1,stream:'stream'+row.index,cursor:Number(row.response.text.match(/:(\d{8}):/)[1])-1,response:{...row.response,next_cursor:Number(row.response.text.match(/:(\d{8}):/)[1])}}));},e=>e.summary.sessions[0].epoch=1]){const e=transitionEvidence();mutate(e);resequence(e);assert.equal(verifyEvidence(e).evidenceValid,false);}
});
test('transition geometry must have same-round raw status evidence',()=>{
 const e=transitionEvidence();e.events=e.events.filter(v=>!(v.type==='mcp'&&v.name==='status'&&v.t===1000));resequence(e);assert.equal(verifyEvidence(e).evidenceValid,false);
});
test('native evidence rejects repeated receipt IDs and contradictory UI observations',()=>{
 for(const mutate of [e=>{for(const v of e.events.filter(v=>v.type==='native')){v.request.id='same';v.response.id='same';}},e=>{const v=e.events.find(v=>v.type==='native'&&v.request.action==='select');v.response.observation.selectedSession='foreign';}]){const e=transitionEvidence('N');mutate(e);assert.equal(verifyEvidence(e).evidenceValid,false);}
});
test('native receipts must describe this round and stay within the preparation-inclusive watchdog',()=>{
 for(const mutate of [e=>{const v=e.events.find(v=>v.type==='native'&&v.request.action==='select');v.observation.geometry={rows:1,columns:1};e.nativeFiles.results.find(x=>x.request.id===v.request.id).observation=v.observation;},e=>{for(const v of e.events.filter(v=>v.type==='native')){v.request.expiresAt+=900000;v.request.inputStartedAt+=900000;v.request.issuedAt+=900000;v.request.verifyDeadline+=900000;v.verifiedAt+=900000;}for(const q of e.nativeFiles.requests){q.expiresAt+=900000;q.issuedAt+=900000;}}]){const e=transitionEvidence('N');mutate(e);assert.equal(verifyEvidence(e).evidenceValid,false);}
});
test('overload flags cannot replace control output or contradictory victim status',()=>{
 for(const mutate of [e=>{e.events=e.events.filter(v=>!(v.type==='mcp'&&v.name==='read_output'));},e=>{const o=e.events.find(v=>v.type==='overload');e.events.splice(e.events.indexOf(o),0,{...o,type:'mcp',index:0,name:'status',args:{},response:{app_state:'online',connection_id:'c0',sessions:[{session_id:'s0',state:'agent_owned'}]}});}]){const e=memoryEvidence();mutate(e);resequence(e);assert.equal(verifyEvidence(e).evidenceValid,false);}
});
for(const [name,change] of [
 ['missing duration',e=>e.summary.elapsedSeconds=179],['sample gap',e=>e.memory.splice(2,2)],['debugger attached',e=>e.memory[2].debugPort.established=1],
 ['forced GC',e=>e.summary.instrumentation.forcedGcCalls=1],['sum mismatch',e=>e.memory[0].privateBytes=1],['reused PID',e=>e.memory[2].processes[0].startedTicks='2'],
 ['duplicate audit effect',e=>e.audits[0].actual.push('AUDIT_0_0')],['no duplicate request',e=>{e.events=e.events.filter(row=>!(row.type==='mcp'&&row.seq===6));}],
 ['missing cleanup',e=>delete e.cleanup],['forced cleanup',e=>e.cleanup.forcedCleanup=true],['missing EOF',e=>e.events.at(-1).eofs.pop()],
 ['post boundary sample',e=>e.memory.at(-1).elapsed=180],['missing identity',e=>delete e.summary.environment.webview],['wrong image',e=>e.summary.fixtures[1].image='other'],
 ['missing output',e=>e.output.pop()],['corrupt output',e=>e.output[0].response.text=e.output[0].response.text.replace('00000002','00000004')],
 ['negative stream cursor',e=>e.output[0].response.next_cursor=-1],['early browser attach',e=>e.events.find(row=>row.type==='browser_disconnected').type='browser_attached']
])test('rejects '+name,()=>{const e=memoryEvidence();change(e);const v=verifyEvidence(e);assert.equal(v.scopePassed,false);assert.equal(v.preflightPassed,false);assert.ok(v.errors.length);});
test('truncated JSONL is a named evidence failure, not silently dropped last line',async t=>{
 const out=await mkdtemp(join(tmpdir(),'baton-evidence-'));t.after(()=>rm(out,{recursive:true,force:true}));await writeFile(join(out,'summary.json'),'{}');await writeFile(join(out,'events.jsonl'),'{"partial":');await assert.rejects(loadEvidence(out),/events.jsonl/);
});
test('launcher refuses previously used output or log paths without replacing files',async t=>{
 const root=await mkdtemp(join(tmpdir(),'baton-launch-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'artifacts'));const out=join(root,'artifacts','run');await writeFile(out+'.log','old');await assert.rejects(reserveLaunch(root,out),/exists/);await assert.rejects(reserveLaunch(root,join(root,'outside')),/artifacts/);
});
test('workload failure still attempts shutdown and cleanup and returns failure',async()=>{
 const order=[],r={contract:{scope:'M',profile:'preflight'},summary:{},init:async()=>{},setup:async()=>{},save:async()=>{},checkHashes:async()=>{},shutdown:async()=>order.push('shutdown'),cleanup:async()=>{order.push('cleanup');return {normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]};}};
 const result=await runExperiment(r,{M:async()=>{throw Error('workload_failed');}});assert.equal(result.status,'failed');assert.match(result.failure,/workload_failed/);assert.deepEqual(order,['shutdown','cleanup']);assert.ok(result.finishedUtc);
});
