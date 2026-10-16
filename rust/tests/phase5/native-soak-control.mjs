import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,rename,unlink,link} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function optional(path){try{return await json(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function publish(path,value){const tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{flag:'wx'});await rename(tmp,path);}
export async function readRequest(dir){return optional(join(dir,'pending.json'));}
export class NativeMailbox {
 constructor(dir,owner,now=Date.now){this.dir=dir;this.owner=owner;this.now=now;this.pending=null;}
 async init(){for(const name of ['requests','responses','results'])await mkdir(join(this.dir,name),{recursive:true});assert.equal(await readRequest(this.dir),null,'pending_request_exists');}
 async issue(action,timeoutMs){
  assert.equal(this.pending,null,'native_request_pending');assert.ok(timeoutMs>0);
  const request={...action,id:randomUUID(),owner:this.owner,issuedAt:this.now(),expiresAt:this.now()+timeoutMs};
  await writeFile(join(this.dir,'requests',request.id+'.json'),JSON.stringify(request,null,2),{flag:'wx'});
  await publish(join(this.dir,'pending.json'),request);this.pending=request.id;return request;
 }
 async completed(request){
  assert.equal(this.pending,request.id,'request_id');assert.ok(this.now()<=request.expiresAt,'native_action_timeout');
  const response=await optional(join(this.dir,'responses',request.id+'.json'));if(!response)return false;
  assert.equal(response.owner,this.owner,'response_owner');assert.equal(response.id,request.id,'response_id');assert.equal(response.status,'performed','native_action_failed');
  if(request.action==='select')assert.equal(response.selectedSession,request.session,'selected_session');
  return true; // The coordinator must separately observe MCP / server state.
 }
 async finish(request,observation){
  assert.equal(this.pending,request.id,'request_id');assert.equal(observation.verified,true,'observation_unverified');
  assert.ok(this.now()<=request.expiresAt,'native_action_timeout');
  await writeFile(join(this.dir,'results',request.id+'.json'),JSON.stringify({request,observation,verifiedAt:this.now()},null,2),{flag:'wx'});
  await unlink(join(this.dir,'pending.json'));this.pending=null;
 }
}
export async function acknowledge(dir,id,status,now=Date.now,selectedSession){
 const request=await readRequest(dir);assert.ok(request&&request.id===id,'request_id');assert.ok(now()<=request.expiresAt,'request_expired');assert.ok(['performed','failed'].includes(status),'response_status');
 if(request.action==='select'&&status==='performed')assert.equal(selectedSession,request.session,'selected_session');
 const path=join(dir,'responses',id+'.json'),tmp=path+'.'+randomUUID()+'.tmp';
 await writeFile(tmp,JSON.stringify({id,owner:request.owner,status,observedAt:now(),selectedSession}),{flag:'wx'});
 // Publish a complete file without overwriting a competing receipt.
 try{await link(tmp,path);}finally{await unlink(tmp);}
}
export async function runPhases(operations){
 const results={};let normalCompleted=false;
 for(const name of ['normal','overload','shutdown']){
  if(name==='overload'&&!normalCompleted){results[name]={status:'skipped',reason:'normal_workload_invalid'};continue;}
  try{const detail=await operations[name]();results[name]={status:detail.passed?'passed':'failed',detail};if(name==='normal')normalCompleted=true;}
  catch(e){results[name]={status:'failed',error:String(e)};}
 }
 return {...results,passed:Object.values(results).every(r=>r.status==='passed')};
}
const median=rows=>{const s=[...rows].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
export function memoryVerdict(samples,duration){
 assert.ok(duration>=7200,'insufficient_duration');assert.ok(samples.length>0,'no_samples');let previous=0;
 for(const s of samples){
  assert.ok(s.elapsed>=previous&&s.elapsed<7200,'sample_boundary');assert.ok(s.elapsed-previous<=45,'memory_sample_gap');previous=s.elapsed;
  assert.equal(s.phase,'natural','sample_phase');assert.equal(s.debugPort.established,0,'debugger_connection');
  for(const key of ['privateBytes','workingSetBytes'])assert.ok(Number.isFinite(s[key])&&s[key]>0,'invalid_memory_sample');
 }
 assert.ok(7200-previous<=45,'memory_sample_gap');
 const windows=[];for(let start=1200;start<7200;start+=1200){const rows=samples.filter(s=>s.elapsed>=start&&s.elapsed<start+1200);assert.ok(rows.length>=30,'insufficient_memory_samples');windows.push({start,end:start+1200,samples:rows.length,privateBytes:median(rows.map(s=>s.privateBytes)),workingSetBytes:median(rows.map(s=>s.workingSetBytes))});}
 const privateRatio=windows.at(-1).privateBytes/windows[0].privateBytes,workingSetRatio=windows.at(-1).workingSetBytes/windows[0].workingSetBytes;
 return {passed:privateRatio<=1.2&&workingSetRatio<=1.2,windows,privateRatio,workingSetRatio};
}
