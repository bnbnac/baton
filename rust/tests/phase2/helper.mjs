import {fork,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {deadline,observe,stop} from '../helpers/process.mjs';
let build;
export async function executable() {
  build ??= (async()=>{
    const p=observe(spawn('cargo',['+stable','build','--manifest-path',fileURLToPath(new URL('../../Cargo.toml',import.meta.url)),'--locked','-p','baton-ssh','--features','acceptance','--bin','baton-ssh-fixture-driver','--message-format=json'],{windowsHide:true,stdio:['ignore','pipe','pipe']}));
    let output='',errors='';p.child.stdout.on('data',b=>output+=b);p.child.stderr.on('data',b=>errors+=b);
    const exit=await deadline(p.closed,120000,'build_timeout');if(exit.code!==0)throw Error(errors);
    const artifact=output.trim().split('\n').map(l=>JSON.parse(l)).find(m=>m.target?.name==='baton-ssh-fixture-driver'&&m.executable);
    if(!artifact)throw Error('missing_executable');return artifact.executable;
  })();return build;
}
export async function runCase(name) {
  const exe=await executable();const fixture=observe(fork(fileURLToPath(new URL('../fixtures/ssh.mjs',import.meta.url)),[name],{silent:true,windowsHide:true,execArgv:[]}));
  const events=[];let driver,second;
  try {
    const ready=await deadline(new Promise((resolve,reject)=>{fixture.child.on('message',m=>{events.push(m);if(m.type==='ready')resolve(m);});fixture.closed.then(()=>reject(Error('fixture_closed')));}),5000,'ready_timeout');
    const ports=[ready.port];
    if(name==='multi') {second=observe(fork(fileURLToPath(new URL('../fixtures/ssh.mjs',import.meta.url)),['password'],{silent:true,windowsHide:true,execArgv:[]}));const other=await deadline(new Promise(resolve=>second.child.on('message',m=>{events.push({...m,second:true});if(m.type==='ready')resolve(m);})),5000,'second_ready_timeout');ports.push(other.port);}
    driver=observe(spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','pipe']}));let stdout='',stderr='';driver.child.stdout.on('data',b=>stdout+=b);driver.child.stderr.on('data',b=>stderr+=b);
    driver.child.stdin.on('error',()=>{});
    createInterface({input:driver.child.stdout}).on('line',line=>{const m=JSON.parse(line);if(m.stage==='cancelled')fixture.child.send({type:'release-auth'});if(m.outcome)driver.child.stdin.end();});
    fixture.child.on('message',m=>{if(m.type==='auth-held')driver.child.stdin.write('cancel\n');});
    driver.child.stdin.write(JSON.stringify({case:name,port:ready.port,private_key:ready.privateKey??null,ports})+'\n');
    const exit=await deadline(driver.closed,15000,'driver_timeout');if(exit.code!==0)throw Error(`driver_failed: ${stderr}`);
    for(const secret of ['fixture-only','fixture-key-pass','123456','654321','PRIVATE KEY'])if(stdout.includes(secret)||stderr.includes(secret))throw Error('credential_leak');
    const messages=stdout.trim().split('\n').map(l=>JSON.parse(l));
    // Observe peer close before fixture cleanup, so cleanup cannot manufacture success.
    if(events.some(e=>e.type==='authentication')) await deadline(new Promise(resolve=>{if(events.some(e=>e.type==='closed'))resolve();else fixture.child.on('message',m=>{if(m.type==='closed')resolve();});}),2000,'connection_leaked');
    return {events,messages,outcome:messages.find(m=>m.outcome)?.outcome};
  } finally {const results=await Promise.allSettled([...(driver?[stop(driver)]:[]),...(second?[stop(second)]:[]),stop(fixture)]);for(const r of results)if(r.status==='rejected')throw r.reason;}
}
