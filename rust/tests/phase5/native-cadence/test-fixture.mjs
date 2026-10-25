import {memoryEvidence,transitionFixture} from '../separated/test-fixture.mjs';
import {CADENCE} from './policy.mjs';

export function cadenceEvidence(timeout=false){
 const e=memoryEvidence(),s=e.summary;Object.assign(s,{scope:'NC',profile:'diagnostic',contract:CADENCE,clockOrigin:0,nativeTimingVersion:2,nativeResponseLatency:'not_measured',completedRounds:timeout?0:3,cadenceObserved:!timeout,longRunReadiness:'unproven',memoryAcceptance:'not_evaluated',phase5Acceptance:false});
 e.events=[];e.nativeFiles={requests:[],starts:[],responses:[],acceptances:[],results:[]};
 const emit=(type,t,detail={})=>{const row={type,t,scope:'NC',owner:s.owner,...structuredClone(detail)};e.events.push(row);return row;};
 const bindings=s.sessions.map(v=>({...v}));e.audits=bindings.map(v=>({index:v.index,session:v.id,actual:[]}));
 const status=index=>({app_state:'online',connection_id:s.connections[index],sessions:bindings.filter(v=>v.adapter===index).map(v=>({session_id:v.id,state:'agent_owned',control_epoch:v.epoch,stream_id:v.stream,geometry:{rows:32,columns:120}}))});
 const raw=(t,index,response)=>emit('mcp',t,{index,name:'status',args:{},response});
 function native(action,round,t,observed,extra={},states=[]){
  const id=`${round}-${action}`,q={id,owner:s.owner,action,round,timingVersion:2,issuedAt:t,expiresAt:round<0?900000:1000+round*60000+60000,appExecutable:'app.exe',...extra};
  const accepted={id,owner:s.owner,responseReceivedAt:t+20,verifyDeadline:Math.min(t+45020,q.expiresAt)};
  const request={...q,inputStartedAt:t+10,inputDeadline:Math.min(t+120010,q.expiresAt),...{responseReceivedAt:accepted.responseReceivedAt,verifyDeadline:accepted.verifyDeadline}};
  const response={id,owner:s.owner,status:'performed',observation:{screenshotId:id,selectedSession:q.session,targetConnection:q.targetConnection,windowMode:q.windowMode}};
  const verifiedAt=action==='select'?t+900:t+100;
  const result={request,response,observation:{verified:true,...observed},verifiedAt};
  e.nativeFiles.requests.push(q);e.nativeFiles.starts.push({id,owner:s.owner});e.nativeFiles.responses.push(response);e.nativeFiles.acceptances.push(accepted);e.nativeFiles.results.push(result);
  emit('native_request',t,{request:q});emit('native_received',t+20,accepted);for(const [offset,index,p] of states)raw(t+offset,index,p);emit('native',verifiedAt,result);
 }
 emit('browser_disconnected',10);for(const v of bindings)emit('session_ready',20,{...v});
 native('window_mode',-1,100,{windowMode:'restored'},{windowMode:'restored'});emit('measurement_start',1000);
 for(let round=0;round<(timeout?1:3);round++){
  const start=1000+round*60000,index=[0,1,0][round],b=bindings[index];
  emit('cadence_round_start',start,{round,index,startedAt:start,deadline:start+60000,...(round?{previousStartedAt:start-60000}:{}),binding:{session:b.id,adapter:b.adapter,epoch:b.epoch,stream:b.stream}});
  if(timeout)break;
  const r=transitionFixture(round===2?16:round);r.round=round;r.index=index;r.before={session:b.id,adapter:b.adapter,epoch:b.epoch,stream:b.stream};r.windowMode=round%2?'restored':'maximized';
  r.selected={session:b.id,geometry:{rows:32,columns:120},selectedAt:start+130,stableAt:start+930};r.resized={geometry:{rows:40,columns:140},observedAt:start+1230,windowMode:r.windowMode};
  native('select',round,start+100,r.selected,{session:b.id},[[30,b.adapter,status(b.adapter)],[830,b.adapter,status(b.adapter)]]);
  const resized=status(b.adapter);resized.sessions.find(v=>v.session_id===b.id).geometry=r.resized.geometry;
  native('resize',round,start+1200,r.resized,{session:b.id,windowMode:r.windowMode},[[30,b.adapter,resized]]);
  emit('remote_geometry',start+1400,{session:b.id,round,geometry:r.resized.geometry,remote:r.remote});
  emit('transition_boundary',start+1510,{session:b.id,stage:'reclaiming',epoch:b.epoch,stream:b.stream,cursor:0});
  native('reclaim',round,start+1500,r.reclaimed,{session:b.id},[[30,b.adapter,{app_state:'online',connection_id:'c'+b.adapter,sessions:[r.reclaimed]}]]);
  emit('transition_boundary',start+1610,{session:b.id,stage:'reclaimed',epoch:b.epoch,stream:b.stream,cursor:0});
  native('choose_connection',round,start+1700,{targetConnection:r.targetConnection},{session:b.id,targetConnection:r.targetConnection});
  native('handoff',round,start+1900,r.assigned,{session:b.id,targetConnection:r.targetConnection},[[30,r.adapter,{app_state:'online',connection_id:r.targetConnection,sessions:[r.assigned.session]}]]);
  raw(start+2010,b.adapter,{app_state:'online',...r.oldOwner});
  emit('binding',start+2020,{session:b.id,before:{adapter:b.adapter,epoch:b.epoch,stream:b.stream,cursor:0},after:{adapter:r.adapter,epoch:r.assigned.session.control_epoch,stream:r.assigned.session.stream_id}});
  Object.assign(b,{adapter:r.adapter,epoch:r.assigned.session.control_epoch,stream:r.assigned.session.stream_id});emit('transition',start+2500,r);
  for(const a of e.audits){
   const args={session_id:a.session,control_epoch:bindings[a.index].epoch,request_id:`audit-${round}-${a.index}`,text:`printf '%s\\n' 'AUDIT_${a.index}_${round}' >> /tmp/soak-audit-${a.index}`};
   for(let dup=0;dup<2;dup++)emit('mcp',start+3000,{index:bindings[a.index].adapter,name:'send_text',args,response:{result:'delivered'}});
   emit('mcp',start+3100,{index:bindings[a.index].adapter,name:'send_key',args:{session_id:a.session,control_epoch:bindings[a.index].epoch,request_id:`enter-${round}-${a.index}`,key:'Enter'},response:{result:'delivered'}});a.actual.push(`AUDIT_${a.index}_${round}`);
  }
  emit('audit',start+4000,{round});const values=s.connections.map((_,i)=>status(i));values.forEach((p,i)=>raw(start+4100,i,p));emit('health',start+4200,{values});
  emit('cadence_round_end',start+10000,{round,index,startedAt:start,deadline:start+60000,finishedAt:start+10000});
 }
 const end=timeout?61001:131000;
 if(timeout){s.status='failed';s.failure='Error: round_deadline';s.stopReason=s.failure;emit('cadence_deadline',end,{observedAt:end,deadline:61000,reason:'round_deadline'});emit('cadence_stopped',end,{reason:s.failure,completedRounds:0});}
 else s.stopReason=null;
 emit('measurement_end',end);emit('shutdown',end+100,{process:e.process,exit:{code:0},eofs:s.connections.map((_,index)=>({index,code:0,stderr:''}))});
 e.events.sort((a,b)=>a.t-b.t);e.events.forEach((v,i)=>v.seq=i+1);s.sessions=bindings;s.elapsedSeconds=(end-1000)/1000;
 e.memory=e.summary.samples=e.memory.filter(v=>v.elapsed<s.elapsedSeconds);e.boundary={eventSeq:e.events.find(v=>v.type==='measurement_end').seq,elapsedSeconds:s.elapsedSeconds,samples:e.memory.length};e.output=[];
 for(const b of bindings){let stream=null,cursor=0;for(let second=0;second<Math.floor(s.elapsedSeconds);second++){
  const t=1000+second*1000+999,binding=e.events.filter(v=>v.type==='binding'&&v.session===b.id&&v.t<=t).at(-1)?.after??e.events.find(v=>v.type==='session_ready'&&v.id===b.id);
  if(binding.stream!==stream){stream=binding.stream;cursor=0;}
  e.output.push({t,phase:'normal',session:b.id,index:b.index,epoch:binding.epoch,stream,cursor:cursor++,response:{next_cursor:cursor,oldest_cursor:0,text:`SOAK:${b.index}:${String(second+1).padStart(8,'0')}:${'x'.repeat(1008)}\n`}});
 }}
 return e;
}
