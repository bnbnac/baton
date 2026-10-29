import test from 'node:test';import assert from 'node:assert/strict';import ssh2 from 'ssh2';import {createHash} from 'node:crypto';import {fork} from 'node:child_process';import {fileURLToPath} from 'node:url';import net from 'node:net';
import {observe,deadline,stop} from '../helpers/process.mjs';
const control=(port,request)=>deadline(new Promise((r,j)=>{const s=net.connect(port,'127.0.0.1',()=>s.end(JSON.stringify(request)+'\n'));let data='';s.on('data',b=>data+=b);s.on('end',()=>r(JSON.parse(data)));s.on('error',j);}),2000,'audit');
test('manual fixture independently audits bytes while forwarding PTY, resize, output and close',async()=>{
 const key=ssh2.utils.generateKeyPairSync('ed25519'),sizes=[],connections=new Set();let wire='';
 const upstream=new ssh2.Server({hostKeys:[key.private]},client=>{connections.add(client);client.on('error',()=>{});client.on('authentication',ctx=>ctx.username==='batonfixture'&&ctx.password==='baton-fixture-only'?ctx.accept():ctx.reject());client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('pty',(accept,_,p)=>{sizes.push([p.cols,p.rows]);accept();});session.on('window-change',(accept,_,p)=>{sizes.push([p.cols,p.rows]);accept?.();});session.on('shell',accept=>{const stream=accept();stream.on('data',b=>{wire+=b.toString();stream.write('ECHO:'+b);});});}));});
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const fingerprint='SHA256:'+createHash('sha256').update(ssh2.utils.parseKey(key.private).getPublicSSH()).digest('base64').replace(/=+$/,'');
 const fixture=observe(fork(fileURLToPath(new URL('./desktop-fixture.mjs',import.meta.url)),[],{silent:true,windowsHide:true,execArgv:[],env:{...process.env,BATON_MANUAL_PROXY_PORT:String(upstream.address().port),BATON_PROBE_HOST_KEY:fingerprint}}));
 let errors='';fixture.child.stderr.on('data',b=>errors+=b);fixture.child.stdout.resume();
 const client=new ssh2.Client();client.on('error',()=>{});
 try{
  const ready=await deadline(new Promise(r=>fixture.child.on('message',m=>{if(m.type==='ready')r(m);})),5000,'ready');
  await deadline(new Promise((r,j)=>{client.once('ready',r);client.once('error',j);client.connect({host:'127.0.0.1',port:ready.port,username:'fixture-manual',password:'fixture-only'});}),5000,'connect');
  const stream=await new Promise((r,j)=>client.shell({cols:120,rows:32},(e,s)=>e?j(e):r(s)));
  assert.deepEqual(await control(ready.control,{action:'mark',user:'fixture-manual',caseId:'physical-key',mode:'user_owned'}),{ok:true});
  const output=deadline(new Promise(r=>stream.once('data',b=>r(b.toString()))),2000,'proxy_output_missing');
  stream.setWindow(27,91,0,0);stream.write('MANUAL');assert.equal(await output,'ECHO:MANUAL');assert.equal(wire,'MANUAL');assert.deepEqual(sizes,[[120,32],[91,27]]);
  const audited=await deadline(new Promise((r,j)=>{const s=net.connect(ready.control,'127.0.0.1',()=>s.end(JSON.stringify({action:'audit',user:'fixture-manual'})+'\n'));let data='';s.on('data',b=>data+=b);s.on('end',()=>r(JSON.parse(data)));s.on('error',j);}),2000,'audit');assert.equal(audited.hex,'4d414e55414c');
  const captured=await control(ready.control,{action:'capture',user:'fixture-manual'});assert.equal(captured.receivedHex,'4d414e55414c');assert.equal(captured.caseId,'physical-key');assert.equal(captured.mode,'user_owned');
  assert.equal((await control(ready.control,{action:'capture',user:'fixture-manual'})).error,'no_mark');
  await stop(fixture);assert.equal((await fixture.closed).code,0,'fixture must close a still-connected peer cleanly: '+errors);
 }finally{client.destroy();await stop(fixture);for(const c of connections)c.end();await deadline(new Promise(r=>upstream.close(r)),3000,'upstream_close');}
});
