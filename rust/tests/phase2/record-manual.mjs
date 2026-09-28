import {readFile,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {checkIdentity,checkManual,manualCases} from './evidence.mjs';
try{
 const [directory,observationsPath,output]=process.argv.slice(2);
 const json=async path=>JSON.parse(await readFile(path,'utf8'));
 const meta=await json(join(directory,'metadata.json')),current=await json(join(directory,'identity-current.json')),result=await json(join(directory,'result.json'));
 checkIdentity(meta.identity,current);
 const observations=await json(observationsPath),raw=(await readFile(join(directory,'observations.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
 const receipt={identity:current,runId:meta.runId,startedUtc:meta.startedUtc,finishedUtc:meta.finishedUtc,os:meta.os,webviewVersion:result.webviewVersion,cases:[]};
 const hashed=async path=>({path:resolve(path),sha256:createHash('sha256').update(await readFile(path)).digest('hex')});
 for(const observation of observations.cases){
   const id=observation.id;if(!manualCases.includes(id)||receipt.cases.some(c=>c.id===id))throw Error('unknown_or_duplicate_case');
   const records=['user_owned','agent_owned'].map(mode=>{const r=raw.findLast(r=>r.caseId===id&&r.mode===mode);if(!r)throw Error(`capture_missing:${id}:${mode}`);return {...r,expectedHex:mode==='user_owned'?observation.userExpectedHex:observation.agentExpectedHex};});
   const audit={identity:current,runId:meta.runId,caseId:id,observations:records,...(id==='webview-descendant-exit'?{process:result.process}:{})};
   const auditPath=join(directory,id+'.audit.json');await writeFile(auditPath,JSON.stringify(audit,null,2));
   receipt.cases.push({id,confirmedBy:observation.confirmedBy,observedUtc:records.map(r=>r.observedUtc).sort().at(-1),modes:records.map(r=>r.mode),screenshots:await Promise.all((observation.screenshots??[]).map(path=>hashed(resolve(directory,path)))),audit:await hashed(auditPath)});
 }
 // Validate every supplied case even when some required cases are still missing.
 await checkManual(receipt,current,directory,receipt.cases.map(c=>c.id));
 const complete=await checkManual(receipt,current,directory);receipt.status=complete?'observed':'manual_pending';
 await writeFile(output,JSON.stringify(receipt,null,2));console.log(receipt.status);process.exitCode=complete?0:2;
}catch(error){console.error(error.message);process.exitCode=1;}
