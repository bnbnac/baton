import test from 'node:test';
import assert from 'node:assert/strict';
import {runAttachedArm,performStaticRound,prepareAttached} from './scenario.mjs';
import {installArmGuard} from './guard.mjs';
import {resolveArm} from './policy.mjs';
function fake(arm='A',profile='preflight'){
 let time=0;const events=[],calls=[];
 const r={born:0,contract:resolveArm(arm,profile),now:()=>time,sleep:async ms=>{time+=ms;},summary:{instrumentation:{},samples:[]},sessions:Array.from({length:16},(_,index)=>({index,id:'s'+index,adapter:index,epoch:1,stream:'p'+index})),event:async(type,detail={})=>{const row={type,t:time,seq:events.length+1,...detail};events.push(row);return row;},checkStop:async()=>{},service:async()=>{},tool:async()=>{},sampleMemory:async()=>{calls.push('sample');r.summary.samples.push({elapsed:r.elapsed()});},elapsed:()=>r.loadStart===undefined?0:(time-r.loadStart)/1000,startMeasurement:async()=>{r.cadenceGuard.startMeasurement(time);r.loadStart=time;},freeze:async()=>{r.measurementFrozen=true;r.frozen=(r.frozen??0)+1;},verifyAudits:async()=>{calls.push('audits');},save:async()=>{},outputRates:()=>Array.from({length:16},(_,index)=>({index,bytesPerSecond:1100})),status:async()=>({sessions:[]})};
 installArmGuard(r);
 const overrides={prepare:async()=>{r.cdp={state:'open',close:async()=>{calls.push('close');r.cdp.state='closed';}};},performStaticRound:async()=>{time+=1000;},performRound:async()=>{time+=1000;}};
 return {r,events,calls,overrides,advance:ms=>{time+=ms;}};
}
test('static round queries six times without mutation and checks all baseline sessions',async()=>{
 const {r}=fake();const actions=[],tail=[];r.cadenceGuard.startMeasurement(0);r.cadenceGuard.beginRound(60000);r.during=op=>op();
 r.cdp={send:async(_m,p)=>{actions.push(p._action);return {result:{value:{sessionId:'s0'}}};}};
 r.summary.initialState=r.sessions.map(s=>({index:s.index,adapter:s.adapter,session:{session_id:s.id,state:'agent_owned',control_epoch:1,stream_id:s.stream,geometry:{rows:32,columns:120}}}));
 r.audit=async()=>tail.push('audit16');r.health=async()=>{tail.push('health32');return Array.from({length:32},(_,i)=>({connection_id:'c'+i,sessions:r.summary.initialState.filter(b=>b.adapter===i).map(b=>structuredClone(b.session))}));};
 await performStaticRound(r,0);assert.deepEqual(actions,Array(6).fill('identity'));assert.deepEqual(tail,['audit16','health32']);
 const health=r.health;r.health=async()=>{const rows=await health();rows[15].sessions[0].control_epoch++;return rows;};await assert.rejects(performStaticRound(r,1),/static_state_changed/);
});
test('full B uses all sessions and current paired binding on revisit',async()=>{
 const {r,events,overrides,advance}=fake('B','full'),visits=[];
 overrides.performRound=async(r,k,index)=>{visits.push([index,r.sessions[index].adapter]);r.sessions[index].adapter=(r.sessions[index].adapter+16)%32;advance(1000);};
 await runAttachedArm(r,overrides);assert.equal(visits.length,120);assert.deepEqual(visits[16],[0,16]);assert.deepEqual(visits[119],[7,23]);
 assert.equal(r.elapsed(),7200);assert.equal(r.frozen,1);assert.equal(r.summary.completedRounds,120);
 assert.deepEqual(events.filter(e=>e.type==='arm_round_start').map(e=>e.startedAt),Array.from({length:120},(_,i)=>i*60000));
});
test('preflight retains final measurement minute and absolute sample ticks',async()=>{
 const {r,overrides,advance}=fake();const base=r.sampleMemory;r.sampleMemory=async()=>{await base();advance(5000);};
 await runAttachedArm(r,overrides);assert.equal(r.summary.completedRounds,3);assert.equal(r.elapsed(),180);
 assert.deepEqual(r.summary.samples.map(s=>s.elapsed),[0,30,60,90,120,150]);
});
test('final read may cross measurement boundary within freeze grace',async()=>{
 const {r,overrides,advance}=fake();
 r.service=async()=>{if(r.now()>=179900){advance(200);await r.cadenceGuard.check();}};
 await runAttachedArm(r,overrides);assert.equal(r.summary.workloadPassed,true);assert.equal(r.elapsed(),180.1);assert.equal(r.frozen,1);
});
for(const mode of ['audit','disconnect','slow','sample','stop'])test('first '+mode+' failure freezes once and stops later rounds',async()=>{
 const {r,events,calls,overrides,advance}=fake();
 overrides.performStaticRound=async()=>{if(mode==='audit')throw Error('partial_audit');if(mode==='disconnect')r.cdp.state='failed';if(mode==='slow')advance(60001);if(mode==='sample'){advance(30000);r.sampleMemory=async()=>{advance(31000);};await r.tool();}if(mode==='stop')throw Error('stop_requested');};
 await assert.rejects(runAttachedArm(r,overrides));assert.equal(r.frozen,1);assert.equal(r.summary.completedRounds,0);assert.equal(events.filter(e=>e.type==='arm_round_start').length,1);assert.ok(calls.indexOf('close')<calls.indexOf('audits'));assert.equal(events.filter(e=>e.type==='failure_status').length,32);
});
test('prepare normalizes before detaching and captures all initial states',async()=>{
 const {r,advance}=fake();const calls=[];r.during=op=>op();r.page={setViewportSize:async v=>{assert.deepEqual(v,{width:1280,height:900});calls.push('viewport');},locator:()=>({evaluate:async(fn,width)=>{assert.equal(width,1000);calls.push('width');}})};
 r.sessionStatus=async s=>({session_id:s.id,state:'agent_owned',control_epoch:s.epoch,stream_id:s.stream,geometry:{rows:32,columns:120}});
 r.waitFor=async check=>{for(let i=0;i<15;i++){const result=await check();if(result)return result;advance(100);}throw Error('not_stable');};
 await prepareAttached(r,{prepare:async()=>calls.push('detach-and-cdp')});
 assert.deepEqual(calls,['viewport','width','detach-and-cdp']);assert.equal(r.summary.initialState.length,16);assert.equal(r.loadStart,undefined);
});
test('prepare failure still closes and captures audit evidence without measurement',async()=>{
 const {r,calls,overrides}=fake();overrides.prepare=async()=>{throw Error('prepare');};await assert.rejects(runAttachedArm(r,overrides),/prepare/);assert.equal(r.frozen,undefined);assert.ok(calls.includes('audits'));
});
