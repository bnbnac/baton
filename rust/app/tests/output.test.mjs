import test from 'node:test';import assert from 'node:assert/strict';import {OutputQueue} from '../.test-output/terminal/output.js';
const binding={session:'a',view:'v'};const frame=(seq,n=1)=>({binding,seq,bytes:Array(n).fill(65),queries:[]});
test('new frames may arrive after server ack before the ack invocation resolves',async()=>{
 const rendered=[],acked=[];let second;
 const q=new OutputQueue(binding,async f=>{rendered.push(f.seq);},async seq=>{
   acked.push(seq);
   if(seq===1){second=q.write(frame(2,65536));await Promise.resolve();assert.deepEqual(rendered,[1]);}
 });
 await q.write(frame(1,65536));await second;
 assert.deepEqual(rendered,[1,2]);assert.deepEqual(acked,[1,2]);
});
test('ack failure cancels queued frames without rendering or acknowledging them',async()=>{
 const rendered=[],acked=[];let next,failure;
 const q=new OutputQueue(binding,async f=>{rendered.push(f.seq);},async seq=>{
   acked.push(seq);next=q.write(frame(2,65536));failure=assert.rejects(next);
   await assert.rejects(q.write(frame(3)));throw Error('ack_failed');
 });
 await assert.rejects(q.write(frame(1,65536)),/ack_failed/);await failure;
 assert.deepEqual(rendered,[1]);assert.deepEqual(acked,[1]);await assert.rejects(q.write(frame(3)));
});
test('frames drain in order and include the active frame in the total byte budget',async()=>{let release;const gate=new Promise(r=>release=r),seen=[];const q=new OutputQueue(binding,async f=>{seen.push(f.seq);if(f.seq===1)await gate;});const first=q.write(frame(1,32768)),last=q.write(frame(2,32768));await assert.rejects(q.write(frame(3)));assert.deepEqual(seen,[1]);release();await Promise.all([first,last]);assert.deepEqual(seen,[1,2]);await q.write(frame(3));assert.deepEqual(seen,[1,2,3]);});
test('replay future foreign frame and unordered query marks never reach renderer',async()=>{const seen=[];const q=new OutputQueue(binding,async f=>seen.push(f.seq));await assert.rejects(q.write(frame(2)));await assert.rejects(q.write({...frame(1),binding:{session:'b',view:'v'}}));await assert.rejects(q.write({...frame(1,5),queries:[{id:1,kind:'cpr',epoch:0,endOffset:5}]}));await q.write(frame(1));await assert.rejects(q.write(frame(1)));assert.deepEqual(seen,[1]);});
test('failed rendering prevents later frames from being acknowledged',async()=>{let release;const gate=new Promise(r=>release=r),seen=[];const q=new OutputQueue(binding,async f=>{seen.push(f.seq);await gate;throw Error('renderer_failed');});const first=q.write(frame(1)),next=q.write(frame(2));const failures=Promise.all([assert.rejects(first),assert.rejects(next)]);release();await failures;await assert.rejects(q.write(frame(3)));assert.deepEqual(seen,[1]);});
