import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,link,unlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {selectedGeometry,remoteGeometry,verifyTransition} from './transitions.mjs';
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function exclusive(path,value){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{flag:'wx'});try{await link(tmp,path);}finally{await unlink(tmp);}}
export class NativeCasesMailbox {
 constructor(dir,owner,clock=()=>performance.now()){Object.assign(this,{dir,owner,clock});this.active=null;this.response=null;}
 async init(){for(const name of ['requests','starts','responses','results'])await mkdir(join(this.dir,name),{recursive:true});assert.equal(await this.read(),null,'pending_exists');}
 read(){return read(join(this.dir,'pending.json'));}
 async issue(action,runDeadline){
  assert.equal(this.active,null,'action_pending');assert.ok(this.clock()<runDeadline,'run_expired');
  this.active={...action,id:randomUUID(),owner:this.owner,issuedAt:this.clock(),expiresAt:runDeadline};this.response=null;
  await exclusive(join(this.dir,'requests',this.active.id+'.json'),this.active);await exclusive(join(this.dir,'pending.json'),this.active);return this.active;
 }
 check(){assert.ok(this.active,'no_action');assert.ok(this.clock()<=this.active.expiresAt,'run_expired');if(this.active.verifyDeadline!==undefined)assert.ok(this.clock()<=this.active.verifyDeadline,'input_expired');}
 async beginInput(id){
  this.check();assert.equal(id,this.active.id,'request_id');assert.equal(this.active.inputStartedAt,undefined,'duplicate_start');
  this.active.inputStartedAt=this.clock();this.active.verifyDeadline=Math.min(this.active.inputStartedAt+45000,this.active.expiresAt);
  const tmp=join(this.dir,'active.tmp');await writeFile(tmp,JSON.stringify(this.active));await rename(tmp,join(this.dir,'active.json'));return this.active;
 }
 async accept(response){
  this.check();assert.ok(this.active.inputStartedAt!==undefined,'input_not_started');assert.equal(this.response,null,'duplicate_response');assert.equal(response.id,this.active.id,'request_id');assert.equal(response.owner,this.owner,'response_owner');assert.equal(response.status,'performed','native_action_failed');
  const o=response.observation;assert.ok(o&&typeof o.screenshotId==='string'&&o.screenshotId.length,'capture_required');
  if(this.active.action==='select')assert.equal(o.selectedSession,this.active.session,'selected_session');
  if(this.active.action==='choose_connection')assert.equal(o.targetConnection,this.active.targetConnection,'target_connection');
  if(['window_mode','resize'].includes(this.active.action))assert.equal(o.windowMode,this.active.windowMode,'window_mode');
  this.response=response;
 }
 async finish(observation){
  this.check();assert.ok(this.response,'response_required');assert.equal(observation.verified,true,'observation_unverified');
  const result={request:{...this.active},response:this.response,observation,verifiedAt:this.clock()};await exclusive(join(this.dir,'results',this.active.id+'.json'),result);
  await unlink(join(this.dir,'pending.json'));await unlink(join(this.dir,'active.json'));this.active=null;this.response=null;return result;
 }
 async poll(onStart=async()=>{}){
  this.check();if(this.active.inputStartedAt===undefined){const start=await read(join(this.dir,'starts',this.active.id+'.json'));if(start){assert.equal(start.owner,this.owner,'start_owner');assert.equal(start.id,this.active.id,'start_id');await onStart();await this.beginInput(start.id);}}
  if(!this.response){const response=await read(join(this.dir,'responses',this.active.id+'.json'));if(response)await this.accept(response);}return this.response;
 }
}
export async function publishNative(dir,action,id,observation){
 assert.ok(['start','done','failed'].includes(action),'native_action');const request=await read(join(dir,'pending.json'));assert.ok(request&&request.id===id,'request_id');
 if(action==='start'){await exclusive(join(dir,'starts',id+'.json'),{id,owner:request.owner});return {id,status:'start_requested'};}
 const active=await read(join(dir,'active.json'));assert.ok(active?.id===id&&active.owner===request.owner,'input_not_started');
 await exclusive(join(dir,'responses',id+'.json'),{id,owner:request.owner,status:action==='done'?'performed':'failed',observation});return {id,status:'receipt_recorded'};
}
export async function runNative(r,mailbox){
 await mailbox.init();await r.disconnectBrowser();await r.startMeasurement();const runDeadline=r.born+900000;let nextSample=0;
 async function action(request,verify,onStart){
  await mailbox.issue({...request,appExecutable:r.summary.binaries.app.path},runDeadline);
  while(true){await r.service();if(r.elapsed()>=nextSample){await r.sampleMemory();nextSample=r.elapsed()+30;}const response=await mailbox.poll(onStart);
   if(response){const observation=await verify(response.observation);if(observation){const result=await mailbox.finish({verified:true,...observation});await r.event('native',result);return observation;}}
   await r.sleep(100);
  }
 }
 try{
  for(let round=0;round<2;round++){
   const s=r.sessions[round],windowMode=round===0?'restored':'maximized';
   await action({action:'window_mode',round,windowMode:'restored'},async o=>({windowMode:o.windowMode}));
   const before={session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream};
   const selected=await action({action:'select',round,session:s.id,label:`soak-${String(s.index).padStart(2,'0')}`},async()=>selectedGeometry(r,s,r.now()));
   const resized=await action({action:'resize',round,session:s.id,windowMode,previousGeometry:selected.geometry},async()=>{const p=await r.sessionStatus(s);return p.geometry.rows!==selected.geometry.rows||p.geometry.columns!==selected.geometry.columns?{geometry:p.geometry,observedAt:r.now(),windowMode}:false;});
   const remote=await remoteGeometry(r,s,round,resized.geometry);
   const reclaimed=await action({action:'reclaim',round,session:s.id},async()=>{const p=await r.sessionStatus(s);return p.state==='user_owned'?p:false;},()=>r.setTransition(s,'reclaiming'));await r.setTransition(s,'reclaimed');
   const adapter=(before.adapter+16)%32,targetConnection=r.connections[adapter];
   await action({action:'choose_connection',round,session:s.id,targetConnection},async o=>({targetConnection:o.targetConnection}));
   const assigned=await action({action:'handoff',round,session:s.id,targetConnection},async()=>{const p=await r.status(adapter),s0=p.sessions.find(p=>p.session_id===s.id);return s0?.state==='agent_owned'?{connection_id:p.connection_id,session:s0}:false;});
   const record={round,index:s.index,before,selected,resized,remote,reclaimed,assigned,oldOwner:await r.status(before.adapter),targetConnection,adapter,windowMode};verifyTransition(record);await r.event('transition',record);await r.adoptBinding(s,{adapter,epoch:assigned.session.control_epoch,stream:assigned.session.stream_id});await r.audit(round);await r.health();
  }
 }finally{await r.freeze();}
 await r.verifyAudits();r.summary.normalWorkloadPassed=true;r.summary.completedCases=2;return {workloadPassed:true,cases:2};
}
