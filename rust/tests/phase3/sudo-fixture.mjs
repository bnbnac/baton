// Synthetic sudo policy/authentication state machine over a real SSH channel.
// It never invokes host sudo or modifies the user's machine.
import ssh2 from 'ssh2';
import net from 'node:net';
import { createInterface } from 'node:readline';
const clients=new Set(),streams=new Map(),audit=new Map();
const server=new ssh2.Server({hostKeys:[ssh2.utils.generateKeyPairSync('ed25519').private]},client=>{
 clients.add(client);let user;client.on('error',()=>{});client.on('close',()=>{clients.delete(client);if(user)audit.get(user).closed=true;});
 client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username.startsWith('fixture-')&&ctx.password==='fixture-only'){user=ctx.username;audit.set(user,{hex:'',closed:false,sudo:0,auth:0,forbidden:0,mode:'required',waiting:false,line:''});ctx.accept();}else ctx.reject(['password']);});
 client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('pty',accept=>accept());session.on('window-change',accept=>accept?.());session.on('shell',accept=>{
  const stream=accept();streams.set(user,stream);stream.on('error',()=>{});stream.on('data',bytes=>{
   const entry=audit.get(user);entry.hex+=bytes.toString('hex');entry.line+=bytes.toString('utf8');
   while(/[\r\n]/.test(entry.line)){const at=entry.line.search(/[\r\n]/),line=entry.line.slice(0,at);entry.line=entry.line.slice(at+1);
    if(entry.waiting){entry.waiting=false;if(line==='SYNTHETIC_PASSWORD_PHASE3'){entry.auth++;entry.mode='ready';stream.write('AUTH_READY\r\n');}else stream.write('AUTH_FAILED\r\n');continue;}
    if(line==='fixture-auth'){entry.waiting=true;stream.write('Fixture password: ');}
    else if(line==='sudo -n du -sh /root'){entry.sudo++;stream.write(entry.mode==='required'?'sudo: a password is required\r\n':entry.mode==='denied'?'sudo: command not allowed\r\n':'44K\t/root\r\n');}
    else if(line.includes('sudo')){entry.forbidden++;stream.write('UNEXPECTED_SUDO_COMMAND\r\n');}
   }
  });
 });}));
});
const control=net.createServer(socket=>{socket.on('error',()=>{});createInterface({input:socket}).once('line',line=>{try{const r=JSON.parse(line),entry=audit.get(r.user);let result;
 if(r.action==='audit'){result=entry?{hex:entry.hex,closed:entry.closed,sudo:entry.sudo,auth:entry.auth,forbidden:entry.forbidden,mode:entry.mode}:null;}
 else if(r.action==='sudo-mode'&&['required','denied','ready'].includes(r.mode)){entry.mode=r.mode;result={ok:true};}
 else if(r.action==='inject'){streams.get(r.user).write(Buffer.from(r.bytes));result={ok:true};}
 else throw Error('unknown_action');socket.end(JSON.stringify(result)+'\n');}catch{socket.end(JSON.stringify({error:'fixture_error'})+'\n');}});});
server.listen(0,'127.0.0.1',()=>control.listen(0,'127.0.0.1',()=>process.send?.({type:'ready',port:server.address().port,control:control.address().port})));
let stopping=false;function stop(){if(stopping)return;stopping=true;for(const client of clients)client.end();server.close(()=>control.close(()=>{if(process.connected)process.disconnect();}));}
process.on('message',m=>{if(m.type==='stop')stop();});process.on('disconnect',stop);
