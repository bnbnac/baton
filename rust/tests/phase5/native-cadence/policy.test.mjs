import test from 'node:test';
import assert from 'node:assert/strict';
import {CADENCE,roundWindow,nextStart,withinDeadline} from './policy.mjs';

test('three visits use 0,1,0 and reject a fourth',()=>{
 assert.deepEqual([0,1,2].map(round=>roundWindow({round,startedAt:round*60000,previousStartedAt:round? (round-1)*60000:undefined,runDeadline:900000}).index),[0,1,0]);
 assert.throws(()=>roundWindow({round:3,startedAt:180000,runDeadline:900000}));
 assert.equal(CADENCE.seconds,900);assert.equal(CADENCE.scope,'NC');
});
test('cadence has no early start or grace beyond deadline',()=>{
 assert.equal(nextStart(100),60100);assert.equal(withinDeadline(60000,60000),true);assert.equal(withinDeadline(60001,60000),false);
 assert.throws(()=>roundWindow({round:1,startedAt:59999,previousStartedAt:0,runDeadline:900000}));
 assert.deepEqual(roundWindow({round:1,startedAt:60000,previousStartedAt:0,runDeadline:100000}),{index:1,startedAt:60000,deadline:100000});
 assert.throws(()=>roundWindow({round:0,startedAt:900000,runDeadline:900000}));
 for(const startedAt of [NaN,Infinity,-1])assert.throws(()=>roundWindow({round:0,startedAt,runDeadline:900000}));
});
