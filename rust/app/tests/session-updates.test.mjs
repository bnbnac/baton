import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {mockIPC,clearMocks} from '@tauri-apps/api/mocks';
import {subscribe} from '../.test-output/bridge.js';
import {Ownership} from '../.test-output/sessions/ownership.js';
import {InputController} from '../.test-output/terminal/input.js';

const session=(state='user_owned',epoch=4)=>({id:'b',label:'B',host:'example.test',port:22,username:'user',state,epoch,error:null,has_terminal:true,assigned_connection:state==='agent_owned'?'agent':null,intervention:null});
function wire(t){
  globalThis.window={crypto:webcrypto};
  t.after(()=>{clearMocks();delete globalThis.window;});
  let channel,finish;
  const pongs=[];
  mockIPC((name,args)=>{
    if(name==='list_sessions'){channel=args.events;return new Promise(resolve=>{finish=resolve;});}
    if(name==='frontend_pong'){pongs.push(args.request);return;}
    throw Error(`unexpected command: ${name}`);
  });
  let index=0;
  return {emit(event){window.__TAURI_INTERNALS__.runCallback(channel.id,{message:event,index:index++});},initial(snapshot){finish(snapshot);},pongs};
}

test('a delayed older full list cannot restore user control after handoff',async t=>{
  const transport=wire(t),ownership=new Ownership(),writes=[];
  ownership.updateConnections([{id:'agent',display_name:'Agent'}]);ownership.selectConnection('agent');
  const input=new InputController({session:'b',view:'view'},async call=>{writes.push(call);});
  let visible;
  const subscription=subscribe(event=>{if(event.type==='sessions'){visible=event.sessions;input.applySnapshot(visible[0]);}});
  transport.initial({revision:1,sessions:[session()]});await subscription;
  transport.emit({type:'sessions',revision:3,sessions:[session('agent_owned',5)]});
  transport.emit({type:'sessions',revision:2,sessions:[session()]});
  assert.equal(visible[0].state,'agent_owned');
  assert.deepEqual(ownership.reclaim(visible[0]),{id:'b',expected_epoch:5});
  assert.equal(ownership.handoff(visible[0]),null);
  await assert.rejects(input.send('must not write'),/input_not_owned/);
  assert.deepEqual(writes,[]);
});

test('a delayed initial response cannot replace a newer reclaim notification',async t=>{
  const transport=wire(t),seen=[];
  const subscription=subscribe(event=>{if(event.type==='sessions')seen.push(event.sessions);});
  transport.emit({type:'sessions',revision:2,sessions:[session('user_owned',6)]});
  transport.initial({revision:1,sessions:[session('agent_owned',5)]});await subscription;
  assert.deepEqual(seen,[[session('user_owned',6)]]);
});

test('initial-only state is applied before rejecting an older later notification',async t=>{
  const transport=wire(t),seen=[];
  const subscription=subscribe(event=>{if(event.type==='sessions')seen.push(event.sessions);});
  transport.initial({revision:2,sessions:[session('user_owned',6)]});await subscription;
  assert.deepEqual(seen,[[session('user_owned',6)]]);
  transport.emit({type:'sessions',revision:1,sessions:[session('agent_owned',5)]});
  assert.deepEqual(seen,[[session('user_owned',6)]]);
});

test('a newer initial response still applies after an earlier notification',async t=>{
  const transport=wire(t),seen=[];
  const subscription=subscribe(event=>{if(event.type==='sessions')seen.push(event.sessions);});
  transport.emit({type:'sessions',revision:1,sessions:[session('agent_owned',5)]});
  transport.initial({revision:2,sessions:[session('user_owned',6)]});await subscription;
  assert.deepEqual(seen,[[session('agent_owned',5)],[session('user_owned',6)]]);
});

test('closed and removed sessions stay removed even when epochs are equal',async t=>{
  const transport=wire(t),seen=[],other=[];
  const subscription=subscribe(event=>{if(event.type==='sessions')seen.push(event.sessions);else other.push(event);});
  transport.initial({revision:1,sessions:[session()]});await subscription;
  transport.emit({type:'sessions',revision:2,sessions:[session('closed',4)]});
  transport.emit({type:'sessions',revision:3,sessions:[]});
  transport.emit({type:'sessions',revision:2,sessions:[session('closed',4)]});
  transport.emit({type:'sessions',revision:1,sessions:[session()]});
  transport.emit({type:'sessions',revision:3,sessions:[]});
  const connections={type:'connections',connections:[]};
  transport.emit(connections);transport.emit({type:'heartbeat',challenge:'challenge'});
  assert.deepEqual(seen,[[session()],[session('closed',4)],[]]);
  assert.deepEqual(other,[connections]);assert.deepEqual(transport.pongs,[{id:'challenge'}]);
});

test('invalid revisions cannot poison the clock and suppress later valid lists',async t=>{
  const transport=wire(t),seen=[];
  const subscription=subscribe(event=>{if(event.type==='sessions')seen.push(event.sessions);});
  transport.initial({revision:1,sessions:[session()]});await subscription;
  for(const revision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,Infinity,NaN]){
    transport.emit({type:'sessions',revision,sessions:[]});
  }
  transport.emit({type:'sessions',revision:2,sessions:[session('agent_owned',5)]});
  assert.deepEqual(seen,[[session()],[session('agent_owned',5)]]);
});
