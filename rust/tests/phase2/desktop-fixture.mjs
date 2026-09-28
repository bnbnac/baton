import ssh2 from 'ssh2';
import net from 'node:net';
import {createInterface} from 'node:readline';
const streams=new Map(),audit=new Map(),clients=new Set();
const emit=(type,data={})=>process.send?.({type,...data});
const server=new ssh2.Server({hostKeys:[ssh2.utils.generateKeyPairSync('ed25519').private]},client=>{
  clients.add(client);let user;
  client.on('error',()=>{});client.on('close',()=>{clients.delete(client);if(user){audit.get(user).closed=true;emit('closed',{user});}});
  client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username.startsWith('fixture-')&&ctx.password==='fixture-only'){user=ctx.username;audit.set(user,{hex:'',sizes:[],closed:false});ctx.accept();}else ctx.reject(['password']);});
  client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('pty',(accept,_,info)=>{audit.get(user).sizes.push([info.cols,info.rows,performance.now()]);accept();});session.on('window-change',(accept,_,info)=>{audit.get(user).sizes.push([info.cols,info.rows,performance.now()]);accept?.();});session.on('shell',accept=>{const stream=accept();streams.set(user,stream);stream.on('error',()=>{});stream.on('data',bytes=>{audit.get(user).hex+=bytes.toString('hex');});});}));
});
const control=net.createServer(socket=>{socket.on('error',()=>{});createInterface({input:socket}).once('line',line=>{void(async()=>{const m=JSON.parse(line);let result;if(m.action==='inject'){const stream=streams.get(m.user);if(!stream)throw Error('missing_stream');stream.write(Buffer.from(m.bytes));result={ok:true};}else if(m.action==='audit'){result=audit.get(m.user)??null;}else throw Error('unknown_action');socket.end(JSON.stringify(result)+'\n');})().catch(e=>socket.end(JSON.stringify({error:e.message})+'\n'));});});
server.listen(0,'127.0.0.1',()=>control.listen(0,'127.0.0.1',()=>emit('ready',{port:server.address().port,control:control.address().port})));
let stopping=false;function stop(){if(stopping)return;stopping=true;for(const client of clients)client.destroy();server.close(()=>control.close(()=>process.disconnect?.()));}
process.on('message',m=>{if(m.type==='stop')stop();});process.on('disconnect',stop);
