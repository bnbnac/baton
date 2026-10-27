import assert from 'node:assert/strict';
import {prepareCdp,ui,performRound,observeFailureState} from '../minimal-cdp-cadence/scenario.mjs';
import {selectedGeometry} from '../separated/transitions.mjs';
import {slot,nextSampleAt} from './policy.mjs';

export function staticState(p){
 return {session_id:p.session_id,state:p.state,control_epoch:p.control_epoch,stream_id:p.stream_id,geometry:p.geometry};
}
export async function prepareAttached(r,{prepare=prepareCdp}={}){
 await r.during(()=>r.page.setViewportSize({width:1280,height:900}));
 await r.during(()=>r.page.locator('.terminal-workspace').evaluate((node,width)=>{node.style.width=width+'px';},1000));
 const geometry=await selectedGeometry(r,r.sessions[0],r.now());
 await r.event('normalized_view',{viewport:{width:1280,height:900},workspaceWidth:1000,...geometry});
 await prepare(r);
 const baseline=[];
 for(const s of r.sessions){
  const p=await r.sessionStatus(s);
  assert.equal(p.state,'agent_owned');assert.equal(p.control_epoch,s.epoch);assert.equal(p.stream_id,s.stream);
  baseline.push({index:s.index,adapter:s.adapter,session:staticState(p)});
 }
 r.summary.initialState=baseline;
 await r.event('initial_state',{sessions:baseline});
}
export async function performStaticRound(r,k){
 for(let i=0;i<6;i++)await ui(r,'identity',{sessionId:r.sessions[0].id},k);
 await r.audit(k);const values=await r.health();
 for(const b of r.summary.initialState){
  const p=values[b.adapter].sessions.find(v=>v.session_id===b.session.session_id);
  assert.ok(p,'static_session_missing');assert.deepEqual(staticState(p),b.session,'static_state_changed');
 }
 await r.event('static_observation',{round:k});
}
export async function runAttachedArm(r,overrides={}){
 const g=r.cadenceGuard,originals=new Map(),check=g.check.bind(g);
 let attached=false,sampling=false,nextSample,failure;
 g.check=async()=>{await check();if(attached)assert.equal(r.cdp.state,'open','cdp_not_open');};
 Object.assign(r.summary,{completedRounds:0,workloadPassed:false,memoryPassed:null,phase5Acceptance:false});
 const sample=async()=>{
  if(sampling||r.loadStart===undefined||r.measurementFrozen||r.now()<nextSample||r.elapsed()>=r.contract.seconds)return;
  sampling=true;
  try{await g.check();await r.sampleMemory();nextSample=nextSampleAt(r.loadStart,r.now());await g.check();}
  finally{sampling=false;}
 };
 for(const name of ['service','tool'])if(r[name]){
  const original=r[name];originals.set(name,original);
  r[name]=async(...args)=>{const value=await original.apply(r,args);await sample();return value;};
 }
 const waitUntil=async time=>{
  while(r.now()<time){await r.checkStop();await r.service();if(r.now()<time)await r.sleep(Math.min(100,time-r.now()));}
 };
 try{
  await (overrides.prepare??prepareAttached)(r);attached=true;await g.check();await r.startMeasurement();nextSample=r.loadStart;
  for(let k=0;k<r.contract.rounds;k++){
   const window=slot(r.contract,r.loadStart,k);g.betweenRounds();await waitUntil(window.startMs);await sample();
   await g.check();g.beginRound(window.deadlineMs);r.currentRound=k;const s=r.sessions[window.index],startedAt=r.now();
   await r.event('arm_round_start',{round:k,index:window.index,scheduledAt:window.startMs,deadline:window.deadlineMs,startedAt,binding:{session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream}});
   if(r.contract.arm==='A')await (overrides.performStaticRound??performStaticRound)(r,k);
   else await (overrides.performRound??performRound)(r,k,window.index);
   await g.check();await r.event('arm_round_end',{round:k,index:window.index,startedAt,deadline:window.deadlineMs,finishedAt:r.now()});await g.check();r.summary.completedRounds++;
  }
  g.betweenRounds();g.beginTail();await r.event('measurement_tail',{deadline:g.deadline});await waitUntil(r.loadStart+r.contract.seconds*1000);
  // The final service may finish just beyond the boundary. Freeze has its own
  // bounded grace, which cannot authorize a late round or further tool input.
  g.beginFreeze();await g.check();await r.freeze();await g.check();
  r.summary.rates=r.outputRates();for(const rate of r.summary.rates)assert.ok(rate.bytesPerSecond>=1024,'output_rate');
  r.summary.workloadPassed=true;r.summary.stopReason=null;
 }catch(e){failure=e;r.summary.stopReason=String(e);await r.event('arm_stopped',{reason:String(e),completedRounds:r.summary.completedRounds});}
 finally{
  for(const [name,original] of originals)r[name]=original;
  g.check=check;g.finish();
  for(const [name,operation] of [['freeze',async()=>{if(r.loadStart!==undefined&&!r.measurementFrozen)await r.freeze();}],['cdpClose',async()=>{await r.cdp?.close();}],['audit',()=>r.verifyAudits()]]){
   try{await operation();}catch(e){r.summary[name+'Failure']=String(e);failure??=e;}
  }
  if(r.cdp?.disconnection)failure??=Error(r.cdp.disconnection);
  if(failure){r.summary.workloadPassed=false;try{await observeFailureState(r);}catch(e){r.summary.failureObservationError=String(e);}}
  await r.save();
 }
 if(failure)throw failure;
}
