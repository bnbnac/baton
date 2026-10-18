export function transitionFixture(round=0){
 const index=round%16,visit=Math.floor(round/16),previous=visit%2?index+16:index,target=(previous+16)%32,epoch=visit*2+1;
 return {round,index,before:{session:'s'+index,adapter:previous,epoch,stream:`stream-${index}-${epoch}`},
  selected:{session:'s'+index,geometry:{rows:32,columns:120},selectedAt:100,stableAt:850},resized:{geometry:{rows:40,columns:140},observedAt:900},remote:'40 140',
  reclaimed:{session_id:'s'+index,state:'user_owned',control_epoch:epoch+1,stream_id:null},
  assigned:{connection_id:'c'+target,session:{session_id:'s'+index,state:'agent_owned',control_epoch:epoch+2,stream_id:`stream-${index}-${epoch+2}`}},
  oldOwner:{connection_id:'c'+previous,sessions:[]},targetConnection:'c'+target,adapter:target};
}
export function transitionEvidence(scope='F'){
 const e=memoryEvidence(),rounds=scope==='N'?2:17,duration=rounds*10,events=[];
 const emit=(type,t,detail={})=>events.push({type,t,owner:e.summary.owner,scope,...detail});
 const bindings=e.summary.sessions.map(s=>({...s}));
 const status=(index)=>({app_state:'online',connection_id:e.summary.connections[index],sessions:bindings.filter(s=>s.adapter===index).map(s=>({session_id:s.id,state:'agent_owned',control_epoch:s.epoch,stream_id:s.stream,geometry:{rows:32,columns:120}}))});
 const raw=(t,index,response)=>emit('mcp',t,{index,name:'status',args:{},response});
 e.summary.scope=scope;e.summary.profile=scope==='N'?'full':'preflight';e.summary.elapsedSeconds=duration;
 emit('browser_disconnected',-1);for(const s of bindings)emit('session_ready',-1,{...s});emit('measurement_start',0);
 e.audits=bindings.map(s=>({index:s.index,session:s.id,actual:[]}));e.nativeFiles={requests:[],starts:[],responses:[],results:[]};
 for(let round=0;round<rounds;round++){
  const base=round*10000,s=bindings[round%16],r=transitionFixture(round);r.before.stream=s.stream;r.before.epoch=s.epoch;r.selected.selectedAt=base+100;r.selected.stableAt=base+900;r.resized.observedAt=base+1000;
  raw(base+100,s.adapter,status(s.adapter));raw(base+900,s.adapter,status(s.adapter));emit('selected',base+901,{round,...r.selected});
  const resized=status(s.adapter);resized.sessions.find(v=>v.session_id===s.id).geometry=r.resized.geometry;raw(base+1000,s.adapter,resized);
  emit('remote_geometry',base+2000,{round,session:s.id,geometry:r.resized.geometry,remote:r.remote});
  emit('transition_boundary',base+3000,{session:s.id,stage:'reclaiming',epoch:s.epoch,stream:s.stream,cursor:0});
  raw(base+4000,s.adapter,{app_state:'online',connection_id:'c'+s.adapter,sessions:[r.reclaimed]});emit('transition_boundary',base+4001,{session:s.id,stage:'reclaimed',epoch:s.epoch,stream:s.stream,cursor:0});
  raw(base+5000,r.adapter,{app_state:'online',connection_id:r.targetConnection,sessions:[r.assigned.session]});raw(base+5001,s.adapter,{app_state:'online',...r.oldOwner});
  emit('binding',base+5002,{session:s.id,before:{adapter:s.adapter,epoch:s.epoch,stream:s.stream,cursor:0},after:{adapter:r.adapter,epoch:r.assigned.session.control_epoch,stream:r.assigned.session.stream_id}});
  Object.assign(s,{adapter:r.adapter,epoch:r.assigned.session.control_epoch,stream:r.assigned.session.stream_id});
  if(scope==='N'){
   r.windowMode=round===0?'restored':'maximized';
   for(const [i,action] of ['window_mode','select','resize','reclaim','choose_connection','handoff'].entries()){
    const t=base+[0,901,1001,4000,4500,5000][i],id=`native-${round}-${action}`,request={id,owner:e.summary.owner,action,round,issuedAt:t,inputStartedAt:t,expiresAt:900000,verifyDeadline:t+45000};
    if(action!=='window_mode')request.session=s.id;if(['window_mode','resize'].includes(action))request.windowMode=action==='window_mode'?'restored':r.windowMode;
    if(['choose_connection','handoff'].includes(action))request.targetConnection=r.targetConnection;
    const observation={screenshotId:id,selectedSession:request.session,targetConnection:request.targetConnection,windowMode:request.windowMode};
    const observed={window_mode:{windowMode:request.windowMode},select:r.selected,resize:{...r.resized,windowMode:r.windowMode},reclaim:r.reclaimed,choose_connection:{targetConnection:r.targetConnection},handoff:r.assigned}[action];
    const response={id,owner:request.owner,status:'performed',observation},result={request,response,observation:{verified:true,...observed},verifiedAt:t};
    emit('native',t,result);const {inputStartedAt,verifyDeadline,...issued}=request;e.nativeFiles.requests.push(issued);e.nativeFiles.starts.push({id,owner:request.owner});e.nativeFiles.responses.push(response);e.nativeFiles.results.push(result);
   }
  }
  emit('transition',base+6000,r);emit('health',base+8000,{values:e.summary.connections.map((_,i)=>status(i))});
  for(const a of e.audits){const args={session_id:a.session,control_epoch:bindings[a.index].epoch,request_id:`a-${round}-${a.index}`,text:`printf '%s\\n' 'AUDIT_${a.index}_${round}' >> /tmp/soak-audit-${a.index}`};for(let i=0;i<2;i++)emit('mcp',base+9000,{index:bindings[a.index].adapter,name:'send_text',args,response:{result:'delivered'}});emit('mcp',base+9000,{index:bindings[a.index].adapter,name:'send_key',args:{session_id:a.session,key:'Enter'},response:{result:'delivered'}});a.actual.push(`AUDIT_${a.index}_${round}`);}
  emit('audit',base+9000,{round});
 }
 emit('measurement_end',duration*1000);emit('shutdown',duration*1000+1,{process:e.process,exit:{code:0},eofs:e.summary.connections.map((_,index)=>({index,code:0,stderr:''}))});
 events.sort((a,b)=>a.t-b.t);events.forEach((v,i)=>v.seq=i+1);e.events=events;e.summary.sessions=bindings;
 e.memory=e.summary.samples=scope==='N'?e.memory.filter(s=>s.elapsed<duration):[];
 e.boundary={elapsedSeconds:duration,eventSeq:events.find(v=>v.type==='measurement_end').seq,samples:e.memory.length};e.output=[];
 for(const s of bindings){let stream=null,cursor=0;for(let second=0;second<duration;second++){const t=second*1000+999;const b=events.filter(v=>v.type==='binding'&&v.session===s.id&&v.t<=t).at(-1)?.after??events.find(v=>v.type==='session_ready'&&v.id===s.id);if(b.stream!==stream){stream=b.stream;cursor=0;}e.output.push({t,phase:'normal',session:s.id,index:s.index,epoch:b.epoch,stream,cursor:cursor++,response:{oldest_cursor:0,next_cursor:cursor,text:`SOAK:${s.index}:${String(second+1).padStart(8,'0')}:${'x'.repeat(1008)}\n`}});}}
 return e;
}
export function memoryEvidence(profile='preflight'){
 const seconds=profile==='full'?7200:180,rounds=seconds/60,owner='test-owner',hash='a'.repeat(64),imageId='sha256:'+hash;
 const sessions=Array.from({length:16},(_,index)=>({index,id:'s'+index,adapter:index,epoch:1,stream:'stream'+index}));
 const connections=Array.from({length:32},(_,i)=>'c'+i),events=[];
 const event=(type,t,detail={})=>{const row={seq:events.length+1,t,scope:'M',owner,type,...detail};events.push(row);return row;};
 event('browser_attached',-2);event('browser_disconnected',-1);event('measurement_start',0);
 const status=index=>({app_state:'online',connection_id:connections[index],sessions:index<16?[{session_id:'s'+index,state:'agent_owned',control_epoch:1,stream_id:'stream'+index}]:[]});
 for(let round=0;round<rounds;round++){
  const t=round*60000;event('health',t,{values:connections.map((_,i)=>status(i))});
  for(let i=0;i<16;i++){
   const args={session_id:'s'+i,control_epoch:1,request_id:`audit-${i}-${round}`,text:`printf '%s\\n' 'AUDIT_${i}_${round}' >> /tmp/soak-audit-${i}`};
   event('mcp',t,{index:i,name:'send_text',args,response:{result:'delivered'}});event('mcp',t,{index:i,name:'send_text',args,response:{result:'delivered'}});event('mcp',t,{index:i,name:'send_key',args:{session_id:'s'+i,control_epoch:1,request_id:`enter-${i}-${round}`,key:'Enter'},response:{result:'delivered'}});
  }
  event('audit',t,{round});
 }
 const end=event('measurement_end',seconds*1000);event('browser_attached',seconds*1000+1);
 let post=seconds*1000+2;const burst="for j in $(seq 1 40); do head -c 32768 /dev/zero | tr '\\000' Z; sleep 0.1; done";
 const command=text=>{event('mcp',post++,{index:0,name:'send_text',args:{session_id:'s0',text},response:{result:'delivered'}});event('mcp',post++,{index:0,name:'send_key',args:{session_id:'s0',key:'Enter'},response:{result:'delivered'}});};
 event('overload_control_start',post++,{victim:'s0',adapter:0,epoch:1,stream:'stream0',cursor:seconds});command(burst+"; printf '\\nCONTROL_DONE\\n'");
 for(let i=0;i<41;i++)event('mcp',post++,{index:0,name:'read_output',args:{session_id:'s0',control_epoch:1,stream_id:'stream0',cursor:seconds+i},response:{oldest_cursor:0,next_cursor:seconds+i+1,text:i<40?'Z'.repeat(32768):'\nCONTROL_DONE\n'}});
 event('mcp',post++,{index:0,name:'status',args:{},response:status(0)});event('overload_control_end',post++,{victim:'s0',cursor:seconds+41});event('overload_ack_blocked',post++,{victim:'s0',droppedAcks:1});command(burst);
 event('mcp',post++,{index:0,name:'status',args:{},response:{...status(0),sessions:[{...status(0).sessions[0],state:'closed'}]}});for(let i=1;i<16;i++)event('mcp',post++,{index:i,name:'status',args:{},response:status(i)});
 const overload={passed:true,controlBurstPassed:true,burstBytes:1310720,victim:'s0',state:'closed',droppedAcks:1,unaffectedAlive:15};event('overload',post++,overload);
 const process={pid:1,startedTicks:'1',descendants:[{pid:2,startedTicks:'1',dataDirectoryMatch:true}],normalExit:true,forcedCleanup:false,descendantAudit:'verified'};
 event('shutdown',post++,{process,exit:{code:0},eofs:connections.map((_,index)=>({index,code:0,stderr:''}))});
 const processes=Array.from({length:34},(_,i)=>({pid:i+1,startedTicks:'1',role:i===0?'app':i===1?'renderer':'adapter',privateBytes:100,workingSetBytes:100}));
 const adapterIdentities=processes.filter(p=>p.role==='adapter').map(({pid,startedTicks})=>({pid,startedTicks}));
 const memory=Array.from({length:seconds/30},(_,i)=>({elapsed:i*30,phase:'natural',ownership:{pid:process.pid,startedTicks:process.startedTicks,descendants:process.descendants,adapters:adapterIdentities},debugPort:{established:0,listening:1},processes:structuredClone(processes),privateBytes:3400,workingSetBytes:3400}));
 const output=sessions.flatMap(s=>Array.from({length:Math.ceil(seconds/16)},(_,batch)=>{const first=batch*16,count=Math.min(16,seconds-first);return {t:(first+count)*1000-1,elapsed:first+count-.001,phase:'normal',session:s.id,index:s.index,epoch:1,stream:s.stream,cursor:first,response:{oldest_cursor:0,next_cursor:first+count,text:Array.from({length:count},(_,n)=>`SOAK:${s.index}:${String(first+n+1).padStart(8,'0')}:${'x'.repeat(1008)}\n`).join('')}};}));
 const cleanup={normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]};
 const fixtures=[0,1].map(i=>({id:'fixture'+i,name:'fixture'+i,image:imageId,removed:true}));
 const summary={schema:1,scope:'M',profile,owner,status:'finished',finishedUtc:'2026-10-18T00:00:00Z',elapsedSeconds:seconds,sessions,connections,fixtures,samples:memory,sources:{'runner.mjs':hash},binaries:{app:{sha256:hash},adapter:{sha256:hash}},imageId,environment:{platform:'win32',arch:'x64',osRelease:'1',node:'v22',webview:'155',playwright:'1.62'},instrumentation:{forcedGcCalls:0,jsProbes:0,rawCdpSessions:0},cleanup};
 summary.adapterIdentities=adapterIdentities;summary.clockOrigin=0;
 return {summary,events,output,memory,process,cleanup:{owner,fixtures,process,remaining:[],containers:[],...cleanup},boundary:{eventSeq:end.seq,elapsedSeconds:seconds,samples:memory.length},audits:sessions.map(s=>({index:s.index,session:s.id,actual:Array.from({length:rounds},(_,r)=>`AUDIT_${s.index}_${r}`)}))};
}
