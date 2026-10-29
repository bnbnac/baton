import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeMailbox,acknowledge,readRequest,runPhases,memoryVerdict} from './native-soak-control.mjs';
import * as control from './native-soak-control.mjs';

test('native acknowledgement is bound to owner/request and is not a state verification',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-mailbox-'));
 try{
  let now=1000;const box=new NativeMailbox(dir,'owner-a',()=>now);await box.init();
  const request=await box.issue({action:'reclaim',session:'session-a',epoch:4},1000);
  assert.equal(await box.completed(request),false);
  await assert.rejects(box.issue({action:'handoff'},1000),/pending/);
  await assert.rejects(acknowledge(dir,'old-id','performed',()=>now),/request_id/);
  await writeFile(join(dir,'responses',request.id+'.json'),JSON.stringify({id:request.id,owner:'foreign',status:'performed'}));
  await assert.rejects(box.completed(request),/owner/);
  await rm(join(dir,'responses',request.id+'.json'));
  await acknowledge(dir,request.id,'performed',()=>now);
  assert.equal(await box.completed(request),true);
  await assert.rejects(acknowledge(dir,request.id,'performed',()=>now),/EEXIST/);
  await box.finish(request,{verified:true,epoch:5});assert.equal(await readRequest(dir),null);
  const history=JSON.parse(await readFile(join(dir,'results',request.id+'.json'),'utf8'));assert.equal(history.observation.epoch,5);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('expired or failed native requests cannot silently advance',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-timeout-'));
 try{
  let now=0;const box=new NativeMailbox(dir,'owner',()=>now);await box.init();
  const r=await box.issue({action:'resize'},1000);now=1001;
  await assert.rejects(acknowledge(dir,r.id,'performed',()=>now),/expired/);
  await assert.rejects(box.completed(r),/timeout/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('reported UI failure is rejected without retrying it',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-failure-'));
 try{const box=new NativeMailbox(dir,'owner');await box.init();const r=await box.issue({action:'handoff'},1000);await acknowledge(dir,r.id,'failed');await assert.rejects(box.completed(r),/native_action_failed/);}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('selection requires explicit matching UI observation before capturing its resize baseline',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-selection-'));
 try{
  const box=new NativeMailbox(dir,'owner');await box.init();const r=await box.issue({action:'select',session:'session-a'},1000);
  await assert.rejects(acknowledge(dir,r.id,'performed',Date.now),/selected_session/);
  await assert.rejects(acknowledge(dir,r.id,'performed',Date.now,'session-b'),/selected_session/);
  await acknowledge(dir,r.id,'performed',Date.now,'session-a');assert.equal(await box.completed(r),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('verification cannot finish after a timely receipt has expired',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-expired-verification-'));
 try{
  let now=0;const box=new NativeMailbox(dir,'owner',()=>now);await box.init();const r=await box.issue({action:'resize'},1000);
  await acknowledge(dir,r.id,'performed',()=>now);assert.equal(await box.completed(r),true);now=1001;
  await assert.rejects(box.finish(r,{verified:true}),/timeout/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('native readiness blocks measurement until the matching session receipt is published',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-ready-'));
 try{
  const box=new NativeMailbox(dir,'owner');await box.init();let measuring=false;
  const ready=control.awaitNativeReady(box,{session:'session-a'},async()=>{},1000).then(r=>{measuring=true;return r;});
  let request;while(!(request=await readRequest(dir)))await new Promise(r=>setTimeout(r,5));
  assert.equal(request.action,'ready');assert.equal(measuring,false);
  await assert.rejects(acknowledge(dir,request.id,'performed',Date.now,'wrong-session'),/selected_session/);
  assert.equal(measuring,false);await acknowledge(dir,request.id,'performed',Date.now,'session-a');
  const result=await ready;assert.equal(measuring,true);assert.equal(result.request.id,request.id);assert.equal(result.observation.selectedSession,'session-a');
  assert.equal(await readRequest(dir),null);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('recording an action returns the next request without exposing the old pending action',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-next-'));
 try{
  const box=new NativeMailbox(dir,'owner');await box.init();const first=await box.issue({action:'select',session:'session-a'},2000);
  const response=control.acknowledgeAndWait(dir,first.id,'performed','session-a',1000);
  while(!await box.completed(first))await new Promise(r=>setTimeout(r,5));
  await box.finish(first,{verified:true});const second=await box.issue({action:'resize',session:'session-a'},2000);
  const result=await response;assert.equal(result.receipt,'recorded');assert.equal(result.nextRequest.id,second.id);assert.equal(result.waitTimedOut,false);
  assert.equal(await box.completed(second),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('next-request wait ends without repeating a completed UI action',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-native-no-next-'));
 try{
  const box=new NativeMailbox(dir,'owner');await box.init();const first=await box.issue({action:'resize'},2000);
  const result=await control.acknowledgeAndWait(dir,first.id,'performed',undefined,25);
  assert.equal(result.receipt,'recorded');assert.equal(result.nextRequest,null);assert.equal(result.waitTimedOut,true);assert.equal(await box.completed(first),true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('memory failure does not skip overload or normal shutdown, nor turn into pass',async()=>{
 const order=[];const result=await runPhases({normal:async()=>{order.push('normal');return {passed:false,memory:{passed:false}};},overload:async()=>{order.push('overload');return {passed:true};},shutdown:async()=>{order.push('shutdown');return {passed:true};}});
 assert.deepEqual(order,['normal','overload','shutdown']);assert.equal(result.passed,false);assert.equal(result.overload.status,'passed');assert.equal(result.shutdown.status,'passed');
});
test('invalid workload skips overload but still attempts shutdown',async()=>{
 const order=[];const result=await runPhases({normal:async()=>{throw Error('output_gap');},overload:async()=>{order.push('overload');},shutdown:async()=>{order.push('shutdown');throw Error('exit_failure');}});
 assert.deepEqual(order,['shutdown']);assert.equal(result.normal.status,'failed');assert.match(result.normal.error,/output_gap/);assert.equal(result.overload.status,'skipped');assert.equal(result.shutdown.status,'failed');assert.equal(result.passed,false);
});
const samples=ratio=>Array.from({length:240},(_,i)=>({elapsed:i*30,phase:'natural',debugPort:{established:0},privateBytes:i>=200?100*ratio:100,workingSetBytes:100}));
test('memory verdict retains five windows and ratios on threshold failure',()=>{
 const r=memoryVerdict(samples(1.21),7200);assert.equal(r.passed,false);assert.equal(r.privateRatio,1.21);assert.equal(r.windows.length,5);assert.equal(memoryVerdict(samples(1.2),7200).passed,true);
});
test('measurement rejects debugger connections, post-boundary data, gaps and short runs',()=>{
 const s=samples(1);assert.throws(()=>memoryVerdict(s,60),/duration/);
 assert.throws(()=>memoryVerdict([...s,{...s[0],elapsed:7200}],7200),/boundary/);
 assert.throws(()=>memoryVerdict(s.map((x,i)=>i===30?{...x,debugPort:{established:1}}:x),7200),/debugger/);
 assert.throws(()=>memoryVerdict(s.filter((_,i)=>i!==30),7200),/gap/);
});
