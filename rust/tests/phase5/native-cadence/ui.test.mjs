import test from 'node:test';
import assert from 'node:assert/strict';
import {inputPermission} from './ui.mjs';
const state=()=>({summary:{owner:'owner',status:'running',clockEpoch:100000},pending:{id:'a',owner:'owner'},active:{id:'a',owner:'owner',inputDeadline:60000,expiresAt:60000}});
test('UI permission expires independently of a delayed runner and rejects retired input',()=>{
 assert.equal(inputPermission(state(),'a',159999),true);
 for(const change of [s=>{s.active.inputDeadline=59000;},s=>{s.pending=null;},s=>{s.summary.finishedUtc='done';},s=>{s.active.owner='other';},s=>{s.active.responseReceivedAt=1;},s=>{s.stopped=true;}]){const s=state();change(s);assert.equal(inputPermission(s,'a',159999),false);}
 assert.equal(inputPermission(state(),'a',160001),false);assert.equal(inputPermission(state(),'wrong',159999),false);
});
