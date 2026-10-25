import assert from 'node:assert/strict';
export const CADENCE=Object.freeze({scope:'NC',profile:'diagnostic',seconds:900,rounds:0,maxRounds:3,sessionOrder:Object.freeze([0,1,0]),periodMs:60000});
export const nextStart=previousStartedAt=>previousStartedAt+CADENCE.periodMs;
export const withinDeadline=(now,deadline)=>Number.isFinite(now)&&Number.isFinite(deadline)&&now<=deadline;
export function roundWindow({round,startedAt,previousStartedAt,runDeadline}){
 assert.ok(Number.isInteger(round)&&round>=0&&round<CADENCE.maxRounds,'round_count');
 assert.ok(Number.isFinite(startedAt)&&startedAt>=0&&Number.isFinite(runDeadline)&&startedAt<runDeadline,'run_expired');
 if(round>0)assert.ok(Number.isFinite(previousStartedAt)&&startedAt>=nextStart(previousStartedAt),'early_start');
 return {index:CADENCE.sessionOrder[round],startedAt,deadline:Math.min(startedAt+CADENCE.periodMs,runDeadline)};
}
