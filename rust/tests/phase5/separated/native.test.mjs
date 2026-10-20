import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeCasesMailbox,publishNative} from './native.mjs';
async function box(t){const dir=await mkdtemp(join(tmpdir(),'baton-native-cases-'));t.after(()=>rm(dir,{recursive:true,force:true}));let time=0;const b=new NativeCasesMailbox(dir,'owner',()=>time);await b.init();return {b,dir,set:n=>{time=n;}};}
const observation={selectedSession:'s0',windowMode:'restored',screenshotId:'main'};
test('operator may take 49 seconds and verification gets its own bounded interval',async t=>{
 const {b,dir,set}=await box(t);const q=await b.issue({action:'select',session:'s0'},900000);set(60000);await b.beginInput(q.id);
 set(109000);await b.accept({id:q.id,owner:'owner',status:'performed',observation});
 set(153999);const result=await b.finish({verified:true});assert.equal(await b.read(),null);
 assert.equal(result.request.inputDeadline,180000);assert.equal(result.request.responseReceivedAt,109000);assert.equal(result.request.verifyDeadline,154000);
 const accepted=JSON.parse(await readFile(join(dir,'acceptances',q.id+'.json'),'utf8'));assert.equal(accepted.responseReceivedAt,109000);assert.equal(accepted.verifyDeadline,154000);
});
test('input and whole-run expiration are enforced independently',async t=>{
 const {b,set}=await box(t);const q=await b.issue({action:'resize',session:'s0',windowMode:'restored'},900000);set(890000);await b.beginInput(q.id);assert.equal(b.active.inputDeadline,900000);set(899000);await b.accept({id:q.id,owner:'owner',status:'performed',observation});assert.equal(b.active.verifyDeadline,900000);set(900001);await assert.rejects(b.finish({verified:true}),/run_expired/);
});
test('a completion arriving after the operator budget never starts verification',async t=>{
 const {b,dir,set}=await box(t);const q=await b.issue({action:'resize',session:'s0'},900000);await b.beginInput(q.id);set(120001);
 await assert.rejects(b.accept({id:q.id,owner:'owner',status:'performed',observation}),/input_expired/);assert.equal(b.response,null);
 await assert.rejects(readFile(join(dir,'acceptances',q.id+'.json')),/ENOENT/);
});
test('verification timeout is not reset by polling or duplicate completion',async t=>{
 const {b,set}=await box(t);const q=await b.issue({action:'resize',session:'s0',windowMode:'restored'},900000);await b.beginInput(q.id);set(100000);const response={id:q.id,owner:'owner',status:'performed',observation};await b.accept(response);
 set(144999);await b.poll();await assert.rejects(b.accept(response),/duplicate/);set(145001);await assert.rejects(b.finish({verified:true}),/verification_expired/);
});
test('stale, foreign, duplicate or wrong-session receipts cannot complete an action',async t=>{
 const {b}=await box(t);const q=await b.issue({action:'select',session:'s0'},900000);await b.beginInput(q.id);
 for(const change of [r=>r.id='old',r=>r.owner='foreign',r=>r.observation.selectedSession='s1',r=>r.status='failed']){
  const response={id:q.id,owner:'owner',status:'performed',observation:{...observation}};change(response);await assert.rejects(b.accept(response));
 }
 await b.accept({id:q.id,owner:'owner',status:'performed',observation});await assert.rejects(b.accept({id:q.id,owner:'owner',status:'performed',observation}),/duplicate/);
});
test('receipt requires acknowledged start, main capture evidence and independent verification',async t=>{
 const {b}=await box(t);const q=await b.issue({action:'select',session:'s0'},900000);
 await assert.rejects(b.accept({id:q.id,owner:'owner',status:'performed',observation}),/input_not_started/);
 await b.beginInput(q.id);await assert.rejects(b.accept({id:q.id,owner:'owner',status:'performed',observation:{selectedSession:'s0'}}),/capture/);
 await b.accept({id:q.id,owner:'owner',status:'performed',observation});await assert.rejects(b.finish({verified:false}),/unverified/);
});
test('concurrent CLI receipts publish one whole file without replacement',async t=>{
 const {b,dir}=await box(t);const q=await b.issue({action:'select',session:'s0'},900000);await b.beginInput(q.id);
 const results=await Promise.allSettled([publishNative(dir,'done',q.id,observation),publishNative(dir,'done',q.id,observation)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const value=JSON.parse(await readFile(join(dir,'responses',q.id+'.json'),'utf8'));assert.equal(value.id,q.id);assert.equal(value.owner,'owner');
});
