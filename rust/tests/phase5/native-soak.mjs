import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,readFile,writeFile,appendFile,access,rename} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {release as osRelease} from 'node:os';
import {observe,deadline,stop} from '../helpers/process.mjs';
import {Adapter,data} from '../phase3/stdio.mjs';
import {LogOracle} from './soak-oracle.mjs';
import {NativeMailbox,runPhases,memoryVerdict} from './native-soak-control.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
if(!process.argv[2]||!process.argv[3]||!['smoke','release'].includes(process.argv[4]))throw Error('usage: native-soak.mjs fresh-directory config.json smoke|release');
const out=resolve(process.argv[2]),configPath=resolve(process.argv[3]),mode=process.argv[4],condition='native-ui-detached';
const outputRelative=relative(join(root,'artifacts'),out);
assert.ok(outputRelative&&!outputRelative.startsWith('..')&&!isAbsolute(outputRelative),'output_must_be_fresh_artifact_directory');
const config=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
const seconds=mode==='release'?7200:180;
assert.ok(config.nativeDriver==='codex-computer-use','native_driver_required');
assert.ok(config.imageId?.match(/^sha256:[a-f0-9]{64}$/),'immutable_image_required');
for(const key of ['app','adapter'])assert.ok(config[key]?.sha256?.match(/^[a-f0-9]{64}$/)&&config[key]?.path,'binary_identity_required');
await mkdir(out);
const playwrightPath=config.playwrightPath??'C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const pwsh=config.pwsh??'C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const appExe=resolve(root,config.app.path),adapterExe=resolve(root,config.adapter.path);
const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const owner=randomUUID();
const summary={status:'preparing',mode,condition,requestedSeconds:seconds,runnerPid:process.pid,owner,startedUtc:new Date().toISOString(),sessions:[],samples:[],diagnostics:[],actions:[],checks:{rates:false,audit:false,health:false,transitions:false}};
const adapters=[],fixtures=[],sessions=[];let app,browser,page,port,adapterIdentities=[],stableIdentities,interrupted=false;
const mailbox=new NativeMailbox(join(out,'native'),owner);
let loadStart,nextSample=0,nextSave=0,transitionSession=null;
summary.fixtures=fixtures;
const endpoint=join(out,'local/BatonRust/v2');
const receiptPath=join(out,'process.json');
process.on('SIGINT',()=>{interrupted=true;});process.on('SIGTERM',()=>{interrupted=true;});
async function save(){summary.sessions=sessions.map(s=>({id:s.id,index:s.index,adapter:s.adapter,stream:s.stream,count:s.oracle.count,bytes:s.oracle.bytes,audits:s.audits}));const tmp=join(out,'summary.tmp');await writeFile(tmp,JSON.stringify(summary,null,2));await rename(tmp,join(out,'summary.json'));}
async function docker(...args){return (await execute('docker',args,{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024})).stdout.trim();}
async function checkStop(){if(interrupted)throw Error('interrupted');try{await access(join(out,'stop'));throw Error('stop_requested');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function wait(check,label,ms=15000,honorStop=true){const end=Date.now()+ms;while(Date.now()<end){if(honorStop)await checkStop();const value=await check();if(value)return value;await pause(100);}throw Error(label+'_timeout');}
// A stop request ends workload activity, not shutdown/cleanup observation.
async function receipt(){return wait(async()=>{try{return JSON.parse(await readFile(receiptPath,'utf8'));}catch(e){if(e.code==='ENOENT')return false;throw e;}},'process_receipt',15000,false);}
async function freePort(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function status(index){return data(await adapters[index].tool('status'));}
async function sessionStatus(s){const p=(await status(s.adapter)).sessions.find(p=>p.session_id===s.id);assert.ok(p,'missing_session');return p;}
function identity(s){return {session_id:s.id,control_epoch:s.epoch};}
async function command(s,text,duplicate=false){const args={...identity(s),request_id:randomUUID().replaceAll('-',''),text};const first=data(await adapters[s.adapter].tool('send_text',args));assert.equal(first.result,'delivered',JSON.stringify(first));if(duplicate){const again=data(await adapters[s.adapter].tool('send_text',args));assert.deepEqual(again,first);}const enter=data(await adapters[s.adapter].tool('send_key',{...identity(s),request_id:randomUUID().replaceAll('-',''),key:'Enter'}));assert.equal(enter.result,'delivered',JSON.stringify(enter));}
async function pump(){const results=await Promise.allSettled(sessions.filter(s=>s!==transitionSession).map(async s=>{const p=data(await adapters[s.adapter].tool('read_output',{...identity(s),stream_id:s.stream,cursor:s.cursor,limit:32768,wait_ms:0}));assert.ok(Number.isSafeInteger(p.next_cursor),'bad_read:'+JSON.stringify(p));assert.ok(p.oldest_cursor<=s.cursor,'output_gap');const before=s.oracle.count;s.oracle.push(p.text??'');s.cursor=p.next_cursor;if(s.oracle.count>before)s.lastLog=Date.now();assert.ok(Date.now()-s.lastLog<15000,'stalled_session_'+s.index);}));for(const r of results)if(r.status==='rejected')throw r.reason;}
async function audit(round){for(const s of sessions){const token=`AUDIT_${s.index}_${round}`;await command(s,`printf '%s\\n' '${token}' >> /tmp/soak-audit-${s.index}`,true);s.audits.push(token);}summary.actions.push({type:'audit',round,utc:new Date().toISOString()});}
async function verifyAudits(){const observations=[];for(const s of sessions){const content=await docker('exec',fixtures[s.index%2].id,'cat',`/tmp/soak-audit-${s.index}`);const actual=content.split(/\r?\n/);observations.push({index:s.index,session:s.id,actual});assert.deepEqual(actual,s.audits,'audit mismatch '+s.index);}await writeFile(join(out,'audit-observations.json'),JSON.stringify(observations,null,2));}
async function processSnapshot(){
 const r=await receipt();await writeFile(join(out,'memory-input.json'),JSON.stringify({...r,adapters:adapterIdentities}));
 const processes=JSON.parse((await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/sample-test-process-roles.ps1'),'-Evidence',join(out,'memory-input.json')],{windowsHide:true,timeout:15000})).stdout);
 for(const [role,count] of [['app',1],['renderer',1],['adapter',32]])assert.equal(processes.filter(p=>p.role===role).length,count,'role_count_'+role);
 const current=processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(p=>`${p.pid}:${p.startedTicks}`).sort();
 if(stableIdentities)assert.deepEqual(current,stableIdentities,'owned_process_changed');else stableIdentities=current;
 return {processes,privateBytes:processes.reduce((n,p)=>n+p.privateBytes,0),workingSetBytes:processes.reduce((n,p)=>n+p.workingSetBytes,0)};
}
async function memory(start){
 const before=(performance.now()-start)/1000,result=await processSnapshot();
 const debugPort=JSON.parse((await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/check-test-debug-port.ps1'),'-Port',String(port)],{windowsHide:true,timeout:15000})).stdout);
 assert.equal(debugPort.established,0,'debugger_connection_present');assert.ok(debugPort.listening>=1,'debug_listener_missing');
 const elapsed=(performance.now()-start)/1000;
 if(elapsed>=seconds)return; // Never insert an endpoint/GC sample into a natural window.
 const sample={elapsed,phase:'natural',debugPort,durationSeconds:elapsed-before,...result};summary.samples.push(sample);await appendFile(join(out,'memory.jsonl'),JSON.stringify(sample)+'\n');
}
async function tick(){
 await checkStop();await pump();const elapsed=(performance.now()-loadStart)/1000;
 if(elapsed>=seconds)return false;
 if(elapsed>=nextSample){await memory(loadStart);nextSample=(Math.floor((performance.now()-loadStart)/1000/30)+1)*30;}
 summary.elapsedSeconds=(performance.now()-loadStart)/1000;
 if(summary.elapsedSeconds>=nextSave){await save();nextSave=summary.elapsedSeconds+10;}
 return true;
}
async function native(action,verify,roundDeadline){
 const timeoutMs=Math.min(45000,roundDeadline-performance.now());assert.ok(timeoutMs>0,'native_round_overrun');
 const request=await mailbox.issue({...action,appExecutable:appExe},timeoutMs);
 let observed;while(true){assert.ok(await tick(),'normal_deadline_during_action');if(await mailbox.completed(request)){observed=await verify();if(observed)break;}await pause(250);}
 await mailbox.finish(request,{verified:true,...observed});return observed;
}
async function transition(round){
 const s=sessions[round%16],roundDeadline=loadStart+(round*60+55)*1000;
 // A hidden terminal may still report its previous visit's geometry. Select it
 // first, then allow its geometry to settle before asking for a window resize.
 let geometry,stableSince;
 const initial=await native({action:'select',round,index:s.index,label:`soak-${s.index.toString().padStart(2,'0')}`,session:s.id},async()=>{
  const p=await sessionStatus(s);assert.equal(p.state,'agent_owned');
  if(!geometry||geometry.columns!==p.geometry.columns||geometry.rows!==p.geometry.rows){geometry=p.geometry;stableSince=performance.now();return false;}
  return performance.now()-stableSince>=750?{selectionEvidence:'operator_ack',selectedSession:s.id,geometry}:false;
 },roundDeadline);
 const resized=await native({action:'resize',round,index:s.index,label:`soak-${s.index.toString().padStart(2,'0')}`,session:s.id,epoch:s.epoch,previousGeometry:initial.geometry,windowMode:round%2===0?'maximized':'restored'},async()=>{
  const p=await sessionStatus(s);return p.geometry.columns!==initial.geometry.columns||p.geometry.rows!==initial.geometry.rows?{geometry:p.geometry}:false;
 },roundDeadline);
 const file=`/tmp/soak-size-${s.index}-${round}`;await command(s,`stty size > ${file}`);
 const remote=await wait(async()=>{await tick();return (await docker('exec',fixtures[s.index%2].id,'sh','-c',`cat ${file} 2>/dev/null || true`))||false;},'remote_geometry');
 assert.deepEqual(remote.split(/\s+/).map(Number),[resized.geometry.rows,resized.geometry.columns]);
 summary.actions.push({type:'resize',round,index:s.index,...resized,remote,utc:new Date().toISOString()});
 // Only this transitioning session may stop streaming to the old owner.
 transitionSession=s;
 const reclaimed=await native({action:'reclaim',round,index:s.index,session:s.id,epoch:s.epoch},async()=>{
  const p=await sessionStatus(s);return p.state==='user_owned'&&p.control_epoch>s.epoch&&!p.stream_id?{epoch:p.control_epoch}:false;
 },roundDeadline);
 const previous=s.adapter,targetIndex=(previous+16)%32,target=await status(targetIndex),oldStream=s.stream;
 const assigned=await native({action:'handoff',round,index:s.index,session:s.id,epoch:reclaimed.epoch,targetConnection:target.connection_id,adapter:targetIndex},async()=>{
  const p=(await status(targetIndex)).sessions.find(p=>p.session_id===s.id);return p?.state==='agent_owned'&&p.control_epoch>reclaimed.epoch&&p.stream_id&&p.stream_id!==oldStream?{epoch:p.control_epoch,stream:p.stream_id}:false;
 },roundDeadline);
 s.adapter=targetIndex;s.epoch=assigned.epoch;s.stream=assigned.stream;s.cursor=0;s.oracle.reset();s.lastLog=Date.now();transitionSession=null;
 const old=(await status(previous)).sessions;assert.ok(!old.some(p=>p.session_id===s.id),'old_owner_still_assigned');
 summary.actions.push({type:'handoff',round,index:s.index,previous,adapter:targetIndex,session:s.id,...assigned,utc:new Date().toISOString()});
}
async function normal(){
 summary.status='running';summary.loadStartedUtc=new Date().toISOString();for(const s of sessions)s.startCount=s.oracle.count;
 loadStart=performance.now();let round=0;await save();
 try{
  while((performance.now()-loadStart)/1000<seconds){
   if(!await tick())break;const elapsed=(performance.now()-loadStart)/1000;
   if(round<seconds/60&&elapsed>=round*60){
    const health=await Promise.all(adapters.map((_,i)=>status(i)));for(let i=0;i<32;i++){assert.equal(health[i].app_state,'online');assert.equal(health[i].connection_id,summary.connections[i]);}
    await audit(round);await transition(round);round++;
   }
   await pause(250);
  }
 }finally{
  summary.elapsedSeconds=(performance.now()-loadStart)/1000;summary.loadFinishedUtc=new Date().toISOString();
  // Freeze raw normal-phase evidence before any browser reconnection.
  await writeFile(join(out,'normal-boundary.json'),JSON.stringify({elapsedSeconds:summary.elapsedSeconds,finishedUtc:summary.loadFinishedUtc,samples:summary.samples.length,rounds:round},null,2));await save();
 }
 await pump();await verifyAudits();summary.auditVerified=true;assert.equal(round,seconds/60,'missing_round');
 for(const type of ['resize','handoff','audit'])assert.equal(summary.actions.filter(a=>a.type===type).length,seconds/60,'missing_'+type);
 for(const s of sessions)assert.equal((await sessionStatus(s)).state,'agent_owned');
 summary.rates=sessions.map(s=>({index:s.index,records:s.oracle.count-s.startCount,bytesPerSecond:(s.oracle.count-s.startCount)*(1016+String(s.index).length+8)/summary.elapsedSeconds}));
 for(const r of summary.rates)assert.ok(r.bytesPerSecond>=1024,'insufficient_log_rate_'+r.index);
 summary.checks={rates:true,audit:true,health:true,transitions:true};
 summary.memory=mode==='release'?memoryVerdict(summary.samples,summary.elapsedSeconds):{passed:true,acceptance:false,reason:'smoke_duration'};
 return {passed:summary.memory.passed,memory:summary.memory};
}
async function overload(){
 await checkStop();assert.ok(summary.loadFinishedUtc,'measurement_not_frozen');summary.status='overload';await save();
 browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);summary.playwrightReconnectedUtc=new Date().toISOString();
 page=await wait(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/'),'product_page');
 const victim=sessions[0],burst="for j in $(seq 1 40); do head -c 32768 /dev/zero | tr '\\000' Z; sleep 0.1; done";
 await command(victim,burst+"; printf '\\nCONTROL_DONE\\n'");
 let tail='';await wait(async()=>{const p=data(await adapters[victim.adapter].tool('read_output',{...identity(victim),stream_id:victim.stream,cursor:victim.cursor,limit:32768,wait_ms:100}));assert.ok(p.oldest_cursor<=victim.cursor);victim.cursor=p.next_cursor;tail=(tail+(p.text??'')).slice(-65536);return tail.includes('CONTROL_DONE');},'overload_control',20000);
 assert.equal((await sessionStatus(victim)).state,'agent_owned');
 await page.evaluate(id=>{const original=window.fetch;window.__soakDroppedAcks=0;window.fetch=function(url,init){if(String(url).endsWith('/ack_output')&&JSON.parse(init.body).request.binding.session===id){window.__soakDroppedAcks++;return new Promise(()=>{});}return original.call(this,url,init);};},victim.id);
 await wait(async()=>await page.evaluate(()=>window.__soakDroppedAcks>0),'ack_block_observed');
 assert.equal((await sessionStatus(victim)).state,'agent_owned');await command(victim,burst);
 const closed=await wait(async()=>{const p=await sessionStatus(victim);return p.state==='closed'?p:false;},'overload_closed',20000);
 const droppedAcks=await page.evaluate(()=>window.__soakDroppedAcks);assert.ok(droppedAcks>0);
 for(const s of sessions.slice(1))assert.equal((await sessionStatus(s)).state,'agent_owned','unaffected_session_closed');
 summary.overload={passed:true,state:closed.state,victim:victim.id,controlBurstPassed:true,burstBytes:40*32768,droppedAcks,unaffectedAlive:15};return summary.overload;
}
async function shutdown(){
 summary.status='shutting_down';await save();await browser?.close();browser=undefined;page=undefined;
 const r=await receipt();await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/close-test-process.ps1'),'-ProcessId',String(r.pid),'-Executable',appExe,'-StartedTicks',r.startedTicks],{windowsHide:true,timeout:5000});
 assert.equal((await deadline(app.closed,15000,'normal_exit')).code,0);summary.process=await receipt();assert.ok(summary.process.normalExit&&!summary.process.forcedCleanup&&summary.process.descendantAudit==='verified');
 for(let i=0;i<32;i++){assert.equal((await status(i)).app_state,'offline');assert.equal(await adapters[i].eof(),0);assert.equal(adapters[i].stderr,'');}
 return {passed:true,adapterEof:32};
}
async function createSession(index){
 const fixture=fixtures[index%2];await page.getByLabel('이름',{exact:true}).fill(`soak-${index.toString().padStart(2,'0')}`);
 await page.getByLabel('서버 주소',{exact:true}).fill('127.0.0.1');await page.getByLabel('포트',{exact:true}).fill(String(fixture.port));await page.getByLabel('사용자 이름',{exact:true}).fill('batonfixture');
 await page.getByRole('button',{name:'연결',exact:true}).click();await page.getByRole('button',{name:'이 연결에서 신뢰',exact:true}).waitFor();assert.ok((await page.locator('.challenge pre').innerText()).includes(fixture.fingerprint));await page.getByRole('button',{name:'이 연결에서 신뢰',exact:true}).click();await page.locator('.challenge input[type=password]').fill('baton-fixture-only');await page.getByRole('button',{name:'인증',exact:true}).click();
 await page.getByLabel('전달할 MCP 연결').selectOption((await status(index)).connection_id);await page.getByRole('button',{name:'에이전트에 전달',exact:true}).click();
 const assigned=await wait(async()=>{const a=(await status(index)).sessions;return a.find(s=>s.state==='agent_owned');},'initial_handoff');
 const s={index,id:assigned.session_id,adapter:index,epoch:assigned.control_epoch,stream:assigned.stream_id,cursor:0,oracle:new LogOracle(index),lastLog:Date.now(),audits:[]};sessions.push(s);
 await command(s,`stty -echo -onlcr; PS1=''; : > /tmp/soak-audit-${index}; bash /tmp/soak-stream.sh ${index} &`);console.log('READY_SESSION '+index);
}
try{
 await mailbox.init();summary.config=config;summary.configSha256=createHash('sha256').update(await readFile(configPath)).digest('hex');
 summary.sources={};for(const path of ['rust/tests/phase5/native-soak.mjs','rust/tests/phase5/native-soak-launch.mjs','rust/tests/phase5/native-soak-control.mjs','rust/tests/phase5/native-soak-ui.mjs','rust/tests/phase5/native-soak-verify.mjs','rust/app/src/main.ts','rust/app/src/connections/view.ts','rust/scripts/check-test-debug-port.ps1','rust/scripts/sample-test-process-roles.ps1','rust/tests/phase5/soak-oracle.mjs','rust/tests/phase5/soak-stream.sh','rust/scripts/sample-test-memory.ps1','rust/scripts/close-test-process.ps1','rust/scripts/desktop-process.ps1','rust/tests/phase2/desktop-supervisor.mjs','rust/tests/phase3/stdio.mjs','rust/tests/helpers/process.mjs','tests/linux-ssh/Dockerfile'])summary.sources[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
 summary.binaries={};for(const [key,path] of Object.entries({app:appExe,adapter:adapterExe}))summary.binaries[key]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
 for(const key of ['app','adapter'])assert.equal(summary.binaries[key].sha256,config[key].sha256,'binary_mismatch_'+key);
 if(mode==='release'){
  assert.ok(config.smokeEvidence,'smoke_evidence_required');const smoke=JSON.parse((await readFile(resolve(root,config.smokeEvidence),'utf8')).replace(/^\uFEFF/,''));
  const verification=JSON.parse(await readFile(join(dirname(resolve(root,config.smokeEvidence)),'verified.json'),'utf8'));
  assert.equal(verification.valid,true);assert.equal(verification.mode,'smoke');assert.equal(verification.summarySha256,createHash('sha256').update(await readFile(resolve(root,config.smokeEvidence))).digest('hex'),'unverified_smoke');
  assert.equal(smoke.status,'smoke_passed');assert.ok(smoke.finishedUtc);assert.deepEqual(smoke.sources,summary.sources,'sources_changed_after_smoke');
  for(const key of ['app','adapter'])assert.equal(smoke.binaries[key].sha256,summary.binaries[key].sha256,'binary_changed_after_smoke');
  assert.equal(smoke.imageId,config.imageId);assert.deepEqual(smoke.cleanup,{normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0});
 }
 const imageId=await docker('image','inspect',config.imageId,'--format','{{.Id}}');assert.equal(imageId,config.imageId);summary.imageId=imageId;await save();
 for(let i=0;i<2;i++){
  const f={name:`baton-memory-${owner.slice(0,8)}-${i}`,attempted:true};fixtures.push(f);
  f.id=await docker('run','-d','--name',f.name,'--label','baton.soak='+owner,'-p','127.0.0.1::22',imageId);
  const inspect=JSON.parse(await docker('inspect',f.id))[0];assert.equal(inspect.Config.Labels['baton.soak'],owner);f.image=inspect.Image;const binding=inspect.NetworkSettings.Ports['22/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');f.port=Number(binding.HostPort);
  f.fingerprint=(await docker('exec',f.id,'ssh-keygen','-lf','/etc/ssh/ssh_host_ed25519_key.pub')).match(/SHA256:\S+/)[0];
  await docker('cp',join(root,'rust/tests/phase5/soak-stream.sh'),f.id+':/tmp/soak-stream.sh');
 }
 summary.fixtures=fixtures;await mkdir(join(out,'local'));
 for(let i=0;i<32;i++){const a=new Adapter(endpoint,{executable:adapterExe,cwd:out});adapters.push(a);await a.initialize();}
 const log=await open(join(out,'process.log'),'wx');port=await freePort();summary.debugPort=port;
 try{app=observe(spawn(process.execPath,[join(root,'rust/tests/phase2/desktop-supervisor.mjs'),'-File',join(root,'rust/scripts/desktop-process.ps1'),'-Executable',appExe,'-Evidence',receiptPath,'-OwnerPid',String(process.pid),'-TimeoutSeconds',String(seconds+900)],{detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PATH:dirname(pwsh)+';'+process.env.PATH,LOCALAPPDATA:join(out,'local'),BATON_WEBVIEW_DATA:join(out,'webview'),WEBVIEW2_USER_DATA_FOLDER:join(out,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`}}));}finally{await log.close();}
 await wait(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}},'webview_ready');browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 page=await wait(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/'),'product_page');page.setDefaultTimeout(15000);
 summary.connections=[];for(let i=0;i<32;i++)summary.connections.push(await wait(async()=>{const s=await status(i);return s.app_state==='online'?s.connection_id:false;},'adapter_online_'+i));
 summary.environment={platform:process.platform,arch:process.arch,osRelease:osRelease(),node:process.version,webview:browser.version(),playwright:JSON.parse(await readFile(join(dirname(playwrightPath),'package.json'),'utf8')).version};
 if(mode==='release'){const smoke=JSON.parse((await readFile(resolve(root,config.smokeEvidence),'utf8')).replace(/^\uFEFF/,''));assert.deepEqual(summary.environment,smoke.environment,'environment_changed_after_smoke');}
 for(let i=0;i<16;i++){await createSession(i);for(const s of sessions)s.lastLog=Date.now();await pump();await save();}
 await wait(async()=>{await pump();return sessions.every(s=>s.oracle.count>0);},'all_streams');
 const r0=await receipt();await writeFile(join(out,'initial-memory-input.json'),JSON.stringify(r0));
 const initial=JSON.parse((await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/sample-test-memory.ps1'),'-Evidence',join(out,'initial-memory-input.json'),'-AdapterPids',adapters.map(a=>a.process.child.pid).join(',')],{windowsHide:true,timeout:15000})).stdout);
 adapterIdentities=initial.processes.filter(p=>adapters.some(a=>a.process.child.pid===p.pid));assert.equal(adapterIdentities.length,32);summary.adapterIdentities=adapterIdentities;
 await browser.close();assert.equal(browser.isConnected(),false);browser=undefined;page=undefined;
 summary.playwrightDisconnectedUtc=new Date().toISOString();summary.instrumentation={rawCdpSessions:0,forcedGcCalls:0,jsProbes:0,debugListenerEnabled:true};
 await processSnapshot();await pump();
 summary.phases=await runPhases({normal,overload,shutdown});
 for(const [path,hash] of Object.entries(summary.sources))assert.equal(createHash('sha256').update(await readFile(join(root,path))).digest('hex'),hash,'source_changed_'+path);
 for(const b of Object.values(summary.binaries))assert.equal(createHash('sha256').update(await readFile(b.path)).digest('hex'),b.sha256,'binary_changed');
 summary.status=summary.phases.passed?(mode==='release'?'passed':'smoke_passed'):'failed';
 if(!summary.phases.passed)process.exitCode=1;
}catch(e){summary.status='failed';summary.failure=String(e);summary.failureStack=e.stack;process.exitCode=1;}
finally{
 const failures=[];
 for(const [label,op] of [['browser',()=>browser?.close()],...adapters.map((a,i)=>['adapter'+i,()=>a.cleanup()]),['app',()=>app&&stop(app)]])try{await op();}catch(e){failures.push(label+':'+e);}
 for(const f of fixtures)try{
  if(!f.id){const found=await docker('ps','-aq','--filter','label=baton.soak='+owner,'--filter','name=^/'+f.name+'$');if(found){assert.equal(found.split('\n').length,1);f.id=JSON.parse(await docker('inspect',found))[0].Id;}}
  if(f.id){const actual=JSON.parse(await docker('inspect',f.id))[0];assert.equal(actual.Id,f.id);assert.equal(actual.Name,'/'+f.name);assert.equal(actual.Config.Labels['baton.soak'],owner);await docker('rm','-f',f.id);f.removed=true;}
 }catch(e){failures.push('fixture:'+e);}
 try{
  let r,remaining;
  if(app){
   r=await receipt();await writeFile(join(out,'exit-input.json'),JSON.stringify({...r,adapters:adapterIdentities}));
   remaining=JSON.parse((await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/sample-test-process-roles.ps1'),'-Evidence',join(out,'exit-input.json'),'-VerifyExited'],{windowsHide:true,timeout:15000})).stdout);
  }else{
   r={normalExit:false,forcedCleanup:false};
   remaining=adapters.filter(a=>a.process.child.exitCode===null&&a.process.child.signalCode===null).map(a=>({pid:a.process.child.pid}));
  }
  const containers=(await docker('ps','-aq','--filter','label=baton.soak='+owner)).split(/\r?\n/).filter(Boolean);
  summary.cleanup={normalExit:r.normalExit===true,forcedCleanup:r.forcedCleanup!==false,remainingProcesses:remaining.length,remainingContainers:containers.length};assert.equal(remaining.length,0);assert.equal(containers.length,0);
 }catch(e){failures.push('cleanup_verification:'+e);}
 if(failures.length){summary.cleanupFailures=failures;summary.status='failed';process.exitCode=1;}
 summary.finishedUtc=new Date().toISOString();await save();console.log(JSON.stringify({status:summary.status,seconds:summary.elapsedSeconds,failure:summary.failure,cleanupFailures:failures}));
}
