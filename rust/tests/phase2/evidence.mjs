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
