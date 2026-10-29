import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const requireValue=(value,message)=>{if(!value)throw Error(message);};
export const manualCases=['physical-key','physical-paste','ime-commit','ime-reclaim-mid-composition','mouse','hidden-restore','minimize-restore','dpi-100','dpi-150','dpi-200','interactive-vi','interactive-top','webview-descendant-exit'];
export const terminalCases=['cpr_agent_owned','mixed_queries','two_cpr','leading_zero','osc_escape','dcs_escape','untracked_prefix','alternate','origin','scroll_region','wrap_pending','wrap_max','token_attacks','expired','epoch','tokenless','untrusted_sequences','output_pressure','input_paths','private_public_private','hidden_parser','unsupported_user','tokenless_user',...Array.from({length:3},(_,i)=>`split_${i+1}`),...Array.from({length:14},(_,i)=>`mixed_split_${i+1}`),'queue_overload','query_overload','remote_exit','remote_exit_late_view'];
export function checkTap(log,required=[]){
 const count=name=>{const matches=[...log.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`,'gm'))];requireValue(matches.length===1,`tap_summary_missing:${name}`);return Number(matches[0][1]);};
 const passed=count('pass'),failed=count('fail'),skipped=count('skipped'),tests=count('tests');
 requireValue(passed>0&&failed===0&&skipped===0&&count('cancelled')===0&&count('todo')===0&&passed===tests,'tap_incomplete');
 const names=[...log.matchAll(/^ok \d+ - (.+)\r?$/gm)].map(m=>m[1].trim());
 requireValue(names.length===passed&&!/^not ok /m.test(log)&&log.match(new RegExp(`^1\\.\\.${tests}\\s*$`,'m')),'tap_results_missing');
 for(const name of required)requireValue(names.includes(name),`required_test_missing:${name}`);
 return {passed,failed,skipped};
}
export function checkRust(log,suites=[],required=[]){
 for(const suite of suites)requireValue(new RegExp(`Running tests[/\\\\]${suite}\\.rs`).test(log),`required_suite_missing:${suite}`);
 const names=[...log.matchAll(/^test ([\w:]+) \.\.\. ok\s*$/gm)].map(m=>m[1]);
 for(const name of required)requireValue(names.includes(name),`required_test_missing:${name}`);
 const summaries=[...log.matchAll(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out;/g)];
 requireValue(summaries.length>0&&!/test result: FAILED/.test(log),'rust_summary_missing');
 let passed=0;
 for(const s of summaries){requireValue(s.slice(2,6).every(n=>Number(n)===0),'rust_ignored_or_filtered');passed+=Number(s[1]);}
 requireValue(passed>0&&passed===names.length,'rust_results_missing');
 return {passed,failed:0,skipped:0};
}
export function checkDesktop(result,required){
 requireValue(typeof result.webviewVersion==='string'&&result.webviewVersion.length>0,'webview_version_missing');
 const outcomes=result.outcomes??[];
 requireValue(outcomes.length===required.length&&new Set(outcomes.map(o=>o.name)).size===required.length,'desktop_case_count');
 for(const name of required)requireValue(outcomes.some(o=>o.name===name&&o.passed===true),`desktop_case_missing:${name}`);
 const p=result.process;
 requireValue(p?.normalExit===true&&p.forcedCleanup===false&&p.descendantAudit==='verified'&&!p.failure,'normal_close_unverified');
 requireValue(p.pid>0&&p.startedTicks&&p.path&&p.descendants?.length>0,'process_identity_missing');
 requireValue(p.descendants.every(d=>d.pid>0&&d.startedTicks&&d.path&&d.parent>0&&d.exited===true)&&p.descendants.some(d=>d.dataDirectoryMatch===true),'descendants_unverified');
}
export function checkIdentity(before,after){
 for(const key of ['sourceDigest','cargoLock','npmLock','productExecutable','acceptanceExecutable'])requireValue(typeof before?.[key]==='string'&&before[key].length>0&&before[key]===after?.[key],`identity_changed:${key}`);
}
export async function checkManual(receipt,identity,base,required=manualCases){
 if(!receipt)return false;
 checkIdentity(receipt.identity,identity);
 requireValue(receipt.runId&&receipt.os&&receipt.webviewVersion,'manual_environment_missing');
 const start=Date.parse(receipt.startedUtc),end=Date.parse(receipt.finishedUtc);
 requireValue(Number.isFinite(start)&&end>=start&&end<=Date.now()+60000,'manual_time_invalid');
 const cases=receipt.cases??[];
 requireValue(new Set(cases.map(c=>c.id)).size===cases.length,'manual_duplicate_case');
 if(required.some(id=>!cases.some(c=>c.id===id)))return false;
 async function artifact(a){requireValue(a?.path&&/^[a-f0-9]{64}$/i.test(a.sha256),'manual_artifact_invalid');const data=await readFile(resolve(base,a.path));requireValue(createHash('sha256').update(data).digest('hex')===a.sha256.toLowerCase(),'manual_artifact_changed');return data;}
 for(const id of required){const c=cases.find(c=>c.id===id),at=Date.parse(c.observedUtc);
   requireValue(c.confirmedBy?.trim()&&at>=start&&at<=end,'manual_confirmation_missing');
   requireValue(c.modes?.includes('user_owned')&&c.modes?.includes('agent_owned'),'manual_ownership_missing');
   requireValue(c.screenshots?.length>0,'manual_screenshot_missing');for(const s of c.screenshots)await artifact(s);
   const audit=JSON.parse((await artifact(c.audit)).toString('utf8'));
   requireValue(audit.runId===receipt.runId&&audit.caseId===id,'manual_audit_mismatch');checkIdentity(audit.identity,identity);
   requireValue(audit.observations?.length>=2,'manual_observations_missing');
   for(const mode of ['user_owned','agent_owned']){const observation=audit.observations.find(o=>o.mode===mode);requireValue(observation&&/^(?:[a-f0-9]{2})*$/i.test(observation.expectedHex)&&observation.receivedHex===observation.expectedHex&&observation.serverObserved===true,'manual_wire_mismatch');}
   if(id==='webview-descendant-exit')requireValue(audit.process?.normalExit===true&&audit.process.descendantAudit==='verified'&&audit.process.forcedCleanup===false&&audit.process.descendants?.length>0&&audit.process.descendants.every(p=>p.exited),'manual_process_unverified');
 }
 return true;
}

// These files cannot change the app or the manual input harness. Keep this list
// explicit: a broad tests/scripts exclusion would conceal transport changes.
const collectionTools=new Set(['rust/tests/phase2/evidence.mjs','rust/tests/phase2/record-manual.mjs','rust/tests/phase2/collection.test.mjs','rust/tests/phase2/validate-run.mjs','rust/scripts/verify-phase-2.ps1']);
export function checkCollectionBuild(before,after){
 checkIdentity({...before,sourceDigest:after?.sourceDigest},after);
 if(before.sourceDigest===after.sourceDigest)return [];
 const inventory=value=>{
   requireValue(Array.isArray(value.files)&&value.files.length>0,'collection_inventory_missing');
   const files=new Map();
   for(const f of value.files){
     requireValue(typeof f.path==='string'&&!f.path.includes('..')&&!files.has(f.path)&&/^[A-F0-9]{64}$/.test(f.sha256),'collection_inventory_invalid');files.set(f.path,f.sha256);
   }
   const hash=createHash('sha256').update(value.files.map(f=>`${f.path}:${f.sha256}`).join('\n')).digest('hex').toUpperCase();
   requireValue(hash===value.sourceDigest,'collection_inventory_digest');return files;
 };
 const a=inventory(before),b=inventory(after),changed=[...new Set([...a.keys(),...b.keys()])].filter(path=>a.get(path)!==b.get(path));
 requireValue(changed.every(path=>collectionTools.has(path)),'collection_product_source_changed');return changed.sort();
}

// A collection refers to original runs; it never fabricates a combined run.
export async function checkManualCollection(receipt,identity,base){
 requireValue(receipt?.schemaVersion===2,'collection_version');
 checkIdentity(receipt.identity,identity);
 const artifact=async a=>{
   requireValue(a?.path&&/^[a-f0-9]{64}$/i.test(a.sha256),'collection_artifact_invalid');
   const bytes=await readFile(resolve(base,a.path));
   requireValue(createHash('sha256').update(bytes).digest('hex')===a.sha256.toLowerCase(),'collection_artifact_changed');
   return bytes.toString('utf8').replace(/^\uFEFF/,'');
 };
 const json=async a=>JSON.parse(await artifact(a));
 const baseline=await json(receipt.baseline);
 requireValue(['manual_pending','passed'].includes(baseline.status),'collection_baseline_failed');
 checkIdentity(baseline.identity,identity);checkIdentity(baseline.identityAfter,identity);
 const runs=new Map(),toolChanges=[];
 for(const run of receipt.runs??[]){
   requireValue(run.id&&!runs.has(run.id),'collection_duplicate_run');
   const meta=await json(run.metadata);const changed=checkCollectionBuild(meta.identity,identity);
   if(changed.length)toolChanges.push({runId:run.id,files:changed});
   const start=Date.parse(meta.startedUtc),end=Date.parse(meta.finishedUtc);
   requireValue(meta.runId===run.id&&meta.os&&Number.isFinite(start)&&end>=start&&end<=Date.now()+60000,'collection_run_invalid');
   const raw=(await artifact(run.raw)).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
   // A forced run may supply input observations, but cannot supply a normal exit.
   const process=run.process?await json(run.process):null;
   runs.set(run.id,{meta,start,end,raw,process});
 }
 const observed=[];
 for(const c of receipt.cases??[]){
   requireValue(manualCases.includes(c.id)&&!observed.includes(c.id),'collection_duplicate_or_unknown_case');
   requireValue(['human','native'].includes(c.operator?.kind)&&c.operator.name?.trim()&&c.operator.statement?.trim(),'collection_operator_missing');
   for(const a of c.evidence??[])await artifact(a);
   // Human key/paste records also have the user's contemporaneous transcript.
   requireValue(['physical-key','physical-paste'].includes(c.id)&&c.operator.kind==='human'||c.evidence?.length>0,'collection_support_missing');
   const records=[];
   for(const ref of c.observations??[]){
     const run=runs.get(ref.runId);requireValue(run,'collection_run_missing');
     const matches=run.raw.filter(o=>o.caseId===ref.caseId&&o.mode===ref.mode&&o.observedUtc===ref.observedUtc);
     requireValue(matches.length===1,'collection_reference_ambiguous');
     const row=matches[0],start=Date.parse(row.startedUtc),at=Date.parse(row.observedUtc);
     requireValue(start>=run.start&&at>=start&&at<=run.end&&row.serverObserved===true,'collection_observation_invalid');
     requireValue(typeof ref.expectedHex==='string'&&/^(?:[a-f0-9]{2})*$/.test(ref.expectedHex)&&row.receivedHex===ref.expectedHex,'collection_wire_mismatch');
     requireValue(['user_owned','agent_owned'].includes(row.mode),'collection_mode_invalid');
     requireValue(row.mode!=='agent_owned'||ref.expectedHex==='','collection_blocked_input');
     records.push({...ref,row,at});
   }
   requireValue(new Set(records.map(r=>`${r.runId}/${r.observedUtc}/${r.caseId}/${r.mode}`)).size===records.length,'collection_duplicate_observation');
   if(c.id==='webview-descendant-exit'){
     const l=c.lifecycle,run=runs.get(l?.runId),at=Date.parse(l?.observedUtc);
     requireValue(run&&['user_owned','agent_owned'].includes(l.mode)&&l.trigger?.trim()&&at>=run.start&&at<=run.end,'collection_lifecycle_missing');
     checkDesktop({webviewVersion:'recorded-process',outcomes:[],process:run.process},[]);
   }else if(c.id==='ime-reclaim-mid-composition'){
     requireValue(records.length===2,'collection_transition_missing');
     const [old,fresh]=records;
     requireValue(old.runId===fresh.runId&&old.at<Date.parse(fresh.row.startedUtc)&&old.caseId===c.id&&fresh.caseId==='ime-commit'&&old.mode==='user_owned'&&fresh.mode==='user_owned','collection_transition_order');
     requireValue(old.expectedHex===''&&fresh.expectedHex==='ed959ceab88020','collection_transition_wire');
     requireValue(Number.isSafeInteger(c.transition?.beforeEpoch)&&c.transition.beforeEpoch>=0&&c.transition.afterEpoch===c.transition.beforeEpoch+2,'collection_transition_epoch');
   }else{
     requireValue(records.length>=2&&records.every(r=>r.caseId===c.id),'collection_observations_missing');
     requireValue(records.some(r=>r.mode==='user_owned'&&r.expectedHex.length>0)&&records.some(r=>r.mode==='agent_owned'),'collection_ownership_missing');
     if(c.id==='interactive-vi'){
       requireValue(records.length===3&&records.every(r=>r.runId===records[0].runId)&&records[0].mode==='user_owned'&&records[1].mode==='agent_owned'&&records[2].mode==='user_owned','collection_vi_sequence');
       requireValue(records[0].at<Date.parse(records[1].row.startedUtc)&&records[1].at<Date.parse(records[2].row.startedUtc)&&records[0].expectedHex.startsWith('76690d69')&&records[2].expectedHex.endsWith('1b3a71210d'),'collection_vi_exit');
       requireValue(c.interactive?.shellReturned===true&&c.interactive.finalText==='BATON_EDITOR_TEST','collection_vi_confirmation');
     }
     if(c.id==='interactive-top')requireValue(c.interactive?.shellReturned===true,'collection_top_exit');
   }
   observed.push(c.id);
 }
 const deferred=[];
 for(const d of receipt.deferred??[]){
   requireValue(['dpi-100','dpi-150','dpi-200'].includes(d.id)&&!observed.includes(d.id)&&!deferred.includes(d.id),'collection_deferral_invalid');
   requireValue(d.approvedBy?.trim()&&Number.isFinite(Date.parse(d.approvedUtc))&&Date.parse(d.approvedUtc)<=Date.now()+60000&&d.reason?.trim()&&d.due==='before-windows-release','collection_deferral_approval_missing');
   deferred.push(d.id);
 }
 const missing=manualCases.filter(id=>!observed.includes(id)&&!deferred.includes(id));
 return {status:missing.length?'manual_pending':deferred.length?'observed_with_deferrals':'observed',observed,deferred,missing,toolChanges};
}
