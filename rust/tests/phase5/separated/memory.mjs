import assert from 'node:assert/strict';
import {memoryVerdict} from '../native-soak-control.mjs';

export async function runMemory(r){
 await r.disconnectBrowser();await r.startMeasurement();
 const initial=r.sessions.map(s=>({id:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream}));
 let round=0,nextSample=0,valid=false;
 try{
  while(r.elapsed()<r.contract.seconds){
   await r.service();
   if(r.elapsed()>=nextSample){await r.sampleMemory();nextSample=(Math.floor(r.elapsed()/30)+1)*30;}
   if(round<r.contract.rounds&&r.elapsed()>=round*60){
    assert.ok(r.elapsed()<round*60+45,'audit_schedule_gap');const health=await r.health();
    for(const b of initial){const p=health[b.adapter].sessions.find(p=>p.session_id===b.id);assert.ok(p,'session_lost');assert.equal(p.state,'agent_owned');assert.equal(p.control_epoch,b.epoch);assert.equal(p.stream_id,b.stream);}
    await r.audit(round++);
   }
   await r.sleep(100);
  }
  assert.ok(r.elapsed()>=r.contract.seconds);assert.equal(round,r.contract.rounds,'missing_audit_round');await r.service();
  r.summary.rates=r.outputRates();for(const rate of r.summary.rates)assert.ok(rate.bytesPerSecond>=1024,'output_rate');valid=true;
 }finally{await r.freeze();if(!valid)r.summary.overload={status:'skipped',reason:'normal_workload_invalid'};}
 try{await r.verifyAudits();}catch(e){r.summary.overload={status:'skipped',reason:'normal_workload_invalid'};throw e;}
 r.summary.normalWorkloadPassed=true;let error;
 try{r.summary.memory=r.contract.profile==='full'?memoryVerdict(r.summary.samples,r.summary.elapsedSeconds):{passed:false,reason:'preflight_duration'};}catch(e){error=e;r.summary.memory={passed:false,error:String(e)};}
 r.summary.overload=await r.overload();await r.save();if(error)throw error;
 return {workloadPassed:true,memory:r.summary.memory,overload:r.summary.overload};
}

export async function runOverload(r){
 assert.equal(r.measurementFrozen,true,'measurement_not_frozen');await r.checkStop();await r.attachBrowser();
 r.summary.playwrightReconnectedUtc=new Date().toISOString();
 const victim=r.sessions[0],burst="for j in $(seq 1 40); do head -c 32768 /dev/zero | tr '\\000' Z; sleep 0.1; done";
 await r.command(victim,burst+"; printf '\\nCONTROL_DONE\\n'");let tail='';
 await r.waitFor(async()=>{const p=await r.tool(victim.adapter,'read_output',{session_id:victim.id,control_epoch:victim.epoch,stream_id:victim.stream,cursor:victim.cursor,limit:32768,wait_ms:100});assert.ok(p.oldest_cursor<=victim.cursor);victim.cursor=p.next_cursor;tail=(tail+(p.text??'')).slice(-65536);return tail.includes('CONTROL_DONE');},'overload_control',20000,{service:false});
 assert.equal((await r.sessionStatus(victim)).state,'agent_owned');
 await r.page.evaluate(id=>{const original=window.fetch;window.__separatedDroppedAcks=0;window.fetch=function(url,init){if(String(url).endsWith('/ack_output')&&JSON.parse(init.body).request.binding.session===id){window.__separatedDroppedAcks++;return new Promise(()=>{});}return original.call(this,url,init);};},victim.id);
 await r.waitFor(async()=>await r.page.evaluate(()=>window.__separatedDroppedAcks>0),'ack_block',20000,{service:false});
 assert.equal((await r.sessionStatus(victim)).state,'agent_owned');await r.command(victim,burst);
 const closed=await r.waitFor(async()=>{const p=await r.sessionStatus(victim);return p.state==='closed'?p:false;},'overload_closed',20000,{service:false});
 const droppedAcks=await r.page.evaluate(()=>window.__separatedDroppedAcks);assert.ok(droppedAcks>0);
 for(const s of r.sessions.slice(1))assert.equal((await r.sessionStatus(s)).state,'agent_owned','other_session_closed');
 const result={passed:true,controlBurstPassed:true,burstBytes:1310720,victim:victim.id,state:closed.state,droppedAcks,unaffectedAlive:15};await r.event('overload',result);return result;
}
