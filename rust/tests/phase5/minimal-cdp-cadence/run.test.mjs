import test from 'node:test';
import assert from 'node:assert/strict';
import {createCdpCadenceRuntime,executeCdpCadence,commonSources} from './run.mjs';
test('CC runtime preserves scope and exact measurement boundaries',async()=>{
 let time=0;const events=[],r=createCdpCadenceRuntime({root:'.',out:'.',config:{}},{now:()=>++time});r.event=async type=>{const row={type,t:r.now()-r.born,seq:events.length+1};events.push(row);return row;};r.json=async()=>{};r.save=async()=>{};
 await r.startMeasurement();await r.freeze();assert.equal(r.contract.scope,'CC');assert.equal(r.summary.elapsedSeconds,(events[1].t-events[0].t)/1000);
});
test('common source comparison requires all 23 exact baseline keys',()=>{
 const peer=Object.fromEntries(Array.from({length:23},(_,i)=>['p'+i,'h'+i]));assert.deepEqual(commonSources({...peer,extra:'x'},peer),peer);assert.throws(()=>commonSources({...peer,p0:'changed'},peer));delete peer.p0;assert.throws(()=>commonSources(peer,peer));
});
test('setup, scenario and shutdown failures still cleanup and check hashes',async()=>{
 for(const where of ['setup','scenario','shutdown']){const calls=[],r={summary:{},init:async()=>{},setup:async()=>{if(where==='setup')throw Error(where);},shutdown:async()=>{calls.push('shutdown');if(where==='shutdown')throw Error(where);},cleanup:async()=>{calls.push('cleanup');return {normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]};},checkHashes:async()=>calls.push('hashes'),save:async()=>{}};
 await executeCdpCadence(r,async()=>{if(where==='scenario')throw Error(where);});assert.equal(r.summary.status,'failed');assert.deepEqual(calls,['shutdown','cleanup','hashes']);}
});
