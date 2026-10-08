import net from 'node:net';
import { fork, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { observe, deadline, stop } from '../helpers/process.mjs';
import { Adapter } from './stdio.mjs';
export async function runCase(name) {
  const root=fileURLToPath(new URL('../../../artifacts/phase3-integration/',import.meta.url));await mkdir(root,{recursive:true});
  const dir=await mkdtemp(join(root,name+'-')),endpoint=join(dir,'endpoint'),reportPath=join(dir,'report.json');
  const children=[],adapters=new Map(),transcript=[],serverAudit=[];let app,gateway,report;
  async function ssh() {
    const script=name==='phase3-sudo'?'./sudo-fixture.mjs':'../phase2/desktop-fixture.mjs';
    const child=observe(fork(fileURLToPath(new URL(script,import.meta.url)),[],{silent:true,windowsHide:true,execArgv:[]}));children.push(child);child.child.stdout.resume();
    const diagnosticPath=join(dir,`ssh-fixture-${children.length}.json`);let diagnostic='';
    child.child.stderr.on('data',bytes=>{diagnostic=(diagnostic+bytes.toString()).slice(0,8192);});
    return deadline(new Promise((resolve,reject)=>{child.child.on('message',m=>{if(m.type==='ready')resolve(m);});child.closed.then(async exit=>{
      await writeFile(diagnosticPath,JSON.stringify({...exit,stderr:diagnostic},null,2));
      reject(Error(`ssh_fixture_closed:${exit.code??exit.signal} (see ${diagnosticPath})`));
    }).catch(reject);}),5000,'ssh_fixture_timeout');
  }
  async function forward(port,request) {
    const socket=net.connect(port,'127.0.0.1');
    try{return await deadline(new Promise((resolve,reject)=>{socket.on('error',reject);createInterface({input:socket}).once('line',line=>{try{resolve(JSON.parse(line));}catch(e){reject(e);}});socket.end(JSON.stringify(request)+'\n');}),10000,'ssh_control_timeout');}
    finally{socket.destroy();}
  }
  try {
    const servers=[await ssh(),await ssh()];const sockets=new Set();
    gateway=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));createInterface({input:socket}).once('line',line=>{void(async()=>{
      const request=JSON.parse(line);let result;
      if(request.action==='mcp-start') {
        for(const owner of ['a','b']) {const adapter=new Adapter(endpoint);adapters.set(owner,adapter);await adapter.initialize();}
        result={};for(const [owner,adapter] of adapters){const status=await adapter.tool('status');transcript.push(status);result[owner]=JSON.parse(status.content[0].text);}
      } else if(request.action==='mcp-call') {
        result=await adapters.get(request.owner).tool(request.name,request.arguments);transcript.push(result);
      } else if(request.action==='mcp-eof') {
        result={code:await adapters.get(request.owner).eof()};
      } else if(request.action==='transcript') {
        result={json:JSON.stringify(transcript)};
      } else if(request.action==='progress') {result={ok:true};}
      else {result=await forward(servers[request.server===2?1:0].control,request);
        if(request.action==='audit'&&result){const {hex,...metadata}=result;serverAudit.push({server:request.server??1,user:request.user,serverObserved:true,byteLength:hex.length/2,sha256:createHash('sha256').update(Buffer.from(hex,'hex')).digest('hex'),...metadata,...(name!=='phase3-sudo'?{receivedHex:hex}:{})});}
      }
      socket.end(JSON.stringify(result)+'\n');
    })().catch(()=>socket.end(JSON.stringify({error:'fixture_request_failed'})+'\n'));});});
    await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));const control=gateway.address().port;
    const processReport=join(dir,'process.json'),log=await open(join(dir,'process.log'),'w');
    try {app=observe(spawn(process.execPath,[fileURLToPath(new URL('../phase2/desktop-supervisor.mjs',import.meta.url)),'-File',fileURLToPath(new URL('../../scripts/desktop-process.ps1',import.meta.url)),'-Executable',fileURLToPath(new URL('../../target/debug/baton-ui-acceptance.exe',import.meta.url)),'-Evidence',processReport,'-OwnerPid',String(process.pid),'-TimeoutSeconds','120'],{
      detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,BATON_PHASE3_ENDPOINT:endpoint,BATON_FIXTURE_PORT:String(servers[0].port),BATON_SECOND_PORT:String(servers[1].port),BATON_CONTROL_PORT:String(control),BATON_SECOND_CONTROL:String(control),BATON_DESKTOP_REPORT:reportPath,BATON_WEBVIEW_DATA:join(dir,'webview'),BATON_DESKTOP_CASE:name,BATON_DESKTOP_SUITE:'phase3'},
    }));} finally {await log.close();}
    const exit=await deadline(app.closed,130000,'phase3_desktop_timeout');if(exit.code!==0)throw Error('phase3_desktop_exit_'+exit.code+': '+await readFile(join(dir,'process.log'),'utf8'));
    report=JSON.parse(await readFile(reportPath,'utf8'));report.process=JSON.parse(await readFile(processReport,'utf8'));report.observer='automated WebView + real MCP stdio + SSH fixture byte audit';report.serverAudit=serverAudit;
    await writeFile(reportPath,JSON.stringify(report,null,2));await writeFile(join(dir,'mcp-transcript.json'),JSON.stringify(transcript,null,2));
    for(const adapter of adapters.values()){if(adapter.failure)throw adapter.failure;if(adapter.stderr)throw Error('adapter_stderr_not_empty');}
    const diagnostics=JSON.stringify(transcript)+await readFile(join(dir,'process.log'),'utf8');
    for(const value of ['SYNTHETIC_PASSWORD_PHASE3',Buffer.from('SYNTHETIC_PASSWORD_PHASE3').toString('hex'),Buffer.from('SYNTHETIC_PASSWORD_PHASE3').toString('base64')])if(diagnostics.includes(value))throw Error('synthetic_secret_in_diagnostics');
    console.log('Phase 3 evidence: '+reportPath);return report;
  } finally {
    const results=await Promise.allSettled([...adapters.values()].map(a=>a.cleanup()).concat(children.map(c=>stop(c)),app?[stop(app)]:[]));
    if(gateway)await new Promise(resolve=>{gateway.close(resolve);});
    const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
    if(report){report.fixtureCleanup={ssh:children.every(c=>c.child.exitCode===0),adapters:[...adapters.values()].every(a=>a.process.child.exitCode===0)};await writeFile(reportPath,JSON.stringify(report,null,2));}
  }
}
