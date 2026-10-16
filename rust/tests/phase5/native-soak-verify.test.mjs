import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNativeEvidence} from './native-soak-verify.mjs';
function fixture(){
 const processes=Array.from({length:34},(_,i)=>({pid:i+1,startedTicks:'1',role:i===0?'app':i===1?'renderer':'adapter',privateBytes:100,workingSetBytes:100}));
 const raw=Array.from({length:6},(_,i)=>({elapsed:i*30,phase:'natural',debugPort:{established:0,listening:1},processes,privateBytes:3400,workingSetBytes:3400}));
 const sessions=Array.from({length:16},(_,index)=>({id:`s${index}`,index}));
 const actions=[],receipts=[];for(let round=0;round<3;round++){
  for(const type of ['audit','resize','handoff'])actions.push({type,round,index:round,session:`s${round}`,geometry:{rows:40,columns:140},remote:'40 140',previous:round,adapter:round+16,epoch:3,stream:`stream${round}`});
  for(const [order,action] of ['select','resize','reclaim','handoff'].entries())receipts.push({request:{id:`${round}-${action}`,round,index:round,action,owner:'owner',session:`s${round}`,epoch:action==='handoff'?2:1,previousGeometry:{rows:32,columns:120},targetConnection:`c${round+16}`,adapter:round+16,issuedAt:order*1000,expiresAt:(order+1)*1000},observation:{verified:true,selectionEvidence:'operator_ack',selectedSession:`s${round}`,epoch:action==='reclaim'?2:3,geometry:action==='select'?{rows:32,columns:120}:{rows:40,columns:140},stream:`stream${round}`},verifiedAt:order*1000+500});
 }
 const audits=sessions.map(s=>({index:s.index,session:s.id,actual:Array.from({length:3},(_,r)=>`AUDIT_${s.index}_${r}`)}));
 const s={mode:'smoke',status:'smoke_passed',owner:'owner',finishedUtc:'2026-10-16T00:04:00Z',loadStartedUtc:'2026-10-16T00:00:00Z',loadFinishedUtc:'2026-10-16T00:03:00Z',playwrightDisconnectedUtc:'2026-10-15T23:59:59Z',playwrightReconnectedUtc:'2026-10-16T00:03:01Z',elapsedSeconds:180,samples:raw,connections:Array.from({length:32},(_,i)=>`c${i}`),sessions,imageId:'image',fixtures:[{image:'image',removed:true},{image:'image',removed:true}],instrumentation:{rawCdpSessions:0,forcedGcCalls:0,jsProbes:0,debugListenerEnabled:true},actions,rates:sessions.map(x=>({index:x.index,bytesPerSecond:1180})),cleanup:{normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0},process:{descendantAudit:'verified'},phases:{normal:{status:'passed'},overload:{status:'passed'},shutdown:{status:'passed',detail:{adapterEof:32}}},overload:{controlBurstPassed:true,burstBytes:1310720,droppedAcks:1,unaffectedAlive:15,state:'closed'}};
 const boundary={samples:6,rounds:3,elapsedSeconds:180,finishedUtc:s.loadFinishedUtc};return {s,raw,boundary,receipts,audits};
}
const verify=f=>verifyNativeEvidence(f.s,f.raw,f.boundary,f.receipts,f.audits);
test('complete short-run evidence remains smoke-only',()=>{const r=verify(fixture());assert.equal(r.valid,true);assert.equal(r.releaseAcceptance,false);});
for(const [name,mutate] of [
 ['early browser reconnection',f=>f.s.playwrightReconnectedUtc=f.s.loadStartedUtc],
 ['foreign action result',f=>f.receipts[0].request.owner='other'],
 ['stale epoch accepted as reclaim',f=>f.receipts[2].observation.epoch=1],
 ['handoff to a different connection',f=>f.receipts[3].request.targetConnection='c31'],
 ['resize baseline from before selection',f=>f.receipts[1].request.issuedAt=0],
 ['resize baseline differs from selected geometry',f=>f.receipts[1].request.previousGeometry.rows=17],
 ['resize without a size change',f=>{f.receipts[1].observation.geometry={rows:32,columns:120};f.s.actions[1].geometry={rows:32,columns:120};f.s.actions[1].remote='32 120';}],
 ['server resize disagrees with geometry',f=>f.s.actions[1].remote='17 102'],
 ['duplicate audit session',f=>f.audits[1]=f.audits[0]],
 ['dropped audit effect',f=>f.audits[0].actual.pop()],
 ['missing native action',f=>f.receipts.pop()],
 ['normal exit not proven',f=>f.s.cleanup.normalExit=false],
 ['memory contamination',f=>f.raw[2].debugPort.established=1],
 ['role accounting corrupted',f=>f.raw[0].privateBytes=1],
 ['raw memory differs',f=>f.s.samples=structuredClone(f.raw).slice(1)],
 ])test('rejects '+name,()=>{const f=fixture();mutate(f);assert.throws(()=>verify(f));});
