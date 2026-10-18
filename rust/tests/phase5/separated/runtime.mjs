import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open,readFile,writeFile,appendFile,access,rename,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {release as osRelease} from 'node:os';
import net from 'node:net';
import {Adapter,data} from '../../phase3/stdio.mjs';
import {observe,deadline,stop} from '../../helpers/process.mjs';
import {LogOracle} from '../soak-oracle.mjs';
import {compareIdentity} from './contract.mjs';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
export const sha256=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
export function assertProcessIdentity(expected,actual){assert.equal(actual.pid,expected.pid,'process_pid');assert.equal(String(actual.startedTicks),String(expected.startedTicks),'process_start');}
export function validateShutdown(process,eofs){
 assert.equal(process.normalExit,true,'normal_exit');assert.equal(process.forcedCleanup,false,'forced_cleanup');assert.equal(process.descendantAudit,'verified','descendant_audit');
 assert.equal(eofs.length,32,'adapter_eof_count');assert.equal(new Set(eofs.map(e=>e.index)).size,32,'duplicate_eof');
 for(let i=0;i<32;i++){const e=eofs.find(e=>e.index===i);assert.ok(e);assert.equal(e.code,0);assert.equal(e.stderr,'');}
 return {adapterEof:32};
}
export async function cleanupFixture(docker,f,owner){
 if(!f.id){const found=await docker('ps','-aq','--filter','label=baton.soak='+owner,'--filter','name=^/'+f.name+'$');if(!found)return;assert.equal(found.trim().split(/\s+/).length,1,'ambiguous_fixture');f.id=JSON.parse(await docker('inspect',found.trim()))[0].Id;}
 const actual=JSON.parse(await docker('inspect',f.id))[0];
 assert.equal(actual.Id,f.id,'fixture_id');assert.equal(actual.Name,'/'+f.name,'fixture_name');assert.equal(actual.Config.Labels['baton.soak'],owner,'fixture_owner');
 await docker('rm','-f',f.id);f.removed=true;
}
export function createRuntime(options,deps={}){return new Runtime(options,deps);}
class Runtime {
 constructor({root,out,config,contract},deps){
  Object.assign(this,{root,out,config,contract});this.deps=deps;this.now=deps.now??(()=>performance.now());this.sleep=deps.sleep??pause;this.born=this.now();this.owner=randomUUID();
  this.execute=deps.execute??promisify(execFile);this.docker=deps.docker??(async(...args)=>(await this.execute('docker',args,{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024})).stdout.trim());
  this.sessions=[];this.adapters=[];this.fixtures=[];this.connections=[];this.writes=new Map();this.sequence=0;this.transition=null;this.nextSave=0;this.interrupted=false;this.serviceQueue=Promise.resolve();
  this.summary={schema:1,scope:contract.scope,profile:contract.profile,contract,owner:this.owner,runnerPid:process.pid,clockOrigin:this.born,status:'preparing',startedUtc:new Date().toISOString(),phase5Acceptance:false,combinedTransitionMemory:'unverified',samples:[],instrumentation:{forcedGcCalls:0,jsProbes:0,rawCdpSessions:0,debugListenerEnabled:true}};
 }
 async init(){for(const f of ['events.jsonl','output.jsonl','memory.jsonl']){const handle=await open(join(this.out,f),'wx');await handle.close();}await this.save();}
 elapsed(){return this.loadStart===undefined?0:(this.now()-this.loadStart)/1000;}
 async append(file,value){const previous=this.writes.get(file)??Promise.resolve();const next=previous.then(()=>appendFile(join(this.out,file),JSON.stringify(value)+'\n'));this.writes.set(file,next);return next;}
 async event(type,detail={}){const row={seq:++this.sequence,t:this.now()-this.born,utc:new Date().toISOString(),owner:this.owner,scope:this.contract.scope,type,...detail};await this.append('events.jsonl',row);return row;}
 async json(file,value){const path=join(this.out,file),tmp=path+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2)+'\n');await rename(tmp,path);}
 async save(){this.summary.sessions=this.sessions.map(s=>({index:s.index,id:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream,cursor:s.cursor,audits:s.audits??[]}));this.summary.connections=this.connections;this.summary.fixtures=this.fixtures;await this.json('summary.json',this.summary);}
 async checkStop(){if(this.interrupted)throw Error('interrupted');try{await access(join(this.out,'stop'));throw Error('stop_requested');}catch(e){if(e.code!=='ENOENT')throw e;}}
 async waitFor(check,label,timeoutMs=45000,{service=true,honorStop=true}={}){
  const end=this.now()+timeoutMs;
  while(this.now()<end){if(honorStop)await this.checkStop();if(service)await this.service();if(this.now()>end)break;const result=await check();if(this.now()>end)break;if(result)return result;await this.sleep(100);}throw Error(label+'_timeout');
 }
 async tool(index,name,args={}){const response=data(await this.adapters[index].tool(name,args));await this.event('mcp',{index,name,args,response});return response;}
 async status(index){return this.tool(index,'status');}
 async sessionStatus(s){const p=(await this.status(s.adapter)).sessions.find(p=>p.session_id===s.id);assert.ok(p,'missing_session');return p;}
 async command(s,text,duplicate=false){
  const args={session_id:s.id,control_epoch:s.epoch,request_id:randomUUID().replaceAll('-',''),text};
  const response=await this.tool(s.adapter,'send_text',args);assert.equal(response.result,'delivered',JSON.stringify(response));
  if(duplicate)assert.deepEqual(await this.tool(s.adapter,'send_text',args),response,'dedup_response');
  const enter=await this.tool(s.adapter,'send_key',{session_id:s.id,control_epoch:s.epoch,request_id:randomUUID().replaceAll('-',''),key:'Enter'});assert.equal(enter.result,'delivered');
 }
 async acceptOutput(s,p){
  await this.append('output.jsonl',{t:this.now()-this.born,elapsed:this.elapsed(),phase:this.measurementFrozen?'post':this.loadStart===undefined?'setup':'normal',session:s.id,index:s.index,epoch:s.epoch,stream:s.stream,cursor:s.cursor,response:p});
  assert.ok(Number.isSafeInteger(p.next_cursor)&&p.next_cursor>=s.cursor,'bad_cursor');assert.ok(Number.isSafeInteger(p.oldest_cursor)&&p.oldest_cursor<=s.cursor,'output_gap');
  const before=s.oracle.count;s.oracle.push(p.text??'');s.cursor=p.next_cursor;if(s.oracle.count>before)s.lastLog=this.now();
 }
 async read(s){const p=data(await this.adapters[s.adapter].tool('read_output',{session_id:s.id,control_epoch:s.epoch,stream_id:s.stream,cursor:s.cursor,limit:32768,wait_ms:0}));await this.acceptOutput(s,p);}
 service(){const task=this.serviceQueue.then(()=>this.consume());this.serviceQueue=task;return task;}
 async consume(){
  await this.checkStop();
  for(const s of this.sessions){if(this.transition?.session===s&&this.transition.stage==='reclaimed')continue;await this.read(s);if(s.lastLog!==undefined)assert.ok(this.now()-s.lastLog<15000,'stalled_session_'+s.index);}
  if(this.now()>=this.nextSave){this.summary.elapsedSeconds=this.elapsed();await this.save();this.nextSave=this.now()+10000;}
 }
 async during(operation){
  let done=false,result,failure;const pending=Promise.resolve().then(operation).then(v=>{result=v;done=true;},e=>{failure=e;done=true;});
  while(!done){await this.service();await this.sleep(100);}await pending;if(failure)throw failure;return result;
 }
 async setTransition(s,stage){
  assert.ok(this.sessions.includes(s),'unknown_session');assert.ok(!this.transition||this.transition.session===s,'concurrent_transition');
  assert.ok(['reclaiming','reclaimed'].includes(stage),'transition_stage');
  if(stage==='reclaiming')await this.waitFor(async()=>{const cursor=s.cursor;await this.read(s);return s.cursor===cursor;},'public_drain',45000,{service:false});
  if(stage==='reclaimed'&&this.loadStart!==undefined)s.privateStart=this.now();
  this.transition={session:s,stage};await this.event('transition_boundary',{session:s.id,stage,epoch:s.epoch,stream:s.stream,cursor:s.cursor});
 }
 async adoptBinding(s,b){
  assert.ok(this.transition?.session===s&&this.transition.stage==='reclaimed','transition_required');
  assert.ok(Number.isInteger(b.adapter)&&b.adapter>=0&&b.adapter<32&&b.adapter!==s.adapter,'new_adapter');assert.ok(b.epoch>s.epoch&&b.stream&&b.stream!==s.stream,'new_binding');
  await this.event('binding',{session:s.id,before:{adapter:s.adapter,epoch:s.epoch,stream:s.stream,cursor:s.cursor},after:b});
  if(s.privateStart!==undefined){s.privateMs=(s.privateMs??0)+this.now()-s.privateStart;s.privateStart=undefined;}
  Object.assign(s,{adapter:b.adapter,epoch:b.epoch,stream:b.stream,cursor:0,lastLog:this.now()});s.oracle.reset();this.transition=null;
 }
 async health(){const values=[];for(let i=0;i<32;i++){const p=await this.status(i);assert.equal(p.app_state,'online');assert.equal(p.connection_id,this.connections[i]);values.push(p);}await this.event('health',{values});return values;}
 async audit(round){for(const s of this.sessions){const token=`AUDIT_${s.index}_${round}`;await this.command(s,`printf '%s\\n' '${token}' >> /tmp/soak-audit-${s.index}`,true);s.audits.push(token);await this.service();}await this.event('audit',{round});}
 async verifyAudits(){const result=[];for(const s of this.sessions){const content=await this.docker('exec',this.fixtures[s.index%2].id,'cat',`/tmp/soak-audit-${s.index}`);result.push({index:s.index,session:s.id,actual:content?content.split(/\r?\n/):[]});}await this.json('audit-observations.json',result);for(const a of result)assert.deepEqual(a.actual,this.sessions[a.index].audits,'audit_effects');return result;}
 async receipt(){return this.waitFor(async()=>{try{return JSON.parse(await readFile(join(this.out,'process.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return false;throw e;}},'process_receipt',15000,{service:false,honorStop:false});}
 async ps(script,args=[]){return (await this.execute(this.config.pwsh,['-NoProfile','-File',join(this.root,'rust/scripts',script),...args],{windowsHide:true,timeout:20000,maxBuffer:4*1024*1024})).stdout;}
 async sampleMemory(){
  const receipt=await this.receipt();await this.json('memory-input.json',{...receipt,adapters:this.adapterIdentities});
  const processes=JSON.parse(await this.ps('sample-test-process-roles.ps1',['-Evidence',join(this.out,'memory-input.json')]));
  for(const [role,count] of [['app',1],['renderer',1],['adapter',32]])assert.equal(processes.filter(p=>p.role===role).length,count,'role_count');
  const identities=processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(p=>`${p.pid}:${p.startedTicks}`).sort();
  if(this.identities)assert.deepEqual(identities,this.identities,'process_identity_changed');else this.identities=identities;
  const debugPort=JSON.parse(await this.ps('check-test-debug-port.ps1',['-Port',String(this.port)]));
  if(this.contract.scope!=='F'){assert.equal(debugPort.established,0,'debugger_connection');assert.ok(debugPort.listening>=1);}
  const ownership={pid:receipt.pid,startedTicks:receipt.startedTicks,descendants:receipt.descendants.filter(p=>!p.exited),adapters:this.adapterIdentities};
  const sample={elapsed:this.elapsed(),phase:this.contract.scope==='F'?'attached':'natural',ownership,processes,debugPort,privateBytes:processes.reduce((n,p)=>n+p.privateBytes,0),workingSetBytes:processes.reduce((n,p)=>n+p.workingSetBytes,0)};
  if(this.contract.scope==='M'&&sample.elapsed>=this.contract.seconds)return;
  await this.append('memory.jsonl',sample);this.summary.samples.push(sample);return sample;
 }
 async startMeasurement(){this.loadStart=this.now();for(const s of this.sessions){s.startCount=s.oracle.count;s.privateMs=0;}this.summary.loadStartedUtc=new Date().toISOString();this.summary.status='running';await this.event('measurement_start');await this.save();}
 outputRates(){return this.sessions.map(s=>{const seconds=this.elapsed()-(s.privateMs??0)/1000;const records=s.oracle.count-s.startCount;return {index:s.index,records,publicSeconds:seconds,bytesPerSecond:records*(1024+String(s.index).length)/seconds};});}
 async overload(){return (await import('./memory.mjs')).runOverload(this);}
 async freeze(){this.measurementFrozen=true;this.summary.elapsedSeconds=this.elapsed();this.summary.loadFinishedUtc=new Date().toISOString();const row=await this.event('measurement_end');await this.json('normal-boundary.json',{elapsedSeconds:this.summary.elapsedSeconds,finishedUtc:this.summary.loadFinishedUtc,eventSeq:row.seq,samples:this.summary.samples.length});await this.save();}
 async disconnectBrowser(){await this.browser?.close();assert.ok(!this.browser?.isConnected());this.browser=undefined;this.page=undefined;this.summary.playwrightDisconnectedUtc=new Date().toISOString();await this.event('browser_disconnected');}
 async attachBrowser(){const {chromium}=await import(pathToFileURL(this.config.playwrightPath).href);this.browser=await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);this.page=await this.waitFor(async()=>this.browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/'),'product_page',15000,{service:false});this.page.setDefaultTimeout(45000);await this.event('browser_attached');}
 async manifest(){
  const directory='rust/tests/phase5/separated';const local=(await readdir(join(this.root,directory))).filter(f=>f.endsWith('.mjs')&&!f.endsWith('.test.mjs')&&f!=='test-fixture.mjs').map(f=>directory+'/'+f);
  const paths=[...local,directory+'/stream.sh','rust/tests/phase5/native-soak-control.mjs','rust/tests/phase5/soak-oracle.mjs','rust/app/src/main.ts','rust/app/src/connections/view.ts','rust/scripts/check-test-debug-port.ps1','rust/scripts/sample-test-process-roles.ps1','rust/scripts/sample-test-memory.ps1','rust/scripts/close-test-process.ps1','rust/scripts/desktop-process.ps1','rust/tests/phase2/desktop-supervisor.mjs','rust/tests/phase3/stdio.mjs','rust/tests/helpers/process.mjs','tests/linux-ssh/Dockerfile'];
  this.summary.sources={};for(const p of paths)this.summary.sources[p]=await sha256(join(this.root,p));
  this.summary.binaries={};for(const key of ['app','adapter']){const path=resolve(this.root,this.config[key].path);this.summary.binaries[key]={path,sha256:await sha256(path)};assert.equal(this.summary.binaries[key].sha256,this.config[key].sha256,'binary_hash');}
 }
 async checkHashes(){for(const [p,hash] of Object.entries(this.summary.sources))assert.equal(await sha256(join(this.root,p)),hash,'source_changed_'+p);for(const b of Object.values(this.summary.binaries))assert.equal(await sha256(b.path),b.sha256,'binary_changed');}
 async setup(){
  await this.manifest();this.summary.imageId=await this.docker('image','inspect',this.config.imageId,'--format','{{.Id}}');assert.equal(this.summary.imageId,this.config.imageId);
  for(let i=0;i<2;i++){
   const f={name:`baton-separated-${this.owner.slice(0,8)}-${i}`};this.fixtures.push(f);await this.save();
   f.id=await this.docker('run','-d','--name',f.name,'--label','baton.soak='+this.owner,'-p','127.0.0.1::22',this.config.imageId);
   const actual=JSON.parse(await this.docker('inspect',f.id))[0];assert.equal(actual.Config.Labels['baton.soak'],this.owner);assert.equal(actual.Image,this.config.imageId);f.image=actual.Image;
   const binding=actual.NetworkSettings.Ports['22/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');f.port=Number(binding.HostPort);
   f.fingerprint=(await this.docker('exec',f.id,'ssh-keygen','-lf','/etc/ssh/ssh_host_ed25519_key.pub')).match(/SHA256:\S+/)[0];
   await this.docker('cp',join(this.root,'rust/tests/phase5/separated/stream.sh'),f.id+':/tmp/soak-stream.sh');
  }
  const endpoint=join(this.out,'local/BatonRust/v2');
  for(let i=0;i<32;i++){const a=new Adapter(endpoint,{executable:this.summary.binaries.adapter.path,cwd:this.out});this.adapters.push(a);await a.initialize();}
  const server=net.createServer();await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});this.port=server.address().port;await new Promise(r=>server.close(r));
  const timeout=this.contract.scope==='N'?900:this.contract.scope==='M'?this.contract.seconds+900:this.contract.rounds*240+900;
  const log=await open(join(this.out,'process.log'),'wx');
  try{this.app=observe(spawn(process.execPath,[join(this.root,'rust/tests/phase2/desktop-supervisor.mjs'),'-File',join(this.root,'rust/scripts/desktop-process.ps1'),'-Executable',this.summary.binaries.app.path,'-Evidence',join(this.out,'process.json'),'-OwnerPid',String(process.pid),'-TimeoutSeconds',String(timeout)],{detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,PATH:dirname(this.config.pwsh)+';'+process.env.PATH,LOCALAPPDATA:join(this.out,'local'),BATON_WEBVIEW_DATA:join(this.out,'webview'),WEBVIEW2_USER_DATA_FOLDER:join(this.out,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${this.port} --remote-debugging-address=127.0.0.1`}}));}finally{await log.close();}
  await this.waitFor(async()=>{try{return (await fetch(`http://127.0.0.1:${this.port}/json/list`,{signal:AbortSignal.timeout(2000)})).ok;}catch{return false;}},'webview_ready',15000,{service:false});
  await this.attachBrowser();this.summary.environment={platform:process.platform,arch:process.arch,osRelease:osRelease(),node:process.version,webview:this.browser.version(),playwright:JSON.parse(await readFile(join(dirname(this.config.playwrightPath),'package.json'),'utf8')).version};
  if(this.config.baselineEvidence){const other=JSON.parse(await readFile(join(resolve(this.root,this.config.baselineEvidence),'summary.json'),'utf8'));assert.equal(compareIdentity(other,this.summary).same,true,'baseline_identity_mismatch');}
  for(let i=0;i<32;i++){const p=await this.waitFor(async()=>{const p=await this.status(i);return p.app_state==='online'?p:false;},'adapter_online',15000,{service:false});this.connections.push(p.connection_id);}assert.equal(new Set(this.connections).size,32,'duplicate_connection');
  for(let i=0;i<16;i++){await this.during(()=>this.createSession(i));await this.service();}
  await this.page.getByRole('button',{name:'soak-00 에이전트 제어',exact:true}).click();
  await this.waitFor(async()=>this.sessions.every(s=>s.oracle.count>0),'all_streams');
  await this.json('initial-memory-input.json',await this.receipt());
  const initial=JSON.parse(await this.ps('sample-test-memory.ps1',['-Evidence',join(this.out,'initial-memory-input.json'),'-AdapterPids',this.adapters.map(a=>a.process.child.pid).join(',')]));
  this.adapterIdentities=initial.processes.filter(p=>this.adapters.some(a=>a.process.child.pid===p.pid));assert.equal(this.adapterIdentities.length,32);this.summary.adapterIdentities=this.adapterIdentities;this.summary.debugPort=this.port;
  await this.checkHashes();await this.event('setup_complete');await this.save();
 }
 async createSession(index){
  const f=this.fixtures[index%2],page=this.page;await page.getByLabel('이름',{exact:true}).fill(`soak-${String(index).padStart(2,'0')}`);await page.getByLabel('서버 주소',{exact:true}).fill('127.0.0.1');await page.getByLabel('포트',{exact:true}).fill(String(f.port));await page.getByLabel('사용자 이름',{exact:true}).fill('batonfixture');
  await page.getByRole('button',{name:'연결',exact:true}).click();await page.getByRole('button',{name:'이 연결에서 신뢰',exact:true}).waitFor();assert.ok((await page.locator('.challenge pre').innerText()).includes(f.fingerprint));await page.getByRole('button',{name:'이 연결에서 신뢰',exact:true}).click();await page.locator('.challenge input[type=password]').fill('baton-fixture-only');await page.getByRole('button',{name:'인증',exact:true}).click();
  await page.getByLabel('전달할 MCP 연결').selectOption(this.connections[index]);await page.getByRole('button',{name:'에이전트에 전달',exact:true}).click();
  const assigned=await this.waitFor(async()=>(await this.status(index)).sessions.find(s=>s.state==='agent_owned'),'initial_handoff');
  const s={index,id:assigned.session_id,adapter:index,epoch:assigned.control_epoch,stream:assigned.stream_id,cursor:0,oracle:new LogOracle(index),lastLog:this.now(),audits:[]};
  await this.command(s,`stty -echo -onlcr; PS1=''; : > /tmp/soak-audit-${index}; bash /tmp/soak-stream.sh ${index} &`);this.sessions.push(s);await this.event('session_ready',{index,id:s.id,adapter:index,epoch:s.epoch,stream:s.stream});
 }
 async shutdown(){
  await this.browser?.close();this.browser=undefined;this.page=undefined;assert.ok(this.app,'app_not_started');
  const receipt=await this.receipt();await this.ps('close-test-process.ps1',['-ProcessId',String(receipt.pid),'-Executable',this.summary.binaries.app.path,'-StartedTicks',String(receipt.startedTicks)]);
  const exit=await deadline(this.app.closed,15000,'normal_exit');assert.equal(exit.code,0);const final=await this.receipt();assertProcessIdentity(receipt,final);
  const eofs=[];for(let i=0;i<this.adapters.length;i++){assert.equal((await this.status(i)).app_state,'offline');eofs.push({index:i,code:await this.adapters[i].eof(),stderr:this.adapters[i].stderr});}
  await this.event('shutdown',{exit,process:final,eofs});this.summary.shutdown=validateShutdown(final,eofs);return this.summary.shutdown;
 }
 async cleanup(){
  const failures=[];let forced=false;for(const [label,op] of [['browser',()=>this.browser?.close()],...this.adapters.map((a,i)=>['adapter'+i,async()=>{if(a.process.child.exitCode===null&&a.process.child.signalCode===null)forced=true;await a.cleanup();}]),['app',async()=>{if(this.app){if(this.app.child.exitCode===null&&this.app.child.signalCode===null)forced=true;await stop(this.app);}}]])try{await op();}catch(e){failures.push(label+':'+e);}
  for(const f of this.fixtures)try{await cleanupFixture(this.docker,f,this.owner);}catch(e){failures.push('fixture:'+e);}
  let receipt={normalExit:false,forcedCleanup:false},remaining=this.adapters.filter(a=>a.process.child.exitCode===null&&a.process.child.signalCode===null),containers=[];
  try{if(this.app){receipt=await this.receipt();await this.json('exit-input.json',{...receipt,adapters:this.adapterIdentities??[]});remaining=JSON.parse(await this.ps('sample-test-process-roles.ps1',['-Evidence',join(this.out,'exit-input.json'),'-VerifyExited']));}if(this.fixtures.length)containers=(await this.docker('ps','-aq','--filter','label=baton.soak='+this.owner)).split(/\r?\n/).filter(Boolean);}catch(e){failures.push('cleanup_verification:'+e);}
  const result={normalExit:receipt.normalExit===true,forcedCleanup:forced||receipt.forcedCleanup!==false,remainingProcesses:remaining.length,remainingContainers:containers.length,failures};
  this.summary.cleanup=result;await this.json('final-cleanup.json',{owner:this.owner,fixtures:this.fixtures,process:receipt,remaining,containers,...result});await this.save();return result;
 }
}
