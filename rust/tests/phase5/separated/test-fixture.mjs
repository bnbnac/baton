export function transitionFixture(round=0){
 const index=round%16,visit=Math.floor(round/16),previous=visit%2?index+16:index,target=(previous+16)%32,epoch=visit*2+1;
 return {round,index,before:{session:'s'+index,adapter:previous,epoch,stream:`stream-${index}-${epoch}`},
  selected:{session:'s'+index,geometry:{rows:32,columns:120},selectedAt:100,stableAt:850},resized:{geometry:{rows:40,columns:140},observedAt:900},remote:'40 140',
  reclaimed:{session_id:'s'+index,state:'user_owned',control_epoch:epoch+1,stream_id:null},
  assigned:{connection_id:'c'+target,session:{session_id:'s'+index,state:'agent_owned',control_epoch:epoch+2,stream_id:`stream-${index}-${epoch+2}`}},
  oldOwner:{connection_id:'c'+previous,sessions:[]},targetConnection:'c'+target,adapter:target};
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
 const overload={passed:true,controlBurstPassed:true,burstBytes:1310720,victim:'s0',state:'closed',droppedAcks:1,unaffectedAlive:15};event('overload',seconds*1000+2,overload);
 const process={pid:100,startedTicks:'1',normalExit:true,forcedCleanup:false,descendantAudit:'verified'};
 event('shutdown',seconds*1000+3,{process,exit:{code:0},eofs:connections.map((_,index)=>({index,code:0,stderr:''}))});
 const processes=Array.from({length:34},(_,i)=>({pid:i+1,startedTicks:'1',role:i===0?'app':i===1?'renderer':'adapter',privateBytes:100,workingSetBytes:100}));
 const memory=Array.from({length:seconds/30},(_,i)=>({elapsed:i*30,phase:'natural',debugPort:{established:0,listening:1},processes:structuredClone(processes),privateBytes:3400,workingSetBytes:3400}));
 const output=sessions.flatMap(s=>Array.from({length:Math.ceil(seconds/16)},(_,batch)=>{const first=batch*16,count=Math.min(16,seconds-first);return {t:(first+count)*1000-1,elapsed:first+count-.001,phase:'normal',session:s.id,index:s.index,epoch:1,stream:s.stream,cursor:first,response:{oldest_cursor:0,next_cursor:first+count,text:Array.from({length:count},(_,n)=>`SOAK:${s.index}:${String(first+n+1).padStart(8,'0')}:${'x'.repeat(1008)}\n`).join('')}};}));
 const cleanup={normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0,failures:[]};
 const fixtures=[0,1].map(i=>({id:'fixture'+i,name:'fixture'+i,image:imageId,removed:true}));
 const summary={schema:1,scope:'M',profile,owner,status:'finished',finishedUtc:'2026-10-18T00:00:00Z',elapsedSeconds:seconds,sessions,connections,fixtures,samples:memory,sources:{'runner.mjs':hash},binaries:{app:{sha256:hash},adapter:{sha256:hash}},imageId,environment:{platform:'win32',arch:'x64',osRelease:'1',node:'v22',webview:'155',playwright:'1.62'},instrumentation:{forcedGcCalls:0,jsProbes:0,rawCdpSessions:0},cleanup};
 return {summary,events,output,memory,process,cleanup:{owner,fixtures,process,remaining:[],containers:[],...cleanup},boundary:{eventSeq:end.seq,elapsedSeconds:seconds,samples:memory.length},audits:sessions.map(s=>({index:s.index,session:s.id,actual:Array.from({length:rounds},(_,r)=>`AUDIT_${s.index}_${r}`)}))};
}
