import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTransition,verifyRounds,runFunctional} from './transitions.mjs';
import {transitionFixture} from './test-fixture.mjs';
const sessions=Array.from({length:16},(_,index)=>({index,id:'s'+index})),connections=Array.from({length:32},(_,i)=>'c'+i);
test('complete transition proves geometry, public binding and previous owner release',()=>assert.equal(verifyTransition(transitionFixture()).verified,true));
for(const [name,change] of [
 ['stale epoch',r=>r.reclaimed.control_epoch=1],['reused stream',r=>r.assigned.session.stream_id=r.before.stream],
 ['wrong target',r=>r.assigned.connection_id='c31'],['old owner retained',r=>r.oldOwner.sessions=[{session_id:r.before.session}]],
 ['unstable selected geometry',r=>r.selected.stableAt=849],['resize before selection',r=>r.resized.observedAt=10],
 ['stty mismatch',r=>r.remote='32 120'],['wrong selected session',r=>r.selected.session='other'],
 ['unchanged geometry',r=>{r.resized.geometry={rows:32,columns:120};r.remote='32 120';}],
 ['private stream retained',r=>r.reclaimed.stream_id='leak'],['wrong assigned session',r=>r.assigned.session.session_id='other']
])test('rejects '+name,()=>{const r=transitionFixture();change(r);assert.throws(()=>verifyTransition(r));});
test('round coverage requires a second visit in preflight and rejects duplicate or missing full rounds',()=>{
 const rows=Array.from({length:120},(_,i)=>transitionFixture(i));
 assert.equal(verifyRounds(rows,120,sessions,connections).rounds,120);
 assert.equal(verifyRounds(rows.slice(0,17),17,sessions,connections).rounds,17);
 assert.equal(rows[16].before.adapter,16);assert.equal(rows[16].adapter,0);
 assert.throws(()=>verifyRounds(rows.slice(0,119),120,sessions,connections));
 const duplicate=structuredClone(rows);duplicate[119]=duplicate[118];assert.throws(()=>verifyRounds(duplicate,120,sessions,connections));
 const broken=structuredClone(rows);broken[16].before.stream='invented';assert.throws(()=>verifyRounds(broken,120,sessions,connections));
});
test('functional coordinator stops at the first failed transition rather than filling the count',async()=>{
 const events=[];const r={contract:{rounds:17},summary:{},startMeasurement:async()=>{},audit:async()=>{},health:async()=>{},service:async()=>{},event:async(type,detail)=>events.push({type,...detail}),freeze:async()=>events.push({type:'freeze'}),verifyAudits:async()=>{},outputRates:()=>[]};
 await assert.rejects(runFunctional(r,{transition:async(_r,round)=>{if(round===2)throw Error('wrong_owner');return transitionFixture(round);}}),/wrong_owner/);
 assert.equal(events.filter(e=>e.type==='transition').length,2);assert.equal(events.at(-1).type,'freeze');assert.equal(r.summary.normalWorkloadPassed,undefined);
});
