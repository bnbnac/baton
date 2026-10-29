import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,readFile,writeFile,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import net from 'node:net';
import assert from 'node:assert/strict';
import {observe,deadline,stop} from '../helpers/process.mjs';
import {Adapter,data} from '../phase3/stdio.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const out=resolve(process.argv[2]??'');const count=Number(process.argv[3]);
if(!process.argv[2]||!Number.isInteger(count)||count<1||count>100)throw Error('usage: lifecycle.mjs fresh-directory count[1..100]');
await mkdir(out);
const {chromium}=await import(`file:///${process.env.USERPROFILE.replaceAll('\\','/')}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`);
const pwsh=`${process.env.USERPROFILE.replaceAll('\\','/')}/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe`;
const appExe=join(root,'artifacts/rust-phase-5/20261010T213817-6aeef27f4382426d968c8f836bd2de91/압축 해제 검증/baton.exe');
const adapterExe=join(root,'artifacts/phase5-harness-fixes-probe3-20261013/candidate/baton-adapter.exe');
const execute=promisify(execFile),pause=ms=>new Promise(r=>setTimeout(r,ms));
const owner=randomUUID(),name='baton-life-'+owner.slice(0,12),tag='baton-lifecycle-20261014';
const rows=[],summary={status:'running',requested:count,startedUtc:new Date().toISOString(),owner,rows};
let container,fixture,containerStartAttempted=false,interrupted=false;
process.on('SIGINT',()=>{interrupted=true;});process.on('SIGTERM',()=>{interrupted=true;});
async function save(){await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));}
async function docker(...args){return (await execute('docker',args,{windowsHide:true,timeout:15000,maxBuffer:2*1024*1024})).stdout.trim();}
async function wait(check,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(interrupted)throw Error('interrupted');const value=await check();if(value)return value;await pause(100);}throw Error(label+'_timeout');}
async function freePort(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function processes(){const text=await docker('exec',container,'ps','-eo','pid,comm');return text.split('\n').slice(1).map(s=>s.trim().split(/\s+/)).filter(r=>r.length===2&&r[1]!=='ps').map(([pid,command])=>({pid:Number(pid),command}));}
async function pipeAbsent(app){const result=await new Promise(resolve=>{const socket=net.connect('\\\\.\\pipe\\baton-rust-v2-'+app);const timer=setTimeout(()=>{socket.destroy();resolve('timeout');},1500);socket.once('error',error=>{clearTimeout(timer);resolve(error.code);});socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve('connected');});});assert.equal(result,'ENOENT','old pipe still available or could not verify absence');}
async function portAbsent(port){const result=await new Promise(resolve=>{const socket=net.connect(port,'127.0.0.1');const timer=setTimeout(()=>{socket.destroy();resolve('timeout');},1500);socket.once('error',error=>{clearTimeout(timer);resolve(error.code);});socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve('connected');});});assert.equal(result,'ECONNREFUSED','debug listener still available or absence unverified');}
async function cycle(iteration){
 const dir=join(out,String(iteration).padStart(3,'0'));await mkdir(dir);
 const local=join(dir,'local'),webview=join(out,'webview');await mkdir(local);
 const endpoint=join(local,'BatonRust/v2'),port=await freePort();
 const row={iteration,startedUtc:new Date().toISOString(),port,status:'failed'};
 let adapter,app,browser;
 try{
  adapter=new Adapter(endpoint,{executable:adapterExe,cwd:dir});row.adapterPid=adapter.process.child.pid;
  await adapter.initialize();assert.equal(data(await adapter.tool('status')).app_state,'offline');
  const log=await open(join(dir,'process.log'),'wx');
  try{app=observe(spawn(process.execPath,[join(root,'rust/tests/phase2/desktop-supervisor.mjs'),'-File',join(root,'rust/scripts/desktop-process.ps1'),'-Executable',appExe,'-Evidence',join(dir,'process.json'),'-OwnerPid',String(process.pid),'-TimeoutSeconds','120'],{detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PATH:dirname(pwsh)+';'+process.env.PATH,LOCALAPPDATA:local,BATON_WEBVIEW_DATA:webview,WEBVIEW2_USER_DATA_FOLDER:webview,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`}}));}finally{await log.close();}
  await wait(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/json/list`)).ok;}catch{return false;}},'webview_ready');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=await wait(async()=>browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/'),'product_page');
  page.setDefaultTimeout(10000);
  await page.getByRole('heading',{name:'SSH 세션',exact:true}).waitFor();
  const online=await wait(async()=>{const s=data(await adapter.tool('status'));return s.app_state==='online'?s:false;},'adapter_online');
  row.appInstanceId=online.app_instance_id;row.connectionId=online.connection_id;
  await page.getByLabel('이름',{exact:true}).fill('lifecycle-'+iteration);
  await page.getByLabel('서버 주소',{exact:true}).fill('127.0.0.1');
  await page.getByLabel('포트',{exact:true}).fill(String(fixture.port));
  await page.getByLabel('사용자 이름',{exact:true}).fill('batonfixture');
  await page.getByRole('button',{name:'연결',exact:true}).click();
  await page.getByRole('button',{name:'이 연결에서 신뢰',exact:true}).waitFor();
  assert.ok((await page.locator('.challenge pre').innerText()).includes(fixture.fingerprint),'host fingerprint mismatch');
  await page.getByRole('button',{name:'이 연결에서 신뢰',exact:true}).click();
  await page.locator('.challenge input[type=password]').fill('baton-fixture-only');
  await page.getByRole('button',{name:'인증',exact:true}).click();
  await page.getByLabel('전달할 MCP 연결').selectOption(online.connection_id);
  await page.getByRole('button',{name:'에이전트에 전달',exact:true}).click();
  const session=await wait(async()=>data(await adapter.tool('status')).sessions.find(s=>s.state==='agent_owned'),'assigned');
  row.sessionId=session.session_id;
  const identity={session_id:session.session_id,control_epoch:session.control_epoch};
  const text=`printf 'LIFE_%s_OK\\n' '${iteration}'`;
  assert.equal(data(await adapter.tool('send_text',{...identity,request_id:randomUUID().replaceAll('-',''),text})).result,'delivered');
  assert.equal(data(await adapter.tool('send_key',{...identity,request_id:randomUUID().replaceAll('-',''),key:'Enter'})).result,'delivered');
  let cursor=0,output='';
  await wait(async()=>{const p=data(await adapter.tool('read_output',{...identity,stream_id:session.stream_id,cursor,limit:32768,wait_ms:500}));output+=p.text??'';cursor=p.next_cursor??cursor;return output.includes(`LIFE_${iteration}_OK`);},'shell_marker');
  row.marker=`LIFE_${iteration}_OK`;row.remoteBefore=await processes();
  assert.ok(row.remoteBefore.some(p=>p.command==='bash'),'remote shell missing');
  // The supervisor replaces this receipt while running; tolerate its rename gap.
  const processReceipt=await wait(async()=>{try{return JSON.parse(await readFile(join(dir,'process.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw error;}},'process_receipt');
  row.rootPid=processReceipt.pid;
  // Negative identity control once: a stale identity must leave the live app alone.
  if(iteration===1){let refused=false;try{await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/close-test-process.ps1'),'-ProcessId',String(processReceipt.pid),'-Executable',appExe,'-StartedTicks','0'],{windowsHide:true,timeout:5000});}catch(error){refused=String(error.stderr).includes('test_process_identity_mismatch');}assert.ok(refused);assert.equal(data(await adapter.tool('status')).app_state,'online');row.staleIdentityRejected=true;}
  await execute(pwsh,['-NoProfile','-File',join(root,'rust/scripts/close-test-process.ps1'),'-ProcessId',String(processReceipt.pid),'-Executable',appExe,'-StartedTicks',processReceipt.startedTicks],{windowsHide:true,timeout:5000});
  row.appExit=await deadline(app.closed,15000,'normal_exit');assert.equal(row.appExit.code,0);
  row.process=JSON.parse(await readFile(join(dir,'process.json'),'utf8'));
  assert.equal(row.process.normalExit,true);assert.equal(row.process.forcedCleanup,false);assert.equal(row.process.descendantAudit,'verified');assert.equal(row.process.failure,null);assert.ok(row.process.descendants.length>0&&row.process.descendants.every(p=>p.exited));
  await wait(async()=>data(await adapter.tool('status')).app_state==='offline','adapter_offline');
  await wait(async()=>{row.remoteAfter=await processes();return JSON.stringify(row.remoteAfter)===JSON.stringify(fixture.baseline);},'remote_process_cleanup');
  await assert.rejects(access(join(endpoint,'endpoint.bin')),error=>error.code==='ENOENT');
  await pipeAbsent(row.appInstanceId);
  await portAbsent(port);row.endpointRemoved=true;row.pipeRemoved=true;row.debugPortClosed=true;
  row.adapterExit=await adapter.eof();assert.equal(row.adapterExit,0);assert.equal(adapter.stderr,'');
  row.status='passed';
 }catch(error){row.failure=String(error);throw error;}
 finally{
  const cleanupErrors=[];
  for(const [label,operation] of [['browser',()=>browser?.close()],['adapter',()=>adapter?.cleanup()],['app',()=>app&&stop(app)]]){try{await operation();}catch(e){cleanupErrors.push(label+':'+e);}}
  if(cleanupErrors.length){row.cleanupErrors=cleanupErrors;row.status='failed';}
  row.finishedUtc=new Date().toISOString();rows.push(row);await writeFile(join(dir,'result.json'),JSON.stringify(row,null,2));await save();
  if(cleanupErrors.length)throw Error('cycle_cleanup_failed');
 }
}
try{
 summary.sources={};for(const path of ['rust/tests/phase5/lifecycle.mjs','rust/scripts/close-test-process.ps1','rust/scripts/desktop-process.ps1','rust/tests/phase2/desktop-supervisor.mjs','rust/tests/phase3/stdio.mjs','rust/tests/helpers/process.mjs'])summary.sources[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');
 summary.binaries={};for(const [name,path] of Object.entries({app:appExe,adapter:adapterExe}))summary.binaries[name]={path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};
 containerStartAttempted=true;
 container=await docker('run','-d','--name',name,'--label','baton.lifecycle='+owner,'-p','127.0.0.1::22',tag);
 const inspect=JSON.parse(await docker('inspect',container))[0];assert.equal(inspect.Config.Labels['baton.lifecycle'],owner);
 const binding=inspect.NetworkSettings.Ports['22/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
 const fingerprint=(await docker('exec',container,'ssh-keygen','-lf','/etc/ssh/ssh_host_ed25519_key.pub')).match(/SHA256:\S+/)[0];
 fixture={container,image:inspect.Image,port:Number(binding.HostPort),fingerprint,baseline:await processes()};summary.fixture=fixture;await save();
 for(let i=1;i<=count;i++){if(interrupted)throw Error('interrupted');await cycle(i);console.log(`LIFECYCLE ${i}/${count} passed`);}
 for(const [path,hash] of Object.entries(summary.sources))assert.equal(createHash('sha256').update(await readFile(join(root,path))).digest('hex'),hash,'source changed during campaign: '+path);
 summary.status='passed';
}catch(error){summary.status='failed';summary.failure=String(error);process.exitCode=1;}
finally{
 // docker may create the container even if its CLI response is lost.
 if(containerStartAttempted&&!container){try{const ids=await docker('ps','-aq','--filter','label=baton.lifecycle='+owner);if(ids){assert.equal(ids.split('\n').length,1);const recovered=JSON.parse(await docker('inspect',ids))[0];assert.equal(recovered.Name,'/'+name);assert.equal(recovered.Config.Labels['baton.lifecycle'],owner);container=recovered.Id;summary.recoveredContainer=true;}}catch(error){summary.status='failed';summary.cleanupFailure=String(error);process.exitCode=1;}}
 if(container){try{const actual=JSON.parse(await docker('inspect',container))[0];assert.equal(actual.Id,container);assert.equal(actual.Name,'/'+name);assert.equal(actual.Config.Labels['baton.lifecycle'],owner);await docker('rm','-f',container);assert.equal(await docker('ps','-aq','--filter','label=baton.lifecycle='+owner),'');summary.containerRemoved=true;}catch(error){summary.status='failed';summary.cleanupFailure=String(error);process.exitCode=1;}}
 summary.finishedUtc=new Date().toISOString();await save();console.log(JSON.stringify({status:summary.status,completed:rows.filter(r=>r.status==='passed').length,failure:summary.failure,containerRemoved:summary.containerRemoved}));
}
