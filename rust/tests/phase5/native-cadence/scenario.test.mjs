import test from 'node:test';
import assert from 'node:assert/strict';
import {runCadence} from './scenario.mjs';
import {installCadenceGuard} from './run.mjs';

function fake(){
 let time=0;const events=[];const r={born:0,now:()=>time,sleep:async ms=>{time+=ms;},summary:{},sessions:Array.from({length:16},(_,index)=>({index,adapter:index,epoch:1,stream:'s'+index})),event:async(type,value)=>events.push({type,...value}),checkStop:async()=>{},disconnectBrowser:async()=>{},service:async()=>{},sampleMemory:async()=>{},elapsed:()=> (time-(r.loadStart??time))/1000,startMeasurement:async()=>{r.loadStart=time;},freeze:async()=>{r.frozen=(r.frozen??0)+1;},verifyAudits:async()=>[],save:async()=>{}};
 installCadenceGuard(r);return {r,events,advance:ms=>{time+=ms;}};
}
test('three serial rounds revisit current binding, with no early next start',async()=>{
 const {r,events,advance}=fake(),visits=[];
 await runCadence(r,null,{prepare:async()=>{},performRound:async(_r,round,index)=>{const s=r.sessions[index];visits.push([index,s.adapter]);s.adapter=(s.adapter+16)%32;advance(1000);},retire:async()=>{}});
 assert.deepEqual(visits,[[0,0],[1,1],[0,16]]);assert.deepEqual(events.filter(e=>e.type==='cadence_round_start').map(e=>e.startedAt),[0,60000,120000]);assert.equal(r.summary.completedRounds,3);assert.equal(r.frozen,1);
});
test('late action or late verification prevents completion and subsequent rounds',async()=>{
 for(const failure of ['action','verification']){
  const {r,events,advance}=fake();let rounds=0;
  await assert.rejects(runCadence(r,null,{prepare:async()=>{},performRound:async()=>{rounds++;advance(60001);if(failure==='action')await r.checkStop();},retire:async()=>{}}),/round_deadline/);
  assert.equal(rounds,1);assert.equal(r.summary.completedRounds,0);assert.equal(events.filter(e=>e.type==='cadence_round_end').length,0);assert.equal(r.frozen,1);
 }
});
