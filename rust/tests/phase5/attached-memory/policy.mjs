import assert from 'node:assert/strict';
import {validateAttachedSample} from '../minimal-cdp-cadence/sampling.mjs';

export function resolveArm(arm,profile){
 assert.ok(['A','B'].includes(arm),'invalid_arm');
 assert.ok(['preflight','full'].includes(profile),'invalid_profile');
 return Object.freeze({scope:'AM',arm,profile,seconds:profile==='full'?7200:180,rounds:profile==='full'?120:3,periodMs:60000,preparationMs:900000,freezeGraceMs:15000});
}
export function slot(contract,startMs,k){
 assert.deepEqual(contract,resolveArm(contract.arm,contract.profile),'contract');
 assert.ok(Number.isFinite(startMs)&&Number.isInteger(k)&&k>=0&&k<contract.rounds,'slot_bounds');
 return {startMs:startMs+k*contract.periodMs,deadlineMs:startMs+(k+1)*contract.periodMs,index:contract.arm==='A'?0:k%16};
}
export function nextSampleAt(startMs,observedMs){
 assert.ok(Number.isFinite(startMs)&&Number.isFinite(observedMs)&&observedMs>=startMs,'sample_clock');
 return startMs+(Math.floor((observedMs-startMs)/30000)+1)*30000;
}
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return (sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2;};
const identities=s=>s.processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(p=>`${p.role}:${p.pid}:${p.startedTicks}`).sort();
const ratio=(a,b)=>b>0?a/b:null;
function ratios(windows){
 return {privateRatio:ratio(windows.at(-1).privateBytes,windows[0].privateBytes),workingSetRatio:ratio(windows.at(-1).workingSetBytes,windows[0].workingSetBytes),
  comparisons:windows.map((w,i)=>({start:w.start,privateFirst:ratio(w.privateBytes,windows[0].privateBytes),workingFirst:ratio(w.workingSetBytes,windows[0].workingSetBytes),privatePrevious:i?ratio(w.privateBytes,windows[i-1].privateBytes):null,workingPrevious:i?ratio(w.workingSetBytes,windows[i-1].workingSetBytes):null}))};
}
export function memoryResult(samples,durationSeconds,profile){
 const {seconds,freezeGraceMs}=resolveArm('A',profile);
 assert.ok(Number.isFinite(durationSeconds)&&durationSeconds>=seconds&&durationSeconds<=seconds+freezeGraceMs/1000,'measurement_duration');
 assert.ok(Array.isArray(samples)&&samples.length>0,'no_samples');
 let previous=0,initial,port;
 for(const s of samples){
  assert.ok(Number.isFinite(s.elapsed)&&s.elapsed>=previous&&s.elapsed<seconds,'sample_boundary');
  assert.ok(s.elapsed-previous<=45,'memory_sample_gap');previous=s.elapsed;
  validateAttachedSample(s);
  for(const key of ['privateBytes','workingSetBytes'])assert.ok(Number.isFinite(s[key])&&s[key]>0,'memory_total');
  if(initial){assert.deepEqual(identities(s),initial,'process_identity_changed');assert.equal(s.debugPort.port,port,'debug_port_changed');}
  else{initial=identities(s);port=s.debugPort.port;}
 }
 assert.ok(seconds-previous<=45,'memory_final_gap');
 if(profile==='preflight')return {memoryPassed:null,windows:[],ratios:null,roles:{}};
 const windows=[],roles={};
 const groups=['app','renderer','adapter','other'];
 for(let start=1200;start<7200;start+=1200){
  const rows=samples.filter(s=>s.elapsed>=start&&s.elapsed<start+1200);assert.ok(rows.length>=30,'insufficient_memory_samples');
  const values=read=>({start,end:start+1200,samples:rows.length,privateBytes:median(rows.map(s=>read(s,'privateBytes'))),workingSetBytes:median(rows.map(s=>read(s,'workingSetBytes')))});
  windows.push(values((s,k)=>s[k]));
  for(const role of groups)(roles[role]??=[]).push(values((s,k)=>s.processes.filter(p=>role==='other'?!groups.slice(0,3).includes(p.role):p.role===role).reduce((n,p)=>n+p[k],0)));
 }
 const result=ratios(windows);
 return {memoryPassed:result.privateRatio<=1.2&&result.workingSetRatio<=1.2,windows,ratios:result,roles:Object.fromEntries(Object.entries(roles).map(([key,rows])=>[key,{windows:rows,ratios:ratios(rows)}]))};
}
