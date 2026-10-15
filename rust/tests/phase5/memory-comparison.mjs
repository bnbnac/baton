import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,readFile,writeFile,appendFile,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {release as osRelease} from 'node:os';
import {observe,deadline,stop} from '../helpers/process.mjs';
import {Adapter,data} from '../phase3/stdio.mjs';
import {LogOracle} from './soak-oracle.mjs';
import {analyzeArm} from './memory-comparison-analysis.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out=resolve(process.argv[2]??''),condition=process.argv[3],mode=process.argv[4];
if(!process.argv[2]||!['baseline','transitions'].includes(condition)||!['smoke','diagnostic'].includes(mode))throw Error('usage: memory-comparison.mjs fresh-directory baseline|transitions smoke|diagnostic');
const seconds=mode==='smoke'?60:3600;
await mkdir(out);
const {chromium}=await import('file:///C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const pwsh='C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const appExe=join(root,'artifacts/rust-phase-5/20261010T213817-6aeef27f4382426d968c8f836bd2de91/압축 해제 검증/baton.exe');
const adapterExe=join(root,'artifacts/phase5-harness-fixes-probe3-20261013/candidate/baton-adapter.exe');
const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const owner=randomUUID(),tag='baton-memory-comparison-20261014';
const summary={status:'preparing',mode,condition,requestedSeconds:seconds,runnerPid:process.pid,owner,startedUtc:new Date().toISOString(),sessions:[],samples:[],diagnostics:[],actions:[],checks:{rates:false,audit:false,health:false,transitions:false}};
const adapters=[],fixtures=[],sessions=[];let app,browser,page,port,debug,adapterIdentities=[],stableIdentities,interrupted=false;
summary.fixtures=fixtures;
const endpoint=join(out,'local/BatonRust/v2');
const receiptPath=join(out,'process.json');
process.on('SIGINT',()=>{interrupted=true;});process.on('SIGTERM',()=>{interrupted=true;});
async function save(){summary.sessions=sessions.map(s=>({id:s.id,index:s.index,adapter:s.adapter,stream:s.stream,count:s.oracle.count,bytes:s.oracle.bytes,audits:s.audits}));await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));}
async function docker(...args){return (await execute('docker',args,{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024})).stdout.trim();}
async function checkStop(){if(interrupted)throw Error('interrupted');try{await access(join(out,'stop'));throw Error('stop_requested');}catch(e){if(e.code!=='ENOENT')throw e;}}
async function wait(check,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){await checkStop();const value=await check();if(value)return value;await pause(100);}throw Error(label+'_timeout');}
async function receipt(){return wait(async()=>{try{return JSON.parse(await readFile(receiptPath,'utf8'));}catch(e){if(e.code==='ENOENT')return false;throw e;}},'process_receipt');}
async function freePort(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function status(index){return data(await adapters[index].tool('status'));}
async function sessionStatus(s){const p=(await status(s.adapter)).sessions.find(p=>p.session_id===s.id);assert.ok(p,'missing_session');return p;}
function identity(s){return {session_id:s.id,control_epoch:s.epoch};}
async function command(s,text,duplicate=false){const args={...identity(s),request_id:randomUUID().replaceAll('-',''),text};const first=data(await adapters[s.adapter].tool('send_text',args));assert.equal(first.result,'delivered',JSON.stringify(first));if(duplicate){const again=data(await adapters[s.adapter].tool('send_text',args));assert.deepEqual(again,first);}const enter=data(await adapters[s.adapter].tool('send_key',{...identity(s),request_id:randomUUID().replaceAll('-',''),key:'Enter'}));assert.equal(enter.result,'delivered',JSON.stringify(enter));}
async function pump(){const results=await Promise.allSettled(sessions.map(async s=>{const p=data(await adapters[s.adapter].tool('read_output',{...identity(s),stream_id:s.stream,cursor:s.cursor,limit:32768,wait_ms:0}));assert.ok(Number.isSafeInteger(p.next_cursor),'bad_read:'+JSON.stringify(p));assert.ok(p.oldest_cursor<=s.cursor,'output_gap');const before=s.oracle.count;s.oracle.push(p.text??'');s.cursor=p.next_cursor;if(s.oracle.count>before)s.lastLog=Date.now();assert.ok(Date.now()-s.lastLog<15000,'stalled_session_'+s.index);}));for(const r of results)if(r.status==='rejected')throw r.reason;}
async function select(s){await page.locator('nav button.session').filter({has:page.locator('strong',{hasText:`soak-${s.index.toString().padStart(2,'0')}`})}).click();}
async function audit(round){for(const s of sessions){const token=`AUDIT_${s.index}_${round}`;await command(s,`printf '%s\\n' '${token}' >> /tmp/soak-audit-${s.index}`,true);s.audits.push(token);}summary.actions.push({type:'audit',round,utc:new Date().toISOString()});}
async function verifyAudits(){for(const s of sessions){const content=await docker('exec',fixtures[s.index%2].id,'cat',`/tmp/soak-audit-${s.index}`);assert.deepEqual(content.split(/\r?\n/),s.audits,'audit mismatch '+s.index);}}
async function processSnapshot(){
 const r=await receipt();await writeFile(join(out,'memory-input.json'),JSON.stringify({...r,adapters:adapterIdentities}));
 const processes=JSON.parse((await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/sample-test-process-roles.ps1'),'-Evidence',join(out,'memory-input.json')],{windowsHide:true,timeout:15000})).stdout);
 for(const [role,count] of [['app',1],['renderer',1],['adapter',32]])assert.equal(processes.filter(p=>p.role===role).length,count,'role_count_'+role);
 const current=processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(p=>`${p.pid}:${p.startedTicks}`).sort();
 if(stableIdentities)assert.deepEqual(current,stableIdentities,'owned_process_changed');else stableIdentities=current;
 return {processes,privateBytes:processes.reduce((n,p)=>n+p.privateBytes,0),workingSetBytes:processes.reduce((n,p)=>n+p.workingSetBytes,0)};
}
async function memory(start){
 const before=(performance.now()-start)/1000,result=await processSnapshot(),elapsed=(performance.now()-start)/1000;
 if(elapsed>=seconds)return; // Never insert an endpoint/GC sample into a natural window.
 const sample={elapsed,phase:'natural',durationSeconds:elapsed-before,...result};summary.samples.push(sample);await appendFile(join(out,'memory.jsonl'),JSON.stringify(sample)+'\n');
}
async function diagnostic(start,phase){
 const began=performance.now();
 const heap=await deadline(debug.send('Runtime.getHeapUsage'),15000,'heap'),dom=await deadline(debug.send('Memory.getDOMCounters'),15000,'dom');
 const state=await page.evaluate(()=>({callbacks:window.__TAURI_INTERNALS__.callbacks.size,terminals:document.querySelectorAll('.xterm').length,domElements:document.querySelectorAll('*').length}));assert.equal(state.terminals,16);
 const memory=await processSnapshot();
 const d={phase,elapsed:(performance.now()-start)/1000,durationSeconds:(performance.now()-began)/1000,heap,dom,state,memory};
 summary.diagnostics.push(d);await appendFile(join(out,'diagnostics.jsonl'),JSON.stringify(d)+'\n');
}
async function transition(round){
 const s=sessions[round%16];await select(s);
 const before=(await sessionStatus(s)).geometry;
 // Change the selected terminal's real layout; GeometryObserver sends PTY resize.
 await page.locator('.terminal-workspace').evaluate((el,width)=>{el.style.width=width+'px';},before.columns>=90?720:1000);
 const geometry=await wait(async()=>{const g=(await sessionStatus(s)).geometry;return g.columns!==before.columns?g:false;},'geometry_changed');
 await command(s,`stty size > /tmp/soak-size-${s.index}-${round}`);
 const remote=await wait(async()=>{const value=await docker('exec',fixtures[s.index%2].id,'sh','-c',`cat /tmp/soak-size-${s.index}-${round} 2>/dev/null || true`);return value||false;},'remote_geometry');
 assert.deepEqual(remote.split(/\s+/).map(Number),[geometry.rows,geometry.columns],'remote_resize_mismatch');
 summary.actions.push({type:'resize',index:s.index,geometry,remote,utc:new Date().toISOString()});
 await page.getByRole('button',{name:'내가 제어하기',exact:true}).click();
 await wait(async()=>(await sessionStatus(s)).state==='user_owned','reclaimed');
 const previous=s.adapter;s.adapter=(s.adapter+16)%32;
 const target=await status(s.adapter);await page.getByLabel('전달할 MCP 연결').selectOption(target.connection_id);
 await page.getByRole('button',{name:'에이전트에 전달',exact:true}).click();
 const next=await wait(async()=>{const p=(await status(s.adapter)).sessions.find(p=>p.session_id===s.id);return p?.state==='agent_owned'?p:false;},'reassigned');
 assert.notEqual(next.stream_id,s.stream);s.epoch=next.control_epoch;s.stream=next.stream_id;s.cursor=0;s.oracle.reset();s.lastLog=Date.now();
 summary.actions.push({type:'handoff',index:s.index,previous,adapter:s.adapter,utc:new Date().toISOString()});
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
 summary.sources={};for(const path of ['rust/tests/phase5/memory-comparison.mjs','rust/tests/phase5/memory-comparison-analysis.mjs','rust/scripts/sample-test-process-roles.ps1','rust/tests/phase5/soak.mjs','rust/tests/phase5/soak-oracle.mjs','rust/tests/phase5/soak-stream.sh','rust/scripts/sample-test-memory.ps1','rust/scripts/close-test-process.ps1','rust/scripts/desktop-process.ps1','rust/tests/phase2/desktop-supervisor.mjs','rust/tests/phase3/stdio.mjs','rust/tests/helpers/process.mjs','tests/linux-ssh/Dockerfile'])summary.sources[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
 summary.binaries={};for(const [key,path] of Object.entries({app:appExe,adapter:adapterExe}))summary.binaries[key]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
 assert.equal(summary.binaries.app.sha256,'f2fe998b0f224903d26234b0d033b3e7b7faf8198da80aede9f06504e7fa777b');assert.equal(summary.binaries.adapter.sha256,'09823dd5d51cd3b33f286540fe43a03570b3eee81497607a1b5b67336fcb754c');
 const imageId=await docker('image','inspect',tag,'--format','{{.Id}}');assert.match(imageId,/^sha256:[a-f0-9]{64}$/);summary.imageId=imageId;await save();
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
 summary.environment={platform:process.platform,arch:process.arch,osRelease:osRelease(),node:process.version,webview:browser.version(),playwright:JSON.parse(await readFile('C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json','utf8')).version};
 for(let i=0;i<16;i++){await createSession(i);for(const s of sessions)s.lastLog=Date.now();await pump();await save();}
 await wait(async()=>{await pump();return sessions.every(s=>s.oracle.count>0);},'all_streams');
 const r0=await receipt();await writeFile(join(out,'initial-memory-input.json'),JSON.stringify(r0));
 const initial=JSON.parse((await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/sample-test-memory.ps1'),'-Evidence',join(out,'initial-memory-input.json'),'-AdapterPids',adapters.map(a=>a.process.child.pid).join(',')],{windowsHide:true,timeout:15000})).stdout);
 adapterIdentities=initial.processes.filter(p=>adapters.some(a=>a.process.child.pid===p.pid));assert.equal(adapterIdentities.length,32);summary.adapterIdentities=adapterIdentities;
 debug=await browser.contexts()[0].newCDPSession(page);await processSnapshot();await pump();
 summary.status='running';summary.loadStartedUtc=new Date().toISOString();for(const s of sessions)s.startCount=s.oracle.count;const start=performance.now();let nextSample=0,nextAction=0,nextDiagnostic=0,nextSave=0,round=0;
 while((performance.now()-start)/1000<seconds){
  await checkStop();await pump();const elapsed=(performance.now()-start)/1000;
  if(elapsed>=seconds)break;
  if(elapsed>=nextSample){await memory(start);nextSample=(Math.floor((performance.now()-start)/1000/30)+1)*30;}
  if(elapsed>=nextDiagnostic){await diagnostic(start,'natural');await pump();nextDiagnostic=(Math.floor((performance.now()-start)/1000/300)+1)*300;}
  if(elapsed>=nextAction){const health=await Promise.all(adapters.map((_,i)=>status(i)));for(let i=0;i<32;i++){assert.equal(health[i].app_state,'online');assert.equal(health[i].connection_id,summary.connections[i],'connection_changed');}await audit(round);await pump();if(condition==='transitions')await transition(round);round++;nextAction+=seconds===60?3:60;}
  summary.elapsedSeconds=(performance.now()-start)/1000;if(summary.elapsedSeconds>=nextSave){await save();nextSave=summary.elapsedSeconds+30;}await pause(500);
 }
 await pump();summary.elapsedSeconds=(performance.now()-start)/1000;summary.loadFinishedUtc=new Date().toISOString();await verifyAudits();summary.auditVerified=true;
 if(seconds===60)assert.ok(round>=17,'smoke_revisit_not_exercised');else assert.equal(round,60,'missing_action_round');
 summary.checks.audit=true;summary.checks.transitions=summary.actions.filter(a=>a.type==='handoff').length===(condition==='transitions'?round:0);assert.ok(summary.checks.transitions);
 for(let i=0;i<32;i++){const p=await status(i);assert.equal(p.app_state,'online');assert.equal(p.connection_id,summary.connections[i]);}
 for(const s of sessions)assert.equal((await sessionStatus(s)).state,'agent_owned');summary.checks.health=true;
 summary.rates=sessions.map(s=>({index:s.index,records:s.oracle.count-s.startCount,bytesPerSecond:(s.oracle.count-s.startCount)*(1016+String(s.index).length+8)/summary.elapsedSeconds}));
 for(const r of summary.rates)assert.ok(r.bytesPerSecond>=1024,'insufficient_log_rate_'+r.index);
 summary.checks.rates=true;summary.status='final_measurement';await save();
 await diagnostic(start,'pre_gc');await deadline(debug.send('HeapProfiler.collectGarbage'),15000,'collect_gc');await diagnostic(start,'post_gc');await debug.detach();debug=undefined;
 const r=await receipt();await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/close-test-process.ps1'),'-ProcessId',String(r.pid),'-Executable',appExe,'-StartedTicks',r.startedTicks],{windowsHide:true,timeout:5000});
 assert.equal((await deadline(app.closed,15000,'normal_exit')).code,0);summary.process=await receipt();assert.ok(summary.process.normalExit&&!summary.process.forcedCleanup&&summary.process.descendantAudit==='verified');
 for(let i=0;i<32;i++){assert.equal((await status(i)).app_state,'offline');assert.equal(await adapters[i].eof(),0);assert.equal(adapters[i].stderr,'');}
 for(const [path,hash] of Object.entries(summary.sources))assert.equal(createHash('sha256').update(await readFile(join(root,path))).digest('hex'),hash,'source_changed_'+path);
 for(const b of Object.values(summary.binaries))assert.equal(createHash('sha256').update(await readFile(b.path)).digest('hex'),b.sha256,'binary_changed');
 summary.status=mode==='diagnostic'?'diagnostic_completed':'smoke_completed';
}catch(e){summary.status='failed';summary.failure=String(e);summary.failureStack=e.stack;process.exitCode=1;}
finally{
 const failures=[];
 for(const [label,op] of [['browser',()=>browser?.close()],...adapters.map((a,i)=>['adapter'+i,()=>a.cleanup()]),['app',()=>app&&stop(app)]])try{await op();}catch(e){failures.push(label+':'+e);}
 for(const f of fixtures)try{
  if(!f.id){const found=await docker('ps','-aq','--filter','label=baton.soak='+owner,'--filter','name=^/'+f.name+'$');if(found){assert.equal(found.split('\n').length,1);f.id=JSON.parse(await docker('inspect',found))[0].Id;}}
  if(f.id){const actual=JSON.parse(await docker('inspect',f.id))[0];assert.equal(actual.Id,f.id);assert.equal(actual.Name,'/'+f.name);assert.equal(actual.Config.Labels['baton.soak'],owner);await docker('rm','-f',f.id);f.removed=true;}
 }catch(e){failures.push('fixture:'+e);}
 try{
  const r=await receipt();await writeFile(join(out,'exit-input.json'),JSON.stringify({...r,adapters:adapterIdentities}));
  const remaining=JSON.parse((await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/sample-test-process-roles.ps1'),'-Evidence',join(out,'exit-input.json'),'-VerifyExited'],{windowsHide:true,timeout:15000})).stdout);
  const containers=(await docker('ps','-aq','--filter','label=baton.soak='+owner)).split(/\r?\n/).filter(Boolean);
  summary.cleanup={normalExit:r.normalExit===true,forcedCleanup:r.forcedCleanup!==false,remainingProcesses:remaining.length,remainingContainers:containers.length};assert.equal(remaining.length,0);assert.equal(containers.length,0);
 }catch(e){failures.push('cleanup_verification:'+e);}
 if(failures.length){summary.cleanupFailures=failures;summary.status='failed';process.exitCode=1;}
 if(summary.status==='diagnostic_completed'){summary.analysis=analyzeArm(summary);if(!summary.analysis.valid){summary.status='failed';summary.failure='invalid_comparison_evidence';process.exitCode=1;}}
 summary.finishedUtc=new Date().toISOString();await save();console.log(JSON.stringify({status:summary.status,seconds:summary.elapsedSeconds,failure:summary.failure,cleanupFailures:failures}));
}
