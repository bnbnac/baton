import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {domExpression} from './dom.mjs';
export const digest=text=>createHash('sha256').update(text).digest('hex');
export function selectOwnedTarget(targets,port){
 const pages=targets.filter(v=>v.type==='page'&&v.url==='http://tauri.localhost/');assert.equal(pages.length,1,'cdp_target');
 const t=pages[0],u=new URL(t.webSocketDebuggerUrl);assert.ok(t.id&&u.protocol==='ws:'&&u.hostname==='127.0.0.1'&&Number(u.port)===port&&!u.username&&!u.password&&u.pathname==='/devtools/page/'+t.id&&!u.search&&!u.hash,'cdp_endpoint');return {...t};
}
export function evaluateParams(action,args,timeout){assert.ok(Number.isFinite(timeout)&&timeout>0,'cdp_timeout');return {expression:domExpression(action,args),returnByValue:true,awaitPromise:false,timeout,_action:action,_args:args};}
export function validateCommand(method,params){
 assert.ok(['Network.disable','Runtime.evaluate'].includes(method),'cdp_method');
 if(method==='Network.disable'){assert.deepEqual(params,{},'cdp_params');return {wire:{},meta:{}};}
 const {_action:action,_args:args,...wire}=params;
 assert.deepEqual(wire,{expression:domExpression(action,args),returnByValue:true,awaitPromise:false,timeout:wire.timeout},'cdp_expression_params');assert.ok(Number.isFinite(wire.timeout)&&wire.timeout>0,'cdp_timeout');
 return {wire,meta:{action,args,expressionSha256:digest(wire.expression)}};
}
export async function connectCdp({target,deadline,now,record,WebSocketImpl=WebSocket}){
 selectOwnedTarget([target],Number(new URL(target.webSocketDebuggerUrl).port));
 const client=new Client(new WebSocketImpl(target.webSocketDebuggerUrl),{now,record,target});
 try{await client.open(deadline);return client;}catch(e){await client.close().catch(()=>{});throw e;}
}
class Client{
 constructor(socket,{now,record,target}){
  Object.assign(this,{socket,now,record,target,state:'connecting',next:0,pending:null,trace:Promise.resolve(),closing:null});
  this.opened=new Promise((resolve,reject)=>{this.resolveOpen=resolve;this.rejectOpen=reject;});this.opened.catch(()=>{});
  this.closed=new Promise(resolve=>{this.resolveClose=resolve;});
  socket.addEventListener('open',()=>{if(this.state==='connecting'){this.state='open';this.resolveOpen();}});
  socket.addEventListener('close',()=>{this.resolveClose();this.fail('cdp_closed');});
  socket.addEventListener('error',()=>this.fail('cdp_socket_error'));
  socket.addEventListener('message',e=>{void this.message(e.data).catch(error=>this.fail(String(error)));});
 }
 log(row){const entry={...row,at:this.now()};this.trace=this.trace.then(()=>this.record(entry));return this.trace;}
 async open(deadline){
  assert.ok(deadline>this.now(),'cdp_deadline');let timer;
  try{await Promise.race([this.opened,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cdp_connect_timeout')),Math.max(1,deadline-this.now()));})]);assert.ok(this.now()<=deadline,'cdp_deadline');await this.log({kind:'open',target:this.target});}
  finally{clearTimeout(timer);}
 }
 fail(reason){
  if(this.state==='closed')return;this.state='failed';this.rejectOpen(Error(reason));
  const p=this.pending;if(p){this.pending=null;clearTimeout(p.timer);void this.log({kind:'failure',id:p.id,reason,uncertain:p.sent}).then(()=>p.reject(Error(reason)),p.reject);}
 }
 async send(method,params,deadline){
  const {wire,meta}=validateCommand(method,params);assert.equal(this.state,'open','cdp_not_open');assert.equal(this.pending,null,'cdp_busy');assert.ok(this.now()<deadline,'cdp_deadline');
  if(method==='Runtime.evaluate')assert.ok(wire.timeout<=deadline-this.now(),'cdp_execution_timeout');
  const id=++this.next;
  return new Promise((resolve,reject)=>{
   const p={id,resolve,reject,deadline,sent:false};this.pending=p;
   void (async()=>{
    try{
     await this.log({kind:'request',id,method,...meta,deadline,...(method==='Runtime.evaluate'?{timeout:wire.timeout}:{} )});
     if(this.pending!==p)return;assert.equal(this.state,'open');assert.ok(this.now()<deadline,'cdp_deadline');
     p.sent=true;this.socket.send(JSON.stringify({id,method,params:wire}));
     p.timer=setTimeout(()=>this.fail('cdp_request_timeout'),Math.max(1,deadline-this.now()));
    }catch(e){this.fail(String(e));}
   })();
  });
 }
 async message(data){
  if(this.state!=='open')return;
  if(typeof data!=='string'||data.length>16384){this.fail('cdp_message_size');return;}
  let m;try{m=JSON.parse(data);}catch{this.fail('cdp_invalid_json');return;}
  if(m.id===undefined){if(m.method)await this.log({kind:'event',method:String(m.method).slice(0,128)});else this.fail('cdp_invalid_message');return;}
  const p=this.pending;if(!p||p.id!==m.id){this.fail('cdp_response_id');return;}
  if(this.now()>p.deadline){this.fail('cdp_deadline');return;}
  if(m.error||m.result?.exceptionDetails){this.fail('cdp_response_error');return;}
  const result=m.result??{};if(JSON.stringify(result).length>4096){this.fail('cdp_result_size');return;}
  // Keep the request pending until the evidence write settles; a disk error
  // must never become a successful UI action.
  await this.log({kind:'response',id:p.id,result});
  if(this.pending!==p)return;if(this.now()>p.deadline){this.fail('cdp_deadline');return;}
  this.pending=null;clearTimeout(p.timer);p.resolve(result);
 }
 async close(){
  if(this.closing)return this.closing;
  this.closing=(async()=>{this.fail('cdp_closing');this.socket.close();let timer;
   try{await Promise.race([this.closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('cdp_close_timeout')),3000);})]);await this.trace;await this.log({kind:'closed'});this.state='closed';}
   finally{clearTimeout(timer);}
  })();return this.closing;
 }
}
