import test from 'node:test';
import assert from 'node:assert/strict';
import {connectCdp,selectOwnedTarget,evaluateParams} from './cdp.mjs';
import {domExpression} from './dom.mjs';
const target={id:'page',type:'page',url:'http://tauri.localhost/',webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/page/page'};
class Socket extends EventTarget{
 static last;sent=[];readyState=0;
 constructor(){super();Socket.last=this;queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
 send(text){this.sent.push(JSON.parse(text));}
 reply(result,id=this.sent.at(-1)?.id){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id,result})}));}
 close(){this.readyState=3;queueMicrotask(()=>this.dispatchEvent(new Event('close')));}
}
async function setup(){let time=0;const trace=[];const c=await connectCdp({target,deadline:10000,now:()=>time,record:async row=>trace.push(row),WebSocketImpl:Socket});return {c,trace,s:Socket.last,set:t=>{time=t;}};}
test('selects exactly one owned page and rejects foreign or ambiguous endpoints',()=>{
 assert.equal(selectOwnedTarget([target],9222).id,'page');
 for(const rows of [[],[target,target],[{...target,webSocketDebuggerUrl:'ws://other:9222/a'}],[{...target,url:'http://other/'}],[{...target,webSocketDebuggerUrl:'ws://127.0.0.1:9223/a'}]])assert.throws(()=>selectOwnedTarget(rows,9222));
});
test('only explicit disable and generated evaluate, serial trace, closes',async()=>{
 const {c,s,trace}=await setup();
 for(const method of ['Network.enable','HeapProfiler.collectGarbage','Runtime.enable'])await assert.rejects(c.send(method,{},1000),/method/);
 await assert.rejects(c.send('Runtime.evaluate',{expression:'1'},1000),/expression|params|dom_action/);assert.equal(s.sent.length,0);
 const p=c.send('Network.disable',{},1000);await new Promise(r=>setImmediate(r));s.reply({});await p;
 const params=evaluateParams('identity',{sessionId:'s'},500);assert.equal(params.expression,domExpression('identity',{sessionId:'s'}));
 const q=c.send('Runtime.evaluate',params,1000);await new Promise(r=>setImmediate(r));s.reply({result:{value:{sessionId:'s'}}});await q;
 await c.close();assert.equal(c.state,'closed');assert.equal(trace.filter(r=>r.kind==='request').length,2);assert.equal(trace.filter(r=>r.kind==='response').length,2);
});
test('late response fails closed with uncertain outcome and no next send',async()=>{
 const {c,s,set,trace}=await setup();const p=c.send('Network.disable',{},1000);await new Promise(r=>setImmediate(r));set(1001);s.reply({});await assert.rejects(p,/deadline/);
 await assert.rejects(c.send('Network.disable',{},2000));assert.equal(s.sent.length,1);assert.ok(trace.some(r=>r.kind==='failure'&&r.uncertain));await c.close();
});
test('socket errors, protocol errors, JS exceptions and record failure reject',async()=>{
 for(const mode of ['close','error','json','exception','record']){
  const {c,s}=await setup();if(mode==='record')c.record=async()=>{throw Error('disk');};
  const p=c.send('Network.disable',{},1000);const failure=assert.rejects(p);await new Promise(r=>setImmediate(r));
  if(mode==='close')s.close();if(mode==='error')s.dispatchEvent(new Event('error'));if(mode==='json')s.dispatchEvent(new MessageEvent('message',{data:'!'}));if(mode==='exception')s.reply({exceptionDetails:{text:'bad'}});
  await failure;await c.close().catch(()=>{});
 }
});
