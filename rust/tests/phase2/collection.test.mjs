import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as evidence from './evidence.mjs';

const identity={sourceDigest:'source',cargoLock:'cargo',npmLock:'npm',productExecutable:'product',acceptanceExecutable:'acceptance'};
const at=n=>`2026-10-01T00:${String(n).padStart(2,'0')}:00.000Z`;
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'baton-collection-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const save=async(name,data)=>{const path=join(dir,name);await writeFile(path,typeof data==='string'?data:JSON.stringify(data));return {path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};};
 const process={pid:1,startedTicks:'123456789012345678',path:'acceptance.exe',normalExit:true,forcedCleanup:false,descendantAudit:'verified',descendants:[{pid:2,parent:1,startedTicks:'123456789012345679',path:'webview.exe',exited:true,dataDirectoryMatch:true}]};
 const rows=[
  {caseId:'physical-key',mode:'user_owned',receivedHex:'41',observedUtc:at(2)},
  {caseId:'physical-key',mode:'agent_owned',receivedHex:'',observedUtc:at(3)},
  {caseId:'ime-reclaim-mid-composition',mode:'user_owned',receivedHex:'',observedUtc:at(4)},
  {caseId:'ime-commit',mode:'user_owned',receivedHex:'ed959ceab88020',observedUtc:at(5)},
 ].map(row=>({...row,startedUtc:new Date(Date.parse(row.observedUtc)-30000).toISOString(),serverObserved:true}));
 const run=async id=>({id,metadata:await save(id+'-meta.json',{runId:id,identity,os:'Windows',startedUtc:at(0),finishedUtc:at(10)}),raw:await save(id+'-raw.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')),process:await save(id+'-process.json',process)});
 const receipt={schemaVersion:2,identity,baseline:await save('baseline.json',{status:'manual_pending',identity,identityAfter:identity}),runs:[await run('one'),await run('two')],cases:[],deferred:[]};
 const ref=(row,runId='one')=>({runId,caseId:row.caseId,mode:row.mode,observedUtc:row.observedUtc,expectedHex:row.receivedHex});
 const key={id:'physical-key',operator:{kind:'human',name:'tester',statement:'Pressed A once in each mode'},observations:rows.slice(0,2).map(r=>ref(r)),evidence:[]};
 const check=r=>{assert.equal(typeof evidence.checkManualCollection,'function','multi-run collector is not implemented');return evidence.checkManualCollection(r,identity,dir);};
 return {dir,save,receipt,rows,key,ref,check,process};
}

test('collection preserves independent runs and validates supplied cases even while incomplete',async t=>{
 const f=await fixture(t);f.key.observations[1].runId='two';f.receipt.cases=[f.key];
 const r=await f.check(f.receipt);assert.deepEqual(r.observed,['physical-key']);assert.ok(r.missing.includes('interactive-vi'));assert.equal(r.status,'manual_pending');
});
test('collection rejects stale builds, modified files, unknown or ambiguous raw references and input leaks',async t=>{
 const f=await fixture(t);f.receipt.cases=[f.key];
 for(const mutate of [
  r=>r.identity.productExecutable='other',
  r=>r.runs[1].metadata.sha256='0'.repeat(64),
  r=>r.cases[0].observations[0].observedUtc=at(9),
  r=>r.cases[0].observations[0].expectedHex='',
  r=>r.cases[0].operator.kind='javascript',
  r=>r.cases.push(structuredClone(r.cases[0])),
 ]){const r=structuredClone(f.receipt);mutate(r);await assert.rejects(()=>f.check(r));}
 const leak={...f.rows[1],receivedHex:'41'};f.receipt.runs[0].raw=await f.save('leak.jsonl',[f.rows[0],leak].map(JSON.stringify).join('\n'));f.key.observations[1].expectedHex='41';
 await assert.rejects(()=>f.check(f.receipt),/blocked_input/);
 f.receipt.runs[0].raw=await f.save('duplicate.jsonl',[...f.rows,f.rows[0]].map(JSON.stringify).join('\n'));
 await assert.rejects(()=>f.check(f.receipt),/reference_ambiguous/);
});
test('IME reclaim requires one ordered transition with old bytes blocked and fresh bytes restored',async t=>{
 const f=await fixture(t);
 const c={id:'ime-reclaim-mid-composition',operator:f.key.operator,evidence:[await f.save('transition.txt','Observed epoch 2 -> 4')],transition:{beforeEpoch:2,afterEpoch:4},observations:[f.ref(f.rows[2]),f.ref(f.rows[3])]};
 f.receipt.cases=[c];assert.ok((await f.check(f.receipt)).observed.includes(c.id));
 for(const mutate of [r=>r.cases[0].observations[1].runId='two',r=>r.cases[0].observations.reverse(),r=>r.cases[0].transition.afterEpoch=2,r=>r.cases[0].observations.pop()]){const r=structuredClone(f.receipt);mutate(r);await assert.rejects(()=>f.check(r));}
});
test('normal exit is a lifecycle observation and never inferred from empty input or forced cleanup',async t=>{
 const f=await fixture(t);f.receipt.cases=[{id:'webview-descendant-exit',operator:f.key.operator,evidence:[await f.save('exit.txt','Observation end clicked')],observations:[],lifecycle:{runId:'one',mode:'agent_owned',observedUtc:at(9),trigger:'observation-end'}}];
 assert.ok((await f.check(f.receipt)).observed.includes('webview-descendant-exit'));
 for(const patch of [{forcedCleanup:true},{normalExit:false},{descendants:[]}]){const r=structuredClone(f.receipt);r.runs[0].process=await f.save('bad-process.json',{...f.process,...patch});await assert.rejects(()=>f.check(r));}
});
test('only explicit release DPI deferrals are accepted and they never become observed cases',async t=>{
 const f=await fixture(t);f.receipt.deferred=[{id:'dpi-150',approvedBy:'user',approvedUtc:at(0),reason:'Run actual scale matrix before Windows release',due:'before-windows-release'}];
 const r=await f.check(f.receipt);assert.deepEqual(r.deferred,['dpi-150']);assert.ok(!r.observed.includes('dpi-150'));assert.ok(!r.missing.includes('dpi-150'));
 for(const patch of [{id:'physical-key'},{approvedBy:''},{due:'never'}]){const r=structuredClone(f.receipt);Object.assign(r.deferred[0],patch);await assert.rejects(()=>f.check(r));}
});
test('collection recorder writes a separate partial receipt and leaves source evidence intact',async t=>{
 const f=await fixture(t);f.receipt.cases=[f.key];f.receipt.deferred=[{id:'dpi-150',approvedBy:'user',approvedUtc:at(0),reason:'Before release',due:'before-windows-release'}];const input=join(f.dir,'selection.json'),output=join(f.dir,'collection.json');await writeFile(input,JSON.stringify(f.receipt));const before=await readFile(f.receipt.baseline.path,'utf8');
 const result=spawnSync(process.execPath,['rust/tests/phase2/record-manual.mjs','--collection',input,output],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,2,result.stdout+result.stderr);assert.equal(JSON.parse(await readFile(output,'utf8')).status,'manual_pending');assert.equal(await readFile(f.receipt.baseline.path,'utf8'),before);
 const recorded=JSON.parse(await readFile(output,'utf8'));
 assert.deepEqual(recorded.deferred,f.receipt.deferred,'persist approval details, not summary IDs');
 assert.deepEqual(await f.check(recorded),await f.check(f.receipt),'saved receipt must be reusable by the final gate');
});

test('vi requires edit, blocked input and unsaved exit in the same ordered run',async t=>{
 const f=await fixture(t);
 const rows=[['user_owned','76690d694241544f4e5f454449544f525f54455354'],['agent_owned',''],['user_owned','1b3a71210d']].map(([mode,receivedHex],i)=>({caseId:'interactive-vi',mode,receivedHex,serverObserved:true,startedUtc:at(i*2+1),observedUtc:at(i*2+2)}));
 f.receipt.runs[0].raw=await f.save('vi-raw.jsonl',rows.map(JSON.stringify).join('\n'));
 const c={id:'interactive-vi',operator:{...f.key.operator,kind:'native'},evidence:[await f.save('vi-screen.txt','Editor then shell')],observations:rows.map(row=>f.ref(row)),interactive:{shellReturned:true,finalText:'BATON_EDITOR_TEST'}};
 f.receipt.cases=[c];assert.ok((await f.check(f.receipt)).observed.includes(c.id));
 for(const mutate of [r=>r.cases[0].observations.pop(),r=>r.cases[0].observations[2].runId='two',r=>r.cases[0].observations.reverse(),r=>r.cases[0].interactive.shellReturned=false]){const r=structuredClone(f.receipt);mutate(r);await assert.rejects(()=>f.check(r));}
});
test('complete scope with DPI deferred is distinct from full observation',async t=>{
 const f=await fixture(t);const rows=[];
 for(const id of evidence.manualCases){
   if(id.startsWith('dpi-')){f.receipt.deferred.push({id,approvedBy:'user',approvedUtc:at(0),reason:'Before release',due:'before-windows-release'});continue;}
   const c={id,operator:f.key.operator,evidence:[await f.save(id+'.txt','Test fixture observation')],observations:[]};
   if(id==='webview-descendant-exit')c.lifecycle={runId:'one',mode:'user_owned',observedUtc:at(9),trigger:'observation-end'};
   else{
     const specs=id==='ime-reclaim-mid-composition'?[['user_owned','',id],['user_owned','ed959ceab88020','ime-commit']]:id==='interactive-vi'?[['user_owned','76690d6941',id],['agent_owned','',id],['user_owned','1b3a71210d',id]]:[['user_owned','41',id],['agent_owned','',id]];
     specs.forEach(([mode,receivedHex,caseId],i)=>{const row={caseId,mode,receivedHex,serverObserved:true,startedUtc:at(i*2+1),observedUtc:at(i*2+2)};if(id==='ime-reclaim-mid-composition')row.observedUtc=row.observedUtc.replace('.000','.001');rows.push(row);c.observations.push(f.ref(row));});
     if(id==='ime-reclaim-mid-composition')c.transition={beforeEpoch:2,afterEpoch:4};
     if(id.startsWith('interactive-'))c.interactive={shellReturned:true,finalText:'BATON_EDITOR_TEST'};
   }
   f.receipt.cases.push(c);
 }
 f.receipt.runs[0].raw=await f.save('all.jsonl',rows.map(JSON.stringify).join('\n'));
 const r=await f.check(f.receipt);assert.equal(r.status,'observed_with_deferrals');assert.equal(r.observed.length,10);assert.deepEqual(r.missing,[]);assert.equal(r.deferred.length,3);
});
test('collection reuses a build only when the entire source delta is the named collector tooling',async()=>{
 const make=files=>({...identity,files,sourceDigest:createHash('sha256').update(files.map(f=>f.path+':'+f.sha256).join('\n')).digest('hex').toUpperCase()});
 const old=make([{path:'rust/app/src/main.ts',sha256:'A'.repeat(64)},{path:'rust/tests/phase2/evidence.mjs',sha256:'B'.repeat(64)}]);
 const next=make([{path:'rust/app/src/main.ts',sha256:'A'.repeat(64)},{path:'rust/tests/phase2/evidence.mjs',sha256:'C'.repeat(64)}]);
 assert.equal(typeof evidence.checkCollectionBuild,'function','tool-only source comparison missing');
 assert.deepEqual(evidence.checkCollectionBuild(old,next),['rust/tests/phase2/evidence.mjs']);
 for(const bad of [make([{path:'rust/app/src/main.ts',sha256:'D'.repeat(64)},next.files[1]]),{...next,productExecutable:'other'},{...next,sourceDigest:'forged'},{...next,files:undefined}])assert.throws(()=>evidence.checkCollectionBuild(old,bad));
});
