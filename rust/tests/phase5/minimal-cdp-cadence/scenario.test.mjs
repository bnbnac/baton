import test from 'node:test';
import assert from 'node:assert/strict';
import {runCdpCadence,performRound} from './scenario.mjs';
import {installCadenceGuard} from '../native-cadence/run.mjs';
function fake(){
 let time=0;const events=[],calls=[];const r={born:0,now:()=>time,sleep:async ms=>{time+=ms;},summary:{instrumentation:{}},sessions:Array.from({length:16},(_,index)=>({index,id:'s'+index,adapter:index,epoch:1,stream:'p'+index})),event:async(type,value)=>{const e={type,...value};events.push(e);return e;},checkStop:async()=>{},service:async()=>{},tool:async()=>{},disconnectBrowser:async()=>{},sampleMemory:async()=>calls.push('sample'),elapsed:()=> (time-(r.loadStart??time))/1000,startMeasurement:async()=>{r.loadStart=time;},freeze:async()=>{r.frozen=(r.frozen??0)+1;},verifyAudits:async()=>{calls.push('audits');},save:async()=>{},outputRates:()=>[]};
 installCadenceGuard(r);const overrides={prepare:async()=>{r.cdp={close:async()=>calls.push('close')};},performRound:async()=>{time+=1000;}};return {r,events,calls,overrides,advance:ms=>{time+=ms;}};
}
test('three rounds use current binding and 60s start spacing',async()=>{
 const {r,events,calls,overrides,advance}=fake(),visits=[];overrides.performRound=async(r,round,index)=>{visits.push([index,r.sessions[index].adapter]);r.sessions[index].adapter=(r.sessions[index].adapter+16)%32;advance(1000);};
 await runCdpCadence(r,overrides);assert.deepEqual(visits,[[0,0],[1,1],[0,16]]);assert.deepEqual(events.filter(e=>e.type==='cadence_round_start').map(e=>e.startedAt),[0,60000,120000]);assert.equal(r.summary.completedRounds,3);assert.equal(r.frozen,1);assert.ok(calls.indexOf('close')<calls.indexOf('audits'));
});
test('first late round never launches another, audit cleanup retained',async()=>{
 const {r,events,calls,overrides,advance}=fake();overrides.performRound=async()=>advance(60001);await assert.rejects(runCdpCadence(r,overrides),/round_deadline/);assert.equal(r.summary.completedRounds,0);assert.equal(events.filter(e=>e.type==='cadence_round_start').length,1);assert.ok(calls.includes('close'));assert.ok(calls.includes('audits'));
});
test('exact deadline allowed and nested service samples share one schedule',async()=>{
 const {r,calls,overrides,advance}=fake();overrides.performRound=async()=>{for(let i=0;i<6;i++){advance(10000);await r.tool();}};await runCdpCadence(r,overrides);assert.equal(r.summary.completedRounds,3);assert.ok(calls.filter(c=>c==='sample').length>=6);
});
test('prepare or CDP close failure preserves audit capture and failure',async()=>{
 for(const mode of ['prepare','close']){const {r,calls,overrides}=fake();overrides.prepare=async()=>{r.cdp={close:async()=>{calls.push('close');if(mode==='close')throw Error('close');}};if(mode==='prepare')throw Error('prepare');};await assert.rejects(runCdpCadence(r,overrides),new RegExp(mode));assert.ok(calls.includes('audits'));}
});
test('real round driver observes MCP geometry and ownership before audit and health',async()=>{
 const {r,advance}=fake(),order=[];r.connections=Array.from({length:32},(_,i)=>'c'+i);r.fixtures=[{id:'a'},{id:'b'}];let selected,geometry={rows:32,columns:120},assignedAdapter=0,state='agent_owned',epoch=1,stream='p0';
 r.cadenceGuard.beginRound(60000);r.during=op=>op();
 r.cdp={send:async(_method,p)=>{const action=p._action;order.push(action);if(action==='select')selected=p._args.sessionId;if(action==='resize')geometry={rows:32,columns:80};if(action==='reclaim'){state='user_owned';epoch++;stream=null;}if(action==='handoff'){assignedAdapter=16;state='agent_owned';epoch++;stream='new';}return {result:{value:{sessionId:selected,...(p._args.connectionId?{connectionId:p._args.connectionId}:{}),...(action==='resize'?{width:p._args.width}:{})}}};}};
 const session=()=>({session_id:'s0',state,control_epoch:epoch,stream_id:stream,geometry});r.sessionStatus=async()=>session();r.status=async index=>({connection_id:'c'+index,sessions:index===assignedAdapter?[session()]:[]});r.waitFor=async check=>{for(let i=0;i<30;i++){const result=await check();if(result)return result;advance(100);}throw Error('timeout');};
 r.command=async()=>order.push('stty');r.docker=async()=> '32 80';r.setTransition=async()=>{};r.adoptBinding=async(s,b)=>{Object.assign(s,b);};r.audit=async()=>order.push('audit');r.health=async()=>order.push('health');
 await performRound(r,0,0);assert.deepEqual(order,['select','identity','resize','stty','reclaim','choose_connection','handoff','audit','health']);assert.equal(r.sessions[0].adapter,16);assert.equal(r.sessions[0].stream,'new');
});
