import assert from 'node:assert/strict';
import {join} from 'node:path';
import {assertProcessIdentity} from '../separated/runtime.mjs';
export function validateDebugger(debug,ownership,port,count){
 assert.equal(debug.port,port,'debug_port');assert.ok(Array.isArray(debug.listeners)&&debug.listeners.length>=1,'debug_listener');assert.ok(Array.isArray(debug.connections),'debug_connections');assert.equal(debug.connections.length,count,'debug_connection_count');
 for(const p of [...debug.listeners,...debug.connections]){
  assert.equal(p.localPort,port);assert.ok(['127.0.0.1','::1'].includes(p.localAddress),'debug_non_loopback');
  const owned=ownership.descendants.find(v=>v.pid===p.pid&&!v.exited);assert.ok(owned,'foreign_debug_process');assertProcessIdentity(owned,p);
 }
 for(const p of debug.connections)assert.ok(['127.0.0.1','::1'].includes(p.remoteAddress)&&p.remotePort>0,'debug_peer');
}
export function validateAttachedSample(s){
 assert.equal(s.phase,'minimal_cdp_attached');assert.equal(s.cdpState,'open');validateDebugger(s.debugPort,s.ownership,s.debugPort.port,1);
 assert.equal(new Set(s.processes.map(p=>p.pid)).size,s.processes.length,'duplicate_process');
 for(const [role,count] of [['app',1],['renderer',1],['adapter',32]])assert.equal(s.processes.filter(p=>p.role===role).length,count,'role_count');
 for(const p of s.processes){const expected=p.role==='app'?s.ownership:p.role==='adapter'?s.ownership.adapters.find(v=>v.pid===p.pid):s.ownership.descendants.find(v=>v.pid===p.pid&&!v.exited);assert.ok(expected,'process_owner');assertProcessIdentity(expected,p);for(const key of ['privateBytes','workingSetBytes'])assert.ok(Number.isFinite(p[key])&&p[key]>=0,'memory_number');}
 assert.equal(s.privateBytes,s.processes.reduce((n,p)=>n+p.privateBytes,0),'private_sum');assert.equal(s.workingSetBytes,s.processes.reduce((n,p)=>n+p.workingSetBytes,0),'working_sum');
 return s;
}
export async function readDebugger(r){
 const text=(await r.execute(r.config.pwsh,['-NoProfile','-File',join(r.root,'rust/tests/phase5/minimal-cdp-cadence/sample-debug.ps1'),'-Port',String(r.port)],{windowsHide:true,timeout:Math.max(1,Math.min(20000,r.cadenceGuard.deadline-r.now())),maxBuffer:1024*1024})).stdout;
 return JSON.parse(text);
}
export async function sampleAttached(r){
 const receipt=await r.receipt();await r.json('memory-input.json',{...receipt,adapters:r.adapterIdentities});
 const processes=JSON.parse(await r.ps('sample-test-process-roles.ps1',['-Evidence',join(r.out,'memory-input.json')]));
 const ownership={pid:receipt.pid,startedTicks:receipt.startedTicks,descendants:receipt.descendants.filter(p=>!p.exited),adapters:r.adapterIdentities};
 const sample={elapsed:r.elapsed(),phase:'minimal_cdp_attached',ownership,processes,debugPort:await readDebugger(r),cdpState:r.cdp?.state,privateBytes:processes.reduce((n,p)=>n+p.privateBytes,0),workingSetBytes:processes.reduce((n,p)=>n+p.workingSetBytes,0)};
 validateAttachedSample(sample);const identities=processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(p=>`${p.pid}:${p.startedTicks}`).sort();
 if(r.identities)assert.deepEqual(identities,r.identities,'process_identity_changed');else r.identities=identities;
 await r.append('memory.jsonl',sample);r.summary.samples.push(sample);return sample;
}
