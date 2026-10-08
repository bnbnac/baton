import { readFile,writeFile,readdir,stat,copyFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,relative,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const fail=message=>{throw Error(message);};
export const REQUIRED_RUST=[
 'stale_ui_ownership_actions_have_no_effect','real_ipc_bridge_filters_owners_and_blocks_foreign_read_and_write',
 'read_reclaim_before_flush_rejects_the_old_output','queued_input_cancellation_never_writes_and_delivery_waits_for_transport',
 'app_shutdown_rejects_new_ipc_registration','user_ownership_actions_validate_epoch_and_intervention_is_only_notification',
 'authentication_rejects_secret_version_instance_before_registration','eight_waiting_reads_allow_send_and_ninth_read_is_rejected',
 'sixteen_requests_reject_seventeenth_but_accept_cancellation','thirty_two_authenticated_connections_are_bounded',
 'pending_handshakes_are_bounded_and_partial_eof_does_not_harm_other_clients','partial_frame_survives_dispatch_completion',
 'response_queue_overflow_closes_connection_with_bounded_memory','stalled_writer_still_processes_cancel_and_expires_without_harming_other_clients',
 'concurrent_calls_preserve_request_order_on_the_wire','stdio_online_output_errors_then_offline_has_no_cached_identity',
 'stdio_cancellation_and_eof_release_pending_reads_and_ipc','authentication_and_version_failures_are_not_reported_as_offline',
 'offline_start_rediscovers_a_new_app_without_restarting_stdio','all_tool_parameters_are_checked_before_dispatch',
];
export const REQUIRED_NODE_FILES=['integration.test.mjs','ownership.test.mjs','sudo.test.mjs','stdio.test.mjs','receipt.test.mjs'];
const REQUIRED_CASES=['phase3-integration','phase3-ownership','phase3-sudo'];
export function parseRust(text,required=REQUIRED_RUST,min=0) {
 const results=[...text.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;/g)];
 if(!results.length)fail('rust_results_missing');let passed=0;
 for(const row of results){if(+row[2])fail('rust_failed');if(+row[3])fail('rust_skipped');passed+=+row[1];}
 for(const name of required)if(!text.split(/\r?\n/).some(line=>line.startsWith('test ')&&line.endsWith(' ... ok')&&(line.slice(5,-7)===name||line.slice(5,-7).endsWith('::'+name))))fail('rust_required_missing:'+name);
 if(passed<min)fail('rust_required_count_missing');return {passed,failed:0,skipped:0};
}
export function parseTap(text) {
 const count=key=>{const rows=[...text.matchAll(new RegExp('^# '+key+' (\\d+)\\s*$','gm'))];if(rows.length!==1)fail('tap_totals_missing:'+key);return +rows[0][1];};
 const tests=count('tests'),passed=count('pass');if(count('fail')||count('cancelled'))fail('tap_failed');if(count('skipped'))fail('tap_skipped');if(!tests||tests!==passed)fail('tap_count_mismatch');return {passed,failed:0,skipped:0};
}
export function validateScope(before,after,mode) {
 if(JSON.stringify(before.environment)!==JSON.stringify(after.environment))fail('environment_changed');
 const collector=new Set(['rust/scripts/verify-phase-3.ps1','rust/tests/phase3/receipt.mjs','rust/tests/phase3/receipt.test.mjs']);
 const names=new Set([...Object.keys(before.files),...Object.keys(after.files)]);
 for(const name of names)if(before.files[name]!==after.files[name]&&(mode!=='collector_only'||!collector.has(name)))fail(mode==='collector_only'?'collector_scope_mismatch:'+name:'source_changed:'+name);
}
export async function validateEvidence(paths,required=REQUIRED_CASES) {
 const found=new Set();
 for(const path of paths){let report;try{report=JSON.parse(await readFile(path,'utf8'));}catch{fail('evidence_missing:'+path);}
  if(!report.process?.normalExit||report.process.forcedCleanup||report.process.failure||report.process.descendantAudit!=='verified'||report.process.descendants?.some(p=>!p.exited))fail('evidence_cleanup_failed');
  if(!report.fixtureCleanup?.ssh||!report.fixtureCleanup?.adapters)fail('fixture_survived');
  if(!Array.isArray(report.serverAudit)||!report.serverAudit.length||report.serverAudit.some(a=>!a.serverObserved))fail('server_audit_missing');
  for(const outcome of report.outcomes??[]){if(!outcome.passed)fail('evidence_case_failed');found.add(outcome.name);}
 }
 for(const name of required)if(!found.has(name))fail('evidence_required_missing:'+name);
 return {cases:[...found],manualSudo:'pending'};
}
async function filesBelow(root){let children;try{children=await readdir(root,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}const result=[];for(const entry of children){if(entry.isSymbolicLink())fail('inventory_symlink');const path=join(root,entry.name);if(entry.isDirectory()){if(!['node_modules','target','dist','dist-acceptance','.test-output'].includes(entry.name))result.push(...await filesBelow(path));}else result.push(path);}return result.sort();}
async function hash(path){return createHash('sha256').update(await readFile(path)).digest('hex');}
export async function snapshot(repo) {
 const files={};const roots=['rust/crates','rust/app/src','rust/app/src-tauri/src','rust/app/src-tauri/acceptance','rust/app/src-tauri/capabilities','rust/app/src-tauri/icons','rust/app/src-tauri/tests','rust/app/tests','rust/tests','rust/scripts','rust/.cargo','.cargo'];
 const fixed=['rust/Cargo.toml','rust/Cargo.lock','rust/rust-toolchain.toml','rust-toolchain.toml','rust/app/Cargo.toml','rust/app/package.json','rust/app/package-lock.json','rust/app/tsconfig.json','rust/app/tsconfig.test.json','rust/app/vite.acceptance.config.ts','rust/app/index.html','rust/app/acceptance/index.html','rust/app/src-tauri/Cargo.toml','rust/app/src-tauri/build.rs','rust/app/src-tauri/tauri.conf.json'];
 for(const root of roots)for(const path of await filesBelow(join(repo,root))){const name=relative(repo,path).replaceAll('\\','/');if(/\.(rs|toml|lock|json|ts|js|mjs|ps1|css|html|ico)$/.test(name))files[name]=await hash(path);}
 for(const name of fixed){try{if((await stat(join(repo,name))).isFile())files[name]=await hash(join(repo,name));}catch(e){if(e.code!=='ENOENT')throw e;}}
 let webview=[];try{webview=(await readdir(join(process.env['ProgramFiles(x86)']??'C:/Program Files (x86)','Microsoft/EdgeWebView/Application'))).filter(n=>/^\d+\./.test(n)).sort();}catch{}
 const tool=name=>process.platform==='win32'?join(process.env.USERPROFILE,'.cargo/bin',name+'.exe'):name;
 const cargo=execFileSync(tool('cargo'),['+stable','--version'],{encoding:'utf8',windowsHide:true}).trim(),rustc=execFileSync(tool('rustc'),['+stable','--version'],{encoding:'utf8',windowsHide:true}).trim();
 return {files:Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b))),environment:{node:process.version,cargo,rustc,platform:process.platform,arch:process.arch,os:os.release(),webview,rustflags:process.env.RUSTFLAGS??'',targetDir:process.env.CARGO_TARGET_DIR??''}};
}
export async function archive(repo,dir) {
 const sources=['rust/target/debug/baton.exe','rust/target/debug/baton.pdb','rust/target/debug/baton-adapter.exe','rust/target/debug/baton_adapter.pdb','rust/target/debug/baton-ui-acceptance.exe','rust/target/debug/baton_ui_acceptance.pdb','rust/Cargo.lock','rust/app/package-lock.json'];
 for(const root of ['rust/app/dist','rust/app/dist-acceptance'])for(const path of await filesBelow(join(repo,root)))sources.push(relative(repo,path).replaceAll('\\','/'));
 const result=[];for(const source of sources){const destination=join(dir,'build',source);await mkdir(dirname(destination),{recursive:true});await copyFile(join(repo,source),destination);result.push({source,path:destination,sha256:await hash(destination)});}return result;
}
export async function finalize(receipt) {
 validateScope(receipt.before,receipt.after,receipt.mode??'fresh');
 const required=['fmt','clippy','rust-tests','ui-tests','ui-build','acceptance-assets','product-build','adapter-build','acceptance-build','node-tests'];
 const logs=new Map();for(const step of receipt.commands??[]){if(step.exitCode!==0)fail('command_failed:'+step.name);let text;try{text=await readFile(step.log,'utf8');}catch{fail('command_log_missing');}if(step.sha256&&step.sha256!==await hash(step.log))fail('command_log_changed');step.sha256=await hash(step.log);logs.set(step.name,text);}
 for(const name of required)if(!logs.has(name))fail('command_required_missing:'+name);
 for(const file of REQUIRED_NODE_FILES)if(!receipt.nodeFiles?.some(path=>path.replaceAll('\\','/').endsWith('/'+file)))fail('node_required_file_missing:'+file);
 const rust=parseRust(logs.get('rust-tests'),REQUIRED_RUST,150),ui=parseTap(logs.get('ui-tests')),node=parseTap(logs.get('node-tests'));
 for(const item of receipt.artifacts??[]){let digest;try{digest=await hash(item.path);}catch{fail('artifact_missing');}if(digest!==item.sha256)fail('artifact_changed');}
 for(const executable of ['baton.exe','baton-adapter.exe','baton-ui-acceptance.exe'])if(!receipt.artifacts?.some(a=>a.source.endsWith('/'+executable)))fail('artifact_required_missing');
 const paths=[...logs.get('node-tests').matchAll(/^# Phase 3 evidence: (.+)\r?$/gm)].map(m=>m[1].trim());
 if(receipt.mode!=='collector_only')receipt.evidence=paths;
 const evidence=await validateEvidence(receipt.evidence??[]);
 receipt.results={rust,ui,node,evidence};receipt.status='automated_passed_manual_pending';receipt.manual={sudoModel:'pending',phase2Dpi:'deferred',otherOperatingSystems:'not_tested'};return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [action,first,second]=process.argv.slice(2);
  if(action==='snapshot')await writeFile(second,JSON.stringify(await snapshot(first),null,2));
  else if(action==='archive')await writeFile(join(second,'artifacts.json'),JSON.stringify(await archive(first,second),null,2));
  else if(action==='finalize'){const receipt=JSON.parse(await readFile(first,'utf8'));try{await finalize(receipt);}catch(e){receipt.status='failed';receipt.failure=e.message;throw e;}finally{await writeFile(first,JSON.stringify(receipt,null,2));}console.log(receipt.status);}
  else if(action==='reuse'){const prior=JSON.parse(await readFile(first,'utf8'));prior.after=await snapshot(second);prior.mode='collector_only';prior.reusedFrom=first;await finalize(prior);await writeFile(process.argv[5],JSON.stringify(prior,null,2));console.log(prior.status);}
  else fail('unknown_action');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
