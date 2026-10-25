import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publishNative} from '../separated/native.mjs';

// Convert two processes' monotonic timestamps using their recorded time origins.
// This is a pre-input check, not a promise that a later tool call will be timely.
// Always re-read immediately before each observed UI action; stop on expiry.
export function inputPermission({summary,pending,active,stopped},id,nowEpoch){
 return Boolean(!stopped&&summary&&!summary.finishedUtc&&['preparing','running'].includes(summary.status)&&
  pending?.id===id&&active?.id===id&&pending.owner===summary.owner&&active.owner===summary.owner&&
  active.responseReceivedAt===undefined&&Number.isFinite(summary.clockEpoch)&&Number.isFinite(active.inputDeadline)&&Number.isFinite(active.expiresAt)&&
  nowEpoch<=summary.clockEpoch+Math.min(active.inputDeadline,active.expiresAt));
}
export async function uiState(out){
 const optional=async path=>{try{return JSON.parse(await readFile(join(out,path),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 let stopped=false;try{await access(join(out,'stop'));stopped=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 return {summary:await optional('summary.json'),pending:await optional('native/pending.json'),active:await optional('native/active.json'),stopped};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [action,output,id,observationFile]=process.argv.slice(2);assert.ok(output&&['peek','check','start','done','failed'].includes(action),'usage: ui.mjs peek|check|start|done|failed evidence-dir [id] [observation-file]');
 const out=resolve(output),dir=join(out,'native'),now=()=>performance.timeOrigin+performance.now();
 let state=await uiState(out),result={};
 if(action==='start'){
  assert.ok(!state.stopped&&!state.summary?.finishedUtc&&state.pending?.id===id,'request_inactive');
  assert.ok(now()<=state.summary.clockEpoch+state.pending.expiresAt,'input_expired');
  result=await publishNative(dir,'start',id);const end=performance.now()+5000;
  do{state=await uiState(out);if(state.active?.id===id||state.summary?.finishedUtc)break;await new Promise(r=>setTimeout(r,100));}while(performance.now()<end);
 }
 if(['done','failed'].includes(action)){
  assert.ok(inputPermission(state,id,now()),'input_not_allowed');assert.ok(observationFile,'observation_file_required');
  const observation=JSON.parse(await readFile(resolve(observationFile),'utf8'));state=await uiState(out);assert.ok(inputPermission(state,id,now()),'input_not_allowed');result=await publishNative(dir,action,id,observation);
 }
 const inputAllowed=inputPermission(state,id??state.pending?.id,now());
 console.log(JSON.stringify({...result,pending:state.pending,active:state.active,inputAllowed,remainingMs:inputAllowed?state.summary.clockEpoch+Math.min(state.active.inputDeadline,state.active.expiresAt)-now():0},null,2));
}
