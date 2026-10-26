import assert from 'node:assert/strict';
import {get} from 'node:http';
import {roundWindow,nextStart} from '../native-cadence/policy.mjs';
import {selectedGeometry,remoteGeometry,verifyTransition} from '../separated/transitions.mjs';
import {connectCdp,selectOwnedTarget,evaluateParams} from './cdp.mjs';
import {readDebugger,validateDebugger} from './sampling.mjs';
export const CONTRACT=Object.freeze({scope:'CC',profile:'diagnostic',seconds:900,rounds:0,maxRounds:3,sessionOrder:Object.freeze([0,1,0]),periodMs:60000});
export async function discoverTarget(r){
 // No pooled discovery socket can contaminate the established-count samples.
 const rows=await new Promise((resolve,reject)=>{
  const req=get({hostname:'127.0.0.1',port:r.port,path:'/json/list',agent:false,headers:{Connection:'close'}},res=>{
   let text='';if(res.statusCode!==200){res.resume();reject(Error('cdp_discovery_status'));return;}
   res.setEncoding('utf8');res.on('data',chunk=>{text+=chunk;if(text.length>65536)req.destroy(Error('cdp_discovery_size'));});res.on('error',reject);res.on('end',()=>{try{resolve(JSON.parse(text));}catch(e){reject(e);}});
  });req.setTimeout(Math.max(1,Math.min(15000,r.cadenceGuard.deadline-r.now())),()=>req.destroy(Error('cdp_discovery_timeout')));req.on('error',reject);
 });return selectOwnedTarget(rows,r.port);
}
export async function prepareCdp(r,connect=connectCdp){
 await r.disconnectBrowser();const receipt=await r.receipt(),ownership={...receipt,descendants:receipt.descendants.filter(p=>!p.exited)};
 const before=await readDebugger(r);validateDebugger(before,ownership,r.port,0);await r.event('cdp_endpoint',{debugPort:before,ownership});
 const target=await discoverTarget(r);await r.cadenceGuard.check();r.summary.cdpTarget=target;
 r.cdp=await connect({target,deadline:Math.min(r.cadenceGuard.deadline,r.now()+15000),now:r.now,record:async row=>{
  const v=await r.event('cdp',{...row,round:r.currentRound??-1});await r.append('cdp.jsonl',v);
  const i=r.summary.instrumentation;if(row.kind==='open')i.rawCdpSessions++;if(row.kind==='request'&&row.method==='Runtime.evaluate'){i.evaluateCalls++;if(row.action==='identity')i.domQueries++;else i.domActions++;}
 }});
 await r.cdp.send('Network.disable',{},Math.min(r.cadenceGuard.deadline,r.now()+15000));
 await ui(r,'identity',{sessionId:r.sessions.at(-1).id},-1);await r.cadenceGuard.check();
}
export async function ui(r,action,args,round){
 await r.cadenceGuard.check();const deadline=Math.min(r.cadenceGuard.deadline,r.now()+15000),params=evaluateParams(action,args,Math.max(1,deadline-r.now()));
 // A small margin avoids a local clock tick making CDP's execution timeout
 // longer than the remaining host timeout before the send is serialized.
 params.timeout=Math.max(0.001,params.timeout-10);
 const raw=await r.during(()=>r.cdp.send('Runtime.evaluate',params,deadline));await r.cadenceGuard.check();
 const value=raw.result?.value;assert.equal(value?.sessionId,args.sessionId,'ui_session');
 if(args.connectionId)assert.equal(value.connectionId,args.connectionId,'ui_connection');if(action==='resize')assert.equal(value.width,args.width,'ui_width');
 await r.event('cdp_action',{action,args,result:value,round});return value;
}
export async function performRound(r,round,index){
 const s=r.sessions[index],before={session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream};
 await ui(r,'select',{sessionId:s.id,label:`soak-${String(index).padStart(2,'0')}`},round);await ui(r,'identity',{sessionId:s.id},round);
 const selected=await selectedGeometry(r,s,r.now());await r.event('selected',{round,...selected});
 const width=selected.geometry.columns>=90?720:1000;await ui(r,'resize',{sessionId:s.id,width},round);
 const resized=await r.waitFor(async()=>{const p=await r.sessionStatus(s);return p.geometry.rows!==selected.geometry.rows||p.geometry.columns!==selected.geometry.columns?{geometry:p.geometry,observedAt:r.now()}:false;},'resized');
 const remote=await remoteGeometry(r,s,round,resized.geometry);
 await r.setTransition(s,'reclaiming');await ui(r,'reclaim',{sessionId:s.id},round);
 const reclaimed=await r.waitFor(async()=>{const p=await r.sessionStatus(s);return p.state==='user_owned'?p:false;},'reclaimed');await r.setTransition(s,'reclaimed');
 const adapter=(before.adapter+16)%32,targetConnection=r.connections[adapter];
 await ui(r,'choose_connection',{sessionId:s.id,connectionId:targetConnection},round);await ui(r,'handoff',{sessionId:s.id,connectionId:targetConnection},round);
 const assigned=await r.waitFor(async()=>{const p=await r.status(adapter),session=p.sessions.find(v=>v.session_id===s.id);return session?.state==='agent_owned'?{connection_id:p.connection_id,session}:false;},'assigned');
 const record={round,index,before,selected,resized,remote,reclaimed,assigned,oldOwner:await r.status(before.adapter),targetConnection,adapter,width};verifyTransition(record);
 await r.adoptBinding(s,{adapter,epoch:assigned.session.control_epoch,stream:assigned.session.stream_id});await r.cadenceGuard.check();await r.event('transition',record);await r.audit(round);await r.health();
}
export async function runCdpCadence(r,overrides={}){
 const g=r.cadenceGuard,originals=new Map();let nextSample=0,sampling=false,previousStartedAt,failure;
 Object.assign(r.summary,{completedRounds:0,cadenceObserved:false,longRunReadiness:'unproven',memoryAcceptance:'not_evaluated'});
 const sample=async()=>{if(sampling||r.loadStart===undefined||r.measurementFrozen||r.elapsed()<nextSample)return;sampling=true;try{await g.check();await r.sampleMemory();nextSample=r.elapsed()+30;}finally{sampling=false;}};
 for(const name of ['service','tool'])if(r[name]){const original=r[name];originals.set(name,original);r[name]=async(...args)=>{const value=await original.apply(r,args);await sample();return value;};}
 try{
  await (overrides.prepare??prepareCdp)(r,overrides.connectCdp);await g.check();await r.startMeasurement();await sample();
  for(let round=0;round<3;round++){
   g.betweenRounds();while(previousStartedAt!==undefined&&r.now()<nextStart(previousStartedAt)){await r.checkStop();await r.service();await r.sleep(Math.min(100,nextStart(previousStartedAt)-r.now()));}
   await g.check();const startedAt=r.now(),window=roundWindow({round,startedAt,previousStartedAt,runDeadline:g.globalDeadline}),s=r.sessions[window.index];g.beginRound(window.deadline);r.currentRound=round;
   await r.event('cadence_round_start',{round,...window,previousStartedAt,binding:{session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream}});
   await (overrides.performRound??performRound)(r,round,window.index);await g.check();await r.event('cadence_round_end',{round,index:window.index,startedAt,deadline:window.deadline,finishedAt:r.now()});await g.check();r.summary.completedRounds++;previousStartedAt=startedAt;
  }
  r.summary.rates=r.outputRates();for(const rate of r.summary.rates)assert.ok(rate.bytesPerSecond>=1024,'output_rate');r.summary.cadenceObserved=true;r.summary.stopReason=null;
 }catch(e){failure=e;r.summary.stopReason=String(e);await r.event('cadence_stopped',{reason:String(e),completedRounds:r.summary.completedRounds});}
 finally{
  for(const [name,original] of originals)r[name]=original;
  g.finish();
  for(const [key,op] of [['freeze',async()=>{if(r.loadStart!==undefined&&!r.measurementFrozen)await r.freeze();}],['cdpClose',async()=>{await r.cdp?.close();}],['audit',()=>r.verifyAudits()]])try{await op();}catch(e){r.summary[key+'Failure']=String(e);failure??=e;}
  await r.save();
 }
 if(failure)throw failure;return {completedRounds:r.summary.completedRounds,cadenceObserved:r.summary.cadenceObserved};
}
