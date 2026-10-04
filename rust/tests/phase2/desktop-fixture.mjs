import ssh2 from 'ssh2';
import net from 'node:net';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
const marks=new Map();
const streams=new Map(),audit=new Map(),clients=new Set();
const emit=(type,data={})=>{if(process.connected)process.send({type,...data},()=>{});};
const server=new ssh2.Server({hostKeys:[ssh2.utils.generateKeyPairSync('ed25519').private]},client=>{
  clients.add(client);let user;
  client.on('error',()=>{});client.on('close',()=>{clients.delete(client);if(user){audit.get(user).closed=true;emit('closed',{user});}});
  client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username.startsWith('fixture-')&&ctx.password==='fixture-only'){user=ctx.username;audit.set(user,{hex:'',sizes:[],closed:false});ctx.accept();}else ctx.reject(['password']);});
  client.on('ready',()=>client.on('session',accept=>{
    const session=accept();let dimensions={cols:120,rows:32},remote;
    session.on('pty',(accept,_,info)=>{dimensions=info;audit.get(user).sizes.push([info.cols,info.rows,performance.now()]);accept();});
    session.on('window-change',(accept,_,info)=>{dimensions=info;audit.get(user).sizes.push([info.cols,info.rows,performance.now()]);remote?.setWindow(info.rows,info.cols,0,0);accept?.();});
    const attach=stream=>{streams.set(user,stream);stream.on('error',()=>{});stream.on('data',bytes=>{audit.get(user).hex+=bytes.toString('hex');});return stream;};
    session.on('shell',(accept,reject)=>{
      const port=Number(process.env.BATON_MANUAL_PROXY_PORT);
      if(!port){attach(accept());return;}
      const upstream=new ssh2.Client();let accepted=false;
      client.once('close',()=>upstream.destroy());
      upstream.on('error',()=>{if(!accepted)reject();else client.end();});
      upstream.on('ready',()=>upstream.shell({cols:dimensions.cols,rows:dimensions.rows,term:'xterm-256color'},(error,channel)=>{
        if(error){reject();upstream.end();return;}
        accepted=true;remote=channel;const stream=attach(accept());
        stream.pipe(channel);channel.pipe(stream);channel.stderr.pipe(stream);
        channel.on('error',()=>client.end());channel.on('close',()=>{stream.end();upstream.end();});stream.on('close',()=>upstream.end());
      }));
      upstream.connect({host:'127.0.0.1',port,username:'batonfixture',password:'baton-fixture-only',readyTimeout:10000,hostVerifier:key=>'SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'')===process.env.BATON_PROBE_HOST_KEY});
    });
  }));
});
const control=net.createServer(socket=>{socket.on('error',()=>{});createInterface({input:socket}).once('line',line=>{void(async()=>{
 const m=JSON.parse(line);let result;
 if(m.action==='inject'){const stream=streams.get(m.user);if(!stream)throw Error('missing_stream');stream.write(Buffer.from(m.bytes));result={ok:true};}
 else if(m.action==='remote-exit'){const stream=streams.get(m.user);if(!stream)throw Error('missing_stream');stream.end(Buffer.from(m.bytes));stream.exit(0);result={ok:true};}
 else if(m.action==='audit'){result=audit.get(m.user)??null;}
 else if(m.action==='mark'&&process.env.BATON_MANUAL_PROXY_PORT){
   const state=audit.get(m.user);if(!state)throw Error('missing_stream');
   if(!/^[a-z0-9-]{1,64}$/.test(m.caseId)||!['user_owned','agent_owned'].includes(m.mode))throw Error('bad_mark');
   marks.set(m.user,{caseId:m.caseId,mode:m.mode,offset:state.hex.length,startedUtc:new Date().toISOString()});result={ok:true};
 }else if(m.action==='capture'&&process.env.BATON_MANUAL_PROXY_PORT){
   const mark=marks.get(m.user);if(!mark)throw Error('no_mark');marks.delete(m.user);
   const state=audit.get(m.user);result={...mark,observedUtc:new Date().toISOString(),receivedHex:state.hex.slice(mark.offset),sizes:state.sizes,serverObserved:true};
   if(process.env.BATON_MANUAL_AUDIT_LOG)appendFileSync(process.env.BATON_MANUAL_AUDIT_LOG,JSON.stringify(result)+'\n');
 }else throw Error('unknown_action');
 socket.end(JSON.stringify(result)+'\n');
 })().catch(e=>socket.end(JSON.stringify({error:e.message})+'\n'));});});
server.listen(0,'127.0.0.1',()=>control.listen(0,'127.0.0.1',()=>emit('ready',{port:server.address().port,control:control.address().port})));
let stopping=false;function stop(){if(stopping)return;stopping=true;for(const client of clients)client.end();server.close(()=>control.close(()=>{if(process.connected)process.disconnect();}));}
process.on('message',m=>{if(m.type==='stop')stop();});process.on('disconnect',stop);
