import {cadenceEvidence} from '../native-cadence/test-fixture.mjs';
import {CONTRACT} from './scenario.mjs';
import {digest} from './cdp.mjs';
import {domExpression} from './dom.mjs';
export function cdpEvidence(timeout=false){
 const e=cadenceEvidence(timeout),s=e.summary,native=e.events.filter(v=>v.type==='native'),old=e.events;e.events=old.filter(v=>!v.type.startsWith('native'));
 Object.assign(s,{scope:'CC',contract:CONTRACT});delete s.nativeResponseLatency;delete s.nativeTimingVersion;delete e.nativeFiles;
 const target={id:'page',type:'page',url:'http://tauri.localhost/',webSocketDebuggerUrl:'ws://127.0.0.1:9222/devtools/page/page'};s.cdpTarget=target;s.debugPort=9222;
 let id=0;const emit=(type,t,detail={})=>{const row={type,t,scope:'CC',owner:s.owner,...structuredClone(detail)};e.events.push(row);return row;};
 const trace=(kind,t,detail)=>emit('cdp',t,{kind,at:t,...detail});
 function command(action,args,round,t){
  const req=++id,deadline=round<0?15000:1000+round*60000+60000,method=action?'Runtime.evaluate':'Network.disable';
  trace('request',t,{id:req,round,method,deadline,...(action?{action,args,timeout:500,expressionSha256:digest(domExpression(action,args))}:{})});
  const value={sessionId:args?.sessionId,...(args?.connectionId?{connectionId:args.connectionId}:{}),...(action==='resize'?{width:args.width}:{})};
  trace('response',t+1,{id:req,round,result:action?{result:{value}}:{}});
  if(action)emit('cdp_action',t+2,{round,action,args,result:value});
 }
 trace('open',40,{round:-1,target});command(null,null,-1,50);command('identity',{sessionId:'s15'},-1,60);
 for(const n of native){
  const q=n.request;if(q.round<0)continue;const args={sessionId:q.session};if(q.action==='select')args.label=`soak-${String([0,1,0][q.round]).padStart(2,'0')}`;
  if(q.action==='resize')args.width=720;if(['choose_connection','handoff'].includes(q.action))args.connectionId=q.targetConnection;
  command(q.action,args,q.round,q.issuedAt);if(q.action==='select'){command('identity',{sessionId:q.session},q.round,q.issuedAt+5);emit('selected',n.t,{round:q.round,...n.observation});}
 }
 for(const t of e.events.filter(v=>v.type==='transition')){t.width=720;delete t.windowMode;delete t.resized.windowMode;}
 const end=e.events.find(v=>v.type==='measurement_end');trace('closed',end.t+10,{round:timeout?0:2});
 for(const sample of e.memory){
  const p=sample.ownership.descendants[0],entry={pid:p.pid,startedTicks:p.startedTicks,localAddress:'127.0.0.1',localPort:9222,remoteAddress:'127.0.0.1',remotePort:12345};
  sample.debugPort={port:9222,observedUtc:'test',listeners:[entry],connections:[entry]};sample.cdpState='open';sample.phase='minimal_cdp_attached';
 }
 const own=e.memory[0].ownership;emit('cdp_endpoint',30,{ownership:own,debugPort:{...e.memory[0].debugPort,connections:[]}});
 Object.assign(s.instrumentation,{rawCdpSessions:1,evaluateCalls:e.events.filter(v=>v.type==='cdp'&&v.kind==='request'&&v.method==='Runtime.evaluate').length,domQueries:e.events.filter(v=>v.type==='cdp'&&v.kind==='request'&&v.action==='identity').length,domActions:e.events.filter(v=>v.type==='cdp'&&v.kind==='request'&&v.action&&v.action!=='identity').length,heapDiagnosticCalls:0});
 e.events.sort((a,b)=>a.t-b.t);e.events.forEach((v,i)=>{v.seq=i+1;v.scope='CC';});e.boundary.eventSeq=end.seq;syncTrace(e);return e;
}
export function syncTrace(e){e.cdp=structuredClone(e.events.filter(v=>v.type==='cdp'));}
