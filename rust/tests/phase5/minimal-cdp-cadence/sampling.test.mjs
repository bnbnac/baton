import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDebugger,validateAttachedSample} from './sampling.mjs';
export function sampleFixture(){
 const processes=[{role:'app',pid:1,startedTicks:'1'},{role:'renderer',pid:2,startedTicks:'2'},{role:'browser',pid:3,startedTicks:'3'},...Array.from({length:32},(_,i)=>({role:'adapter',pid:i+10,startedTicks:String(i+10)}))].map(p=>({...p,privateBytes:10,workingSetBytes:20}));
 const ownership={pid:1,startedTicks:'1',descendants:processes.filter(p=>p.role!=='app'&&p.role!=='adapter'),adapters:processes.filter(p=>p.role==='adapter')};
 const endpoint={pid:3,startedTicks:'3',localAddress:'127.0.0.1',localPort:9222,remoteAddress:'127.0.0.1',remotePort:10000};
 return {phase:'minimal_cdp_attached',elapsed:0,processes,ownership,debugPort:{port:9222,observedUtc:'test',listeners:[endpoint],connections:[endpoint]},privateBytes:350,workingSetBytes:700,cdpState:'open'};
}
test('validates owned listener and one attached connection with sums',()=>{const s=sampleFixture();assert.doesNotThrow(()=>validateAttachedSample(s));assert.doesNotThrow(()=>validateDebugger(s.debugPort,s.ownership,9222,1));});
for(const mode of ['foreign','reused','extra','missing','sum','role','closed'])test('rejects '+mode+' attached sample',()=>{
 const s=sampleFixture();if(mode==='foreign')s.debugPort.listeners[0].pid=999;if(mode==='reused')s.debugPort.connections[0].startedTicks='99';if(mode==='extra')s.debugPort.connections.push({...s.debugPort.connections[0]});if(mode==='missing')delete s.debugPort.connections;if(mode==='sum')s.privateBytes++;if(mode==='role')s.processes.pop();if(mode==='closed')s.cdpState='closed';assert.throws(()=>validateAttachedSample(s));
});
