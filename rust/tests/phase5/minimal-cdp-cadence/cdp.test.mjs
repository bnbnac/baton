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
test('unanswered request times out and concurrent send is rejected',async()=>{
 const {c,s,trace}=await setup();const p=c.send('Network.disable',{},10);const rejected=assert.rejects(p,/timeout/);await assert.rejects(c.send('Network.disable',{},10),/busy/);await rejected;assert.equal(s.sent.length,1);assert.ok(trace.some(r=>r.kind==='failure'&&r.uncertain));await c.close();
});
test('idle disconnect survives intentional cleanup in the trace',async()=>{
 for(const mode of ['close','error']){const {c,s,trace}=await setup();if(mode==='close')s.close();else s.dispatchEvent(new Event('error'));await new Promise(r=>setImmediate(r));await c.close();assert.equal(trace.filter(v=>v.kind==='disconnected').length,1);assert.equal(trace.at(-1).kind,'closed');}
});
test('execution timeout is capped at dispatch after slow request recording',async()=>{
 const {c,s,set,trace}=await setup();c.record=async row=>{trace.push(row);if(row.kind==='request')set(75);};
 const p=c.send('Runtime.evaluate',evaluateParams('identity',{sessionId:'s'},100),100);await new Promise(r=>setImmediate(r));const sentTimeout=s.sent[0].params.timeout;s.reply({result:{value:{sessionId:'s'}}});await p;await c.close();assert.equal(sentTimeout,25);assert.equal(trace.find(v=>v.kind==='dispatch').timeout,25);
});
test('protocol and JavaScript errors retain bounded diagnostic fields and still reject',async()=>{
 for(const error of [{error:{code:-32602,message:'Invalid parameters',data:'omit'}},{result:{exceptionDetails:{text:'Uncaught',lineNumber:4,columnNumber:8,exception:{description:'Error: dom_session',objectId:'omit',value:'omit'},stackTrace:{secret:'omit'}}}}]){
  const {c,s,trace}=await setup();const pending=c.send('Runtime.evaluate',evaluateParams('identity',{sessionId:'s'},1000),1000),rejected=assert.rejects(pending,/cdp_response_error/);await new Promise(r=>setImmediate(r));
  s.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:s.sent[0].id,...error})}));await rejected;await c.close();const d=trace.find(v=>v.kind==='failure').details;
  if(error.error)assert.deepEqual(d,{kind:'protocol',code:-32602,message:'Invalid parameters',truncated:false});else assert.deepEqual(d,{kind:'javascript',text:'Uncaught',description:'Error: dom_session',lineNumber:4,columnNumber:8,truncated:false});
 }
});
test('large error text is marked truncated without retaining arbitrary remote objects',async()=>{
 const {c,s,trace}=await setup();const pending=c.send('Network.disable',{},1000),rejected=assert.rejects(pending);await new Promise(r=>setImmediate(r));s.reply({exceptionDetails:{text:'x'.repeat(1000),exception:{description:'\u0001'.repeat(1000),value:{ignored:true}}}});await rejected;await c.close();
 const d=trace.find(v=>v.kind==='failure').details;assert.equal(d.truncated,true);assert.equal(d.text.length,128);assert.equal(d.description.length,384);assert.ok(Buffer.byteLength(JSON.stringify(d))<=4096);assert.equal(d.exception,undefined);
});
