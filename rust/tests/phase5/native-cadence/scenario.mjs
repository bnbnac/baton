import {unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {CADENCE,nextStart,roundWindow} from './policy.mjs';
import {selectedGeometry,remoteGeometry,verifyTransition} from '../separated/transitions.mjs';

export async function retireMailbox(r,mailbox){
 if(!mailbox?.active)return;
 await r.event('native_abandoned',{request:{...mailbox.active},response:mailbox.response,observedAt:r.now()});
 for(const name of ['pending.json','active.json'])try{await unlink(join(mailbox.dir,name));}catch(e){if(e.code!=='ENOENT')throw e;}
 mailbox.active=null;mailbox.response=null;
}

export async function runCadence(r,mailbox,overrides={}){
 const g=r.cadenceGuard;let nextSample=0,previousStartedAt,sampling=false;
 r.summary.completedRounds=0;r.summary.nativeTimingVersion=2;r.summary.nativeResponseLatency='not_measured';
 r.summary.longRunReadiness='unproven';r.summary.memoryAcceptance='not_evaluated';r.summary.cadenceObserved=false;
 const sampleIfDue=async()=>{
  if(sampling||r.loadStart===undefined||r.measurementFrozen||r.elapsed()<nextSample)return;
  sampling=true;try{await g.check();await r.sampleMemory();nextSample=r.elapsed()+30;}finally{sampling=false;}
 };
 // Nested geometry waits and audit/health RPC loops need the same sampler as
 // mailbox polling. Sampling never starts another service or sample recursively.
 const originals=new Map();for(const name of ['service','tool'])if(r[name]){
  const original=r[name];originals.set(name,original);r[name]=async(...args)=>{const value=await original.apply(r,args);await sampleIfDue();return value;};
 }
 const tick=async()=>{await r.checkStop();await r.service();await sampleIfDue();await g.check();};
 async function action(request,verify,onStart){
  await g.check();await mailbox.issue({...request,appExecutable:r.summary.binaries.app.path},g.deadline);
  await r.event('native_request',{request:{...mailbox.active}});let received=false;
  while(true){
   await tick();const response=await mailbox.poll(onStart);await g.check();
   if(response){
    if(!received){const {id,responseReceivedAt,verifyDeadline}=mailbox.active;await r.event('native_received',{id,responseReceivedAt,verifyDeadline});received=true;}
    mailbox.check();const observation=await verify(response.observation);await g.check();
    if(observation){const result=await mailbox.finish({verified:true,...observation});await g.check();await r.event('native',result);return observation;}
   }
   await r.sleep(100);await g.check();
  }
 }
 const prepare=overrides.prepare??(async()=>{
  await mailbox.init();await action({action:'window_mode',round:-1,windowMode:'restored'},async o=>({windowMode:o.windowMode}));
 });
 const performRound=overrides.performRound??(async(_runtime,round,index)=>{
  const s=r.sessions[index],before={session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream},windowMode=round%2===0?'maximized':'restored';
  const selected=await action({action:'select',round,session:s.id,label:`soak-${String(index).padStart(2,'0')}`},()=>selectedGeometry(r,s,r.now()));
  const resized=await action({action:'resize',round,session:s.id,windowMode,previousGeometry:selected.geometry},async()=>{
   const p=await r.sessionStatus(s);return p.geometry.rows!==selected.geometry.rows||p.geometry.columns!==selected.geometry.columns?{geometry:p.geometry,observedAt:r.now(),windowMode}:false;
  });
  const remote=await remoteGeometry(r,s,round,resized.geometry);
  const reclaimed=await action({action:'reclaim',round,session:s.id},async()=>{const p=await r.sessionStatus(s);return p.state==='user_owned'?p:false;},()=>r.setTransition(s,'reclaiming'));
  await r.setTransition(s,'reclaimed');const adapter=(before.adapter+16)%32,targetConnection=r.connections[adapter];
  await action({action:'choose_connection',round,session:s.id,targetConnection},async o=>({targetConnection:o.targetConnection}));
  const assigned=await action({action:'handoff',round,session:s.id,targetConnection},async()=>{const p=await r.status(adapter),session=p.sessions.find(v=>v.session_id===s.id);return session?.state==='agent_owned'?{connection_id:p.connection_id,session}:false;});
  const record={round,index,before,selected,resized,remote,reclaimed,assigned,oldOwner:await r.status(before.adapter),targetConnection,adapter,windowMode};
  verifyTransition(record);await r.adoptBinding(s,{adapter,epoch:assigned.session.control_epoch,stream:assigned.session.stream_id});await g.check();
  await r.event('transition',record);await r.audit(round);await r.health();
 });
 try{
  await r.disconnectBrowser();await prepare();await g.check();await r.startMeasurement();await sampleIfDue();
  for(let round=0;round<CADENCE.maxRounds;round++){
   g.betweenRounds();while(previousStartedAt!==undefined&&r.now()<nextStart(previousStartedAt)){await tick();await r.sleep(Math.min(100,Math.max(0,nextStart(previousStartedAt)-r.now())));}
   await g.check();const startedAt=r.now(),window=roundWindow({round,startedAt,previousStartedAt,runDeadline:g.globalDeadline}),s=r.sessions[window.index];g.beginRound(window.deadline);
   await r.event('cadence_round_start',{round,...window,previousStartedAt,binding:{session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream}});
   await performRound(r,round,window.index);await g.check();
   await r.event('cadence_round_end',{round,index:window.index,startedAt,finishedAt:r.now(),deadline:window.deadline});await g.check();
   r.summary.completedRounds++;previousStartedAt=startedAt;
  }
  r.summary.cadenceObserved=true;r.summary.stopReason=null;
 }catch(e){r.summary.stopReason=String(e);await r.event('cadence_stopped',{reason:String(e),completedRounds:r.summary.completedRounds});throw e;}
 finally{
  // Revoke UI permission before releasing limits for fixture-only audit capture
  // and normal shutdown. No terminal input is sent after the failed deadline.
  try{await (overrides.retire??retireMailbox)(r,mailbox);}finally{
   for(const [name,original] of originals)r[name]=original;
   g.finish();if(r.loadStart!==undefined)await r.freeze();
   try{await r.verifyAudits();}catch(e){r.summary.auditFailure=String(e);}
   await r.save();
  }
 }
 return {completedRounds:r.summary.completedRounds,cadenceObserved:r.summary.cadenceObserved,stopReason:r.summary.stopReason};
}
