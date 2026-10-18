import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntime,cleanupFixture,validateShutdown,assertProcessIdentity,verifyStreamTicks} from './runtime.mjs';
import {LogOracle} from '../soak-oracle.mjs';
const line=(n,id=0)=>`SOAK:${id}:${String(n).padStart(8,'0')}:${'x'.repeat(1008)}\n`;
async function local(t){const out=await mkdtemp(join(tmpdir(),'baton-separated-'));t.after(()=>rm(out,{recursive:true,force:true}));const r=createRuntime({root:out,out,config:{},contract:{scope:'F',profile:'preflight'}});await r.init();return r;}
const session=()=>({index:0,id:'s0',adapter:0,epoch:1,stream:'one',cursor:0,oracle:new LogOracle(0)});
test('isolated launch creates the LOCALAPPDATA parent while leaving protected IPC children to the app',async t=>{
 const r=await local(t);await assert.rejects(stat(join(r.out,'local')),/ENOENT/);await r.prepareLocalRoot();
 assert.equal((await stat(join(r.out,'local'))).isDirectory(),true);await assert.rejects(stat(join(r.out,'local','BatonRust')),/ENOENT/);
});
test('Linux generator preflight needs 90 ticks with exactly the three specified bursts',()=>{
 let n=0;const raw=Array.from({length:90},(_,i)=>'TICK\n'+Array.from({length:(i+1)%30===0?5:1},()=>line(++n,99)).join('')).join('');
 assert.deepEqual(verifyStreamTicks(raw),{ticks:90,burstTicks:[30,60,90],cumulative:[34,68,102],records:102});assert.throws(()=>verifyStreamTicks(raw.replace('TICK\n','')));
});
test('failed container creation response recovers only exact owner and name',async()=>{
 const f={name:'owned'},removed=[];
 const docker=async(...args)=>{
  if(args[0]==='ps'){assert.deepEqual(args.slice(1),['-aq','--filter','label=baton.soak=owner','--filter','name=^/owned$']);return 'id';}
  if(args[0]==='inspect')return JSON.stringify([{Id:'id',Name:'/owned',Config:{Labels:{'baton.soak':'owner'}}}]);
  if(args[0]==='rm'){removed.push(args.at(-1));return '';}
  throw Error('unexpected docker');
 };
 await cleanupFixture(docker,f,'owner');assert.deepEqual(removed,['id']);assert.equal(f.removed,true);
});
test('foreign label or name is never removed',async()=>{
 for(const actual of [{Id:'id',Name:'/other',Config:{Labels:{'baton.soak':'owner'}}},{Id:'id',Name:'/owned',Config:{Labels:{'baton.soak':'other'}}}]){
  let removed=false;await assert.rejects(cleanupFixture(async op=>{if(op==='inspect')return JSON.stringify([actual]);removed=true;}, {id:'id',name:'owned'},'owner'));
  assert.equal(removed,false);
 }
});
test('public gaps and mixed session data are rejected after raw write',async t=>{
 const r=await local(t),s=session();r.sessions.push(s);
 await r.acceptOutput(s,{oldest_cursor:0,next_cursor:1,text:line(1)});
 await assert.rejects(r.acceptOutput(s,{oldest_cursor:0,next_cursor:2,text:line(3)}),/log_sequence/);
 assert.ok((await readFile(join(r.out,'output.jsonl'),'utf8')).includes('00000003'));
 const s2=session();await assert.rejects(r.acceptOutput(s2,{oldest_cursor:0,next_cursor:1,text:line(1,1)}),/foreign_session/);
});
test('adoption requires reclaimed boundary and never joins two streams',async t=>{
 const r=await local(t),s=session();r.sessions.push(s);
 await r.acceptOutput(s,{oldest_cursor:0,next_cursor:1,text:line(1).slice(0,20)});
 await assert.rejects(r.adoptBinding(s,{adapter:16,epoch:3,stream:'two'}),/transition/);
 await r.setTransition(s,'reclaimed');
 await r.adoptBinding(s,{adapter:16,epoch:3,stream:'two'});
 await r.acceptOutput(s,{oldest_cursor:0,next_cursor:1,text:line(12)});
 assert.equal(s.oracle.last,12);assert.equal(s.adapter,16);
});
test('write failure cannot advance cursor and stop does not prevent cleanup',async t=>{
 const r=await local(t),s=session();r.sessions.push(s);
 await rm(join(r.out,'output.jsonl'));await writeFile(join(r.out,'stop'),'');
 await assert.rejects(r.service(),/stop_requested/);
 // Replacing the output file with a directory makes the actual append fail.
 const {mkdir}=await import('node:fs/promises');await mkdir(join(r.out,'output.jsonl'));
 await assert.rejects(r.acceptOutput(s,{oldest_cursor:0,next_cursor:1,text:line(1)}));assert.equal(s.cursor,0);
 const result=await r.cleanup();assert.equal(result.normalExit,false);assert.equal(result.remainingProcesses,0);
});
test('normal exit cannot be certified by 31 EOFs, force cleanup or reused PID',()=>{
 const process={normalExit:true,forcedCleanup:false,descendantAudit:'verified'},eofs=Array.from({length:32},(_,index)=>({index,code:0,stderr:''}));
 assert.equal(validateShutdown(process,eofs).adapterEof,32);
 assert.throws(()=>validateShutdown(process,eofs.slice(1)));
 assert.throws(()=>validateShutdown({...process,forcedCleanup:true},eofs));
 assert.throws(()=>assertProcessIdentity({pid:1,startedTicks:'1'},{pid:1,startedTicks:'2'}));
});
test('concurrent service waits serialize reads instead of consuming the same cursor twice',async t=>{
 const r=await local(t),s=session();r.sessions.push(s);let active=0,max=0,cursor=0;
 r.adapters.push({tool:async()=>{active++;max=Math.max(max,active);await new Promise(done=>setTimeout(done,5));active--;return {content:[{text:JSON.stringify({oldest_cursor:0,next_cursor:++cursor,text:line(cursor)})}]};}});
 await Promise.all([r.service(),r.service()]);assert.equal(max,1);assert.equal(s.oracle.count,2);
});
test('waitFor rejects success after service or check exceeds the deadline',async t=>{
 const r=await local(t);let time=0;r.now=()=>time;r.service=async()=>{time=46000;};
 await assert.rejects(r.waitFor(async()=>true,'late',45000),/late_timeout/);
 time=0;r.service=async()=>{};await assert.rejects(r.waitFor(async()=>{time=46000;return true;},'late',45000),/late_timeout/);
});
test('reclaim intent drains backlog and continues public reads until confirmed private',async t=>{
 const r=await local(t),s=session();r.sessions.push(s);let n=0;
 r.read=async()=>{n++;if(n<=3)await r.acceptOutput(s,{oldest_cursor:0,next_cursor:n,text:line(n)});};
 await r.startMeasurement();await r.setTransition(s,'reclaiming');assert.equal(n,4,'drain through an empty read');assert.equal(s.privateStart,undefined);
 await r.service();assert.equal(n,5,'intent is still public');
});
test('only a proven reclaim can retire a rejected public read as an unverified boundary',async t=>{
 const r=await local(t),s=session();r.sessions.push(s);r.transition={session:s,stage:'reclaiming'};
 r.adapters.push({tool:async name=>({content:[{text:JSON.stringify(name==='status'?{sessions:[{session_id:'s0',state:'user_owned',control_epoch:2,stream_id:null}]}:{code:'stale_control_epoch'})}]})});
 await r.service();assert.equal(r.transition.publicRetired,true);assert.equal(s.privateStart,undefined);assert.equal(s.cursor,0);
 const rows=(await readFile(join(r.out,'events.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.ok(rows.some(v=>v.type==='public_boundary_unverified'&&v.cursor===0));
 r.transition={session:s,stage:'reclaiming'};r.adapters[0].tool=async()=>({content:[{text:JSON.stringify({code:'app_offline'})}]});await assert.rejects(r.read(s),/bad_cursor/);
});
