import {memoryEvidence} from '../separated/test-fixture.mjs';
import {resolveArm} from './policy.mjs';
import {digest} from '../minimal-cdp-cadence/cdp.mjs';
import {domExpression} from '../minimal-cdp-cadence/dom.mjs';

export function resequence(e){
 e.events.sort((a,b)=>a.t-b.t);e.events.forEach((v,i)=>{v.seq=i+1;});
 e.boundary.eventSeq=e.events.find(v=>v.type==='measurement_end').seq;
 e.cdp=structuredClone(e.events.filter(v=>v.type==='cdp'));
}
export function armEvidence(arm='A',profile='preflight',negative=false){
 const e=memoryEvidence(),s=e.summary,c=resolveArm(arm,profile),start=1000,duration=negative?60.001:c.seconds,end=start+duration*1000;
 const bindings=s.sessions.map(v=>({...v})),geometries=bindings.map(()=>({columns:120,rows:32}));
 Object.assign(s,{scope:'AM',arm,profile,contract:c,clockOrigin:0,debugPort:9222,completedRounds:negative?0:c.rounds,workloadPassed:!negative,memoryPassed:null,phase5Acceptance:false,elapsedSeconds:duration,status:negative?'failed':'finished',stopReason:negative?'Error: round_deadline':null});
 e.events=[];e.audits=bindings.map(v=>({index:v.index,session:v.id,actual:[]}));
 const emit=(type,t,detail={})=>{const row={type,t,scope:'AM',owner:s.owner,...structuredClone(detail)};e.events.push(row);return row;};
 const trace=(kind,t,detail)=>emit('cdp',t,{kind,at:t,...detail});
 const session=b=>({session_id:b.id,state:'agent_owned',control_epoch:b.epoch,stream_id:b.stream,geometry:geometries[b.index]});
 const status=index=>({app_state:'online',connection_id:s.connections[index],sessions:bindings.filter(b=>b.adapter===index).map(session)});
 const raw=(t,index,response)=>emit('mcp',t,{index,name:'status',args:{},response});
 const initial=bindings.map(b=>({index:b.index,adapter:b.adapter,session:structuredClone(session(b))}));s.initialState=initial;
 const target={id:'page',type:'page',url:'http://tauri.localhost/',webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/page/page'};s.cdpTarget=target;
 let requestId=0;
 function command(action,args,round,t){
  const id=++requestId,deadline=round<0?15000:start+(round+1)*60000,method=action?'Runtime.evaluate':'Network.disable';
  trace('request',t,{id,round,method,deadline,...(action?{action,args,timeout:500,expressionSha256:digest(domExpression(action,args))}:{})});
  trace('dispatch',t,{id,round,...(action?{timeout:500}:{})});
  const value={sessionId:args?.sessionId,...(args?.connectionId?{connectionId:args.connectionId}:{}),...(action==='resize'?{width:args.width}:{})};
  trace('response',t+1,{id,round,result:action?{result:{value}}:{}});if(action)emit('cdp_action',t+2,{round,action,args,result:value});
 }
 for(const b of bindings)emit('session_ready',20,{...b});
 emit('normalized_view',900,{viewport:{width:1280,height:900},workspaceWidth:1000,session:'s0',geometry:geometries[0],selectedAt:100,stableAt:850});
 emit('browser_disconnected',910);trace('open',930,{round:-1,target});command(null,null,-1,940);command('identity',{sessionId:'s0'},-1,950);
 initial.forEach(b=>raw(960,b.adapter,status(b.adapter)));emit('initial_state',970,{sessions:initial});emit('measurement_start',start);
 let width=1000;
 for(let k=0;k<(negative?1:c.rounds);k++){
  const base=start+k*60000,index=arm==='A'?0:k%16,b=bindings[index];
  emit('arm_round_start',base,{round:k,index,scheduledAt:base,deadline:base+60000,startedAt:base,binding:{session:b.id,adapter:b.adapter,epoch:b.epoch,stream:b.stream}});
  if(negative)break;
  if(arm==='A')for(let n=0;n<6;n++)command('identity',{sessionId:'s0'},k,base+100+n*10);
  else{
   const before={session:b.id,adapter:b.adapter,epoch:b.epoch,stream:b.stream};
   geometries[index]={rows:32,columns:width===1000?120:80};
   const selected={session:b.id,geometry:structuredClone(geometries[index]),selectedAt:base+130,stableAt:base+930};
   command('select',{sessionId:b.id,label:`soak-${String(index).padStart(2,'0')}`},k,base+100);command('identity',{sessionId:b.id},k,base+110);
   raw(base+130,b.adapter,status(b.adapter));raw(base+930,b.adapter,status(b.adapter));emit('selected',base+940,{round:k,...selected});
   width=width===1000?720:1000;command('resize',{sessionId:b.id,width},k,base+1200);geometries[index]={rows:32,columns:width===1000?120:80};
   const resized={geometry:structuredClone(geometries[index]),observedAt:base+1230},remote=`32 ${geometries[index].columns}`;
   raw(base+1230,b.adapter,status(b.adapter));
   emit('mcp',base+1300,{index:b.adapter,name:'send_text',args:{session_id:b.id,control_epoch:b.epoch,request_id:`stty-${k}`,text:`stty size > /tmp/separated-size-${index}-${k}`},response:{result:'delivered'}});
   emit('mcp',base+1310,{index:b.adapter,name:'send_key',args:{session_id:b.id,control_epoch:b.epoch,request_id:`stty-enter-${k}`,key:'Enter'},response:{result:'delivered'}});
   emit('remote_geometry',base+1400,{session:b.id,round:k,geometry:resized.geometry,remote});
   emit('transition_boundary',base+1450,{session:b.id,stage:'reclaiming',epoch:b.epoch,stream:b.stream,cursor:0});command('reclaim',{sessionId:b.id},k,base+1500);
   const reclaimed={session_id:b.id,state:'user_owned',control_epoch:b.epoch+1,stream_id:null};raw(base+1530,b.adapter,{app_state:'online',connection_id:s.connections[b.adapter],sessions:[reclaimed]});
   emit('transition_boundary',base+1610,{session:b.id,stage:'reclaimed',epoch:b.epoch,stream:b.stream,cursor:0});
   const adapter=(b.adapter+16)%32,targetConnection=s.connections[adapter];command('choose_connection',{sessionId:b.id,connectionId:targetConnection},k,base+1700);command('handoff',{sessionId:b.id,connectionId:targetConnection},k,base+1900);
   const assigned={connection_id:targetConnection,session:{...session(b),control_epoch:b.epoch+2,stream_id:`next-${index}-${k}`}},oldOwner={connection_id:s.connections[b.adapter],sessions:[]};
   raw(base+1930,adapter,{app_state:'online',connection_id:targetConnection,sessions:[assigned.session]});raw(base+2010,b.adapter,{app_state:'online',...oldOwner});
   const after={adapter,epoch:assigned.session.control_epoch,stream:assigned.session.stream_id};emit('binding',base+2020,{session:b.id,before:{adapter:b.adapter,epoch:b.epoch,stream:b.stream,cursor:0},after});Object.assign(b,after);
   emit('transition',base+2500,{round:k,index,before,selected,resized,remote,reclaimed,assigned,oldOwner,targetConnection,adapter,width});
  }
  for(const a of e.audits){
   const args={session_id:a.session,control_epoch:bindings[a.index].epoch,request_id:`audit-${k}-${a.index}`,text:`printf '%s\\n' 'AUDIT_${a.index}_${k}' >> /tmp/soak-audit-${a.index}`};
   for(let n=0;n<2;n++)emit('mcp',base+3000,{index:bindings[a.index].adapter,name:'send_text',args,response:{result:'delivered'}});
   emit('mcp',base+3100,{index:bindings[a.index].adapter,name:'send_key',args:{session_id:a.session,control_epoch:bindings[a.index].epoch,request_id:`enter-${k}-${a.index}`,key:'Enter'},response:{result:'delivered'}});a.actual.push(`AUDIT_${a.index}_${k}`);
  }
  emit('audit',base+4000,{round:k});const values=s.connections.map((_,i)=>status(i));values.forEach((p,i)=>raw(base+4100,i,p));emit('health',base+4200,{values});if(arm==='A')emit('static_observation',base+4300,{round:k});
  emit('arm_round_end',base+10000,{round:k,index,startedAt:base,deadline:base+60000,finishedAt:base+10000});
 }
 if(negative){s.failure=s.stopReason;emit('attached_deadline',end,{observedAt:end,deadline:start+60000,reason:'round_deadline'});emit('arm_stopped',end,{reason:s.stopReason,completedRounds:0});}
 else emit('measurement_tail',end-49999,{deadline:start+c.seconds*1000+15000});
 emit('measurement_end',end);trace('closed',end+10,{round:negative?0:c.rounds-1});
 if(negative){
  const startedAt=end+15,deadline=startedAt+15000;emit('failure_observation_start',startedAt,{startedAt,deadline});
  for(let i=0;i<32;i++){raw(end+20+i*2,i,status(i));emit('failure_status',end+20+i*2,{index:i,attemptedAt:end+20+i*2,attempted:true,response:status(i)});}
  s.failureObservation={startedAt,deadline,finishedAt:end+90,observed:32,complete:true};emit('failure_observation_end',end+90,s.failureObservation);
 }
 emit('shutdown',end+100,{process:e.process,exit:{code:0},eofs:s.connections.map((_,index)=>({index,code:0,stderr:''}))});
 const originalSample=e.memory[0];e.memory=[];
 for(let elapsed=0;elapsed<duration;elapsed+=30){
  const row=structuredClone(originalSample),p=row.ownership.descendants[0],endpoint={pid:p.pid,startedTicks:p.startedTicks,localAddress:'127.0.0.1',localPort:9222,remoteAddress:'127.0.0.1',remotePort:12345};
  Object.assign(row,{elapsed,phase:'minimal_cdp_attached',cdpState:'open',debugPort:{port:9222,listeners:[endpoint],connections:[endpoint]}});e.memory.push(row);
 }
 e.postMemory=[];s.samples=e.memory;
 emit('cdp_endpoint',920,{ownership:e.memory[0].ownership,debugPort:{...e.memory[0].debugPort,connections:[]}});
 s.sessions=bindings;s.evaluations={preparation:{calls:1,queries:1,actions:0},measurement:{calls:negative?0:c.rounds*6,queries:negative?0:c.rounds*(arm==='A'?6:1),actions:negative||arm==='A'?0:c.rounds*5}};
 Object.assign(s.instrumentation,{rawCdpSessions:1,evaluateCalls:s.evaluations.measurement.calls+1,domQueries:s.evaluations.measurement.queries+1,domActions:s.evaluations.measurement.actions,heapDiagnosticCalls:0,jsProbes:0,forcedGcCalls:0});
 e.boundary={elapsedSeconds:duration,samples:e.memory.length};resequence(e);e.output=[];
 const padding='x'.repeat(1008);
 for(const b of bindings){
  const history=e.events.filter(v=>v.type==='binding'&&v.session===b.id);let h=0,binding=e.events.find(v=>v.type==='session_ready'&&v.id===b.id),cursor=0,batch=[];
  const flush=()=>{if(!batch.length)return;const first=cursor;cursor+=batch.length;const last=batch.at(-1);e.output.push({t:last.t,phase:'normal',session:b.id,index:b.index,epoch:binding.epoch,stream:binding.stream,cursor:first,response:{next_cursor:cursor,oldest_cursor:0,text:batch.map(v=>v.text).join('')}});batch=[];};
  for(let second=0;second<Math.floor(duration);second++){
   const t=start+second*1000+999;
   if(history[h]?.t<=t){flush();binding=history[h++].after;cursor=0;}
   batch.push({t,text:`SOAK:${b.index}:${String(second+1).padStart(8,'0')}:${padding}\n`});if(batch.length===16)flush();
  }
  flush();
 }
 return e;
}
