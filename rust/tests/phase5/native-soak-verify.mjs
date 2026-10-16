import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {memoryVerdict} from './native-soak-control.mjs';
export function verifyNativeEvidence(s,raw,boundary,receipts,audits){
 assert.ok(['smoke','release'].includes(s.mode),'mode');const rounds=s.mode==='release'?120:3,duration=rounds*60;
 assert.equal(s.status,s.mode==='release'?'passed':'smoke_passed','status');assert.ok(s.finishedUtc);
 assert.ok(s.elapsedSeconds>=duration,'duration');assert.deepEqual(raw,s.samples,'raw_memory_mismatch');
 assert.equal(s.connections.length,32);assert.equal(new Set(s.connections).size,32);assert.equal(s.sessions.length,16);assert.equal(new Set(s.sessions.map(x=>x.id)).size,16);
 assert.equal(s.fixtures.length,2);assert.ok(s.fixtures.every(f=>f.image===s.imageId&&f.removed));
 assert.equal(boundary.samples,raw.length);assert.equal(boundary.rounds,rounds);assert.equal(boundary.elapsedSeconds,s.elapsedSeconds);
 assert.equal(boundary.finishedUtc,s.loadFinishedUtc);
 assert.ok(Date.parse(s.playwrightDisconnectedUtc)<=Date.parse(s.loadStartedUtc));
 assert.ok(Date.parse(s.playwrightReconnectedUtc)>=Date.parse(s.loadFinishedUtc),'early_reconnect');
 assert.deepEqual(s.instrumentation,{rawCdpSessions:0,forcedGcCalls:0,jsProbes:0,debugListenerEnabled:true});
 assert.ok(raw.length>0);let previous=0,identities;
 for(const row of raw){
  assert.ok(row.elapsed>=previous&&row.elapsed<duration,'sample_boundary');assert.ok(row.elapsed-previous<=45,'sample_gap');previous=row.elapsed;
  assert.equal(row.phase,'natural');assert.equal(row.debugPort.established,0);assert.ok(row.debugPort.listening>0);
  const current=row.processes.map(p=>`${p.pid}:${p.startedTicks}`).sort();if(identities)assert.deepEqual(current,identities,'process_identity_changed');else identities=current;
  for(const [role,count] of [['app',1],['renderer',1],['adapter',32]])assert.equal(row.processes.filter(p=>p.role===role).length,count);
  for(const key of ['privateBytes','workingSetBytes'])assert.equal(row[key],row.processes.reduce((n,p)=>n+p[key],0),'role_total');
 }
 assert.ok(duration-previous<=45,'sample_gap');
 assert.equal(receipts.length,rounds*4+1);assert.equal(new Set(receipts.map(r=>r.request.id)).size,receipts.length);
 const preparations=receipts.filter(r=>r.request.action==='ready');assert.equal(preparations.length,1,'native_readiness_missing');
 const ready=preparations[0];assert.equal(ready.request.owner,s.owner);assert.equal(ready.observation.verified,true);
 assert.equal(ready.observation.selectionEvidence,'operator_ack');assert.equal(ready.request.session,s.sessions.find(x=>x.index===0).id);
 assert.equal(ready.observation.selectedSession,ready.request.session);assert.deepEqual(s.nativeReady,{requestId:ready.request.id,verifiedAt:ready.verifiedAt});
 assert.ok(ready.request.issuedAt>=Date.parse(s.playwrightDisconnectedUtc),'readiness_before_disconnect');
 assert.ok(ready.verifiedAt>=ready.request.issuedAt&&ready.verifiedAt<=ready.request.expiresAt,'native_ready_deadline');
 assert.ok(ready.verifiedAt<=Date.parse(s.loadStartedUtc),'measurement_before_native_ready');
 for(let round=0;round<rounds;round++)for(const action of ['select','resize','reclaim','handoff']){
  const matches=receipts.filter(r=>r.request.round===round&&r.request.action===action);assert.equal(matches.length,1,'native_receipt_missing');
  const r=matches[0];assert.equal(r.request.owner,s.owner);assert.equal(r.observation.verified,true);assert.ok(r.verifiedAt>=r.request.issuedAt&&r.verifiedAt<=r.request.expiresAt,'native_deadline');
  const target=s.sessions.find(x=>x.index===round%16);assert.equal(r.request.session,target.id,'native_session');
  if(['reclaim','handoff'].includes(action))assert.ok(Number.isSafeInteger(r.observation.epoch)&&r.observation.epoch>r.request.epoch,'stale_epoch');
  if(action==='select'){assert.equal(r.observation.selectionEvidence,'operator_ack');assert.equal(r.observation.selectedSession,r.request.session);}
  if(action==='handoff'){
   assert.equal(r.request.targetConnection,s.connections[r.request.adapter],'handoff_connection');assert.ok(r.observation.stream);
   const previous=receipts.find(x=>x.request.round===round&&x.request.action==='reclaim');assert.equal(r.request.epoch,previous.observation.epoch,'handoff_epoch');
   const a=s.actions.find(x=>x.type==='handoff'&&x.round===round);assert.ok(a);assert.equal(a.epoch,r.observation.epoch);assert.equal(a.stream,r.observation.stream);assert.equal(a.adapter,r.request.adapter);
  }
  if(action==='resize'){
   const selected=receipts.find(x=>x.request.round===round&&x.request.action==='select');
   assert.ok(selected&&selected.verifiedAt<=r.request.issuedAt,'selection_before_resize');
   assert.deepEqual(r.request.previousGeometry,selected.observation.geometry,'selected_geometry');
   assert.ok(r.observation.geometry.rows!==r.request.previousGeometry.rows||r.observation.geometry.columns!==r.request.previousGeometry.columns,'geometry_unchanged');
   const a=s.actions.find(x=>x.type==='resize'&&x.round===round);assert.ok(a);assert.deepEqual(a.geometry,r.observation.geometry);
   assert.deepEqual(a.remote.split(/\s+/).map(Number),[a.geometry.rows,a.geometry.columns],'server_geometry');
  }
 }
 for(const type of ['audit','resize','handoff'])assert.equal(s.actions.filter(a=>a.type===type).length,rounds);
 assert.equal(audits.length,16);assert.equal(new Set(audits.map(a=>a.index)).size,16);
 for(const a of audits){const expected=Array.from({length:rounds},(_,r)=>`AUDIT_${a.index}_${r}`);assert.deepEqual(a.actual,expected,'server_audit');}
 assert.equal(s.rates.length,16);for(const r of s.rates)assert.ok(r.bytesPerSecond>=1024,'output_rate');
 assert.deepEqual(s.cleanup,{normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0});
 assert.equal(s.process.descendantAudit,'verified');assert.equal(s.phases.shutdown.detail.adapterEof,32);
 for(const name of ['normal','overload','shutdown'])assert.equal(s.phases[name].status,'passed');
 assert.equal(s.overload.controlBurstPassed,true);assert.equal(s.overload.burstBytes,1310720);assert.ok(s.overload.droppedAcks>0);assert.equal(s.overload.unaffectedAlive,15);assert.equal(s.overload.state,'closed');
 if(s.mode==='release'){const m=memoryVerdict(raw,s.elapsedSeconds);assert.equal(m.passed,true);assert.deepEqual(m,s.memory);}
 return {valid:true,mode:s.mode,releaseAcceptance:s.mode==='release',rounds,samples:raw.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const out=resolve(process.argv[2]??'');assert.ok(process.argv[2],'usage: native-soak-verify.mjs evidence-directory');
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
 const read=async p=>JSON.parse((await readFile(join(out,p),'utf8')).replace(/^\uFEFF/,''));
 const s=await read('summary.json'),raw=(await readFile(join(out,'memory.jsonl'),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
 const receipts=await Promise.all((await readdir(join(out,'native/results'))).filter(f=>f.endsWith('.json')).map(f=>read('native/results/'+f)));
 const result=verifyNativeEvidence(s,raw,await read('normal-boundary.json'),receipts,await read('audit-observations.json'));
 const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
 for(const [p,expected] of Object.entries(s.sources))assert.equal(await hash(join(root,p)),expected,'source_changed_'+p);
 for(const b of Object.values(s.binaries))assert.equal(await hash(b.path),b.sha256,'binary_changed');
 result.summarySha256=await hash(join(out,'summary.json'));result.verifiedUtc=new Date().toISOString();
 await writeFile(join(out,'verified.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
