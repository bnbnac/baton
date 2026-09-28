import {readFile,writeFile} from 'node:fs/promises';import {dirname} from 'node:path';
import {checkTap,checkRust,checkDesktop,checkIdentity,checkManual,terminalCases} from './evidence.mjs';
const path=process.argv[2];const receipt=JSON.parse(await readFile(path,'utf8'));let exit=1;
try{
 const required=['fmt','clippy','rust-tests','ui-tests','ui-build','acceptance-assets','product-build','acceptance-build','node-tests','openssh','manual-smoke'];
 for(const name of required){const entries=receipt.commands.filter(c=>c.name===name);if(entries.length!==1||entries[0].exitCode!==0)throw Error(`command_missing_or_failed:${name}`);}
 const log=async name=>readFile(receipt.commands.find(c=>c.name===name).log,'utf8');
 const core=checkRust(await log('rust-tests'),['control_io','geometry','input','lifecycle','model','numbers','output','ownership','queries','races'],['model_1000_seeds_200_events','late_success_after_cancel_cannot_reopen_the_reserved_session','output_pump_drains_existing_output_and_ack_wakes_the_final_blocked_byte']);
 const ui=checkTap(await log('ui-tests'),['auth secrets clear on submission and cannot carry to another challenge','old composition cannot survive reclaim while a new composition can','paste chunks preserve UTF8 and one epoch; first denial cancels remaining chunks','failed rendering prevents later frames from being acknowledged']);
 const node=checkTap(await log('node-tests'),['password','host-reject','wrong-password','encrypted-key','wrong-key-passphrase','interactive-two-rounds','password-then-interactive','host-cancel','cancel-before-auth','cancel-between-rounds','cancel-late-success','cancel-before-pty','pty-reject','shell-reject','remote-exit','tcp-close','four shells on two independent servers remain isolated after closing A','real WebView terminal and geometry cases have complete wire and shutdown evidence','normal desktop close observes every WebView descendant exit before fixture cleanup',...['auth-wait','output-wait','before-cleanup'].map(s=>`interrupted ${s} runner releases only its own app and WebViews`),'copied verification runner propagates an external command exit code']);
 if(core.passed<98||ui.passed<10||node.passed<31)throw Error('required_test_inventory_shrank');
 const desktop=JSON.parse(await readFile(receipt.desktopReport,'utf8'));checkDesktop(desktop,[...terminalCases,'geometry']);
 const openssh=JSON.parse(await readFile(receipt.opensshReport,'utf8'));checkDesktop(openssh,['interactive-openssh']);
 const cleanup=JSON.parse(await readFile(receipt.fixtureCleanup,'utf8'));if(cleanup.remaining!==0||!cleanup.id||!cleanup.otherId)throw Error('fixture_cleanup_unverified');
 const smoke=JSON.parse(await readFile(receipt.manualSmokeReport,'utf8'));checkDesktop(smoke,['manual-smoke']);
 const smokeCleanup=JSON.parse(await readFile(receipt.manualSmokeCleanup,'utf8'));if(smokeCleanup.remaining!==0||!smokeCleanup.id||!smokeCleanup.otherId)throw Error('manual_fixture_cleanup_unverified');
 checkIdentity(receipt.identity,receipt.identityAfter);
 receipt.counts={rust:core,ui,node,desktop:desktop.outcomes.length,openssh:openssh.outcomes.length,manualHarness:smoke.outcomes.length};receipt.webviewVersion=desktop.webviewVersion;
 const manual=process.argv[3]?JSON.parse(await readFile(process.argv[3],'utf8')):null;
 const complete=await checkManual(manual,receipt.identity,process.argv[3]?dirname(process.argv[3]):dirname(path));
 receipt.status=complete?'passed':'manual_pending';receipt.failure=null;exit=complete?0:2;
}catch(error){receipt.status='failed';receipt.failure=error.message;}
await writeFile(path,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:receipt.status,failure:receipt.failure,counts:receipt.counts}));process.exitCode=exit;
