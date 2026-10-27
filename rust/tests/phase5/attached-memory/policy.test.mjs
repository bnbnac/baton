import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveArm,slot,nextSampleAt,memoryResult} from './policy.mjs';

function sample(elapsed,scale=1){
 const processes=[{role:'app',pid:1},{role:'renderer',pid:2},{role:'browser',pid:3},...Array.from({length:32},(_,i)=>({role:'adapter',pid:i+10}))].map(p=>({...p,startedTicks:String(p.pid),privateBytes:1000*scale,workingSetBytes:2000*scale}));
 const ownership={pid:1,startedTicks:'1',descendants:processes.filter(p=>!['app','adapter'].includes(p.role)),adapters:processes.filter(p=>p.role==='adapter')};
 const endpoint={pid:3,startedTicks:'3',localAddress:'127.0.0.1',localPort:9222,remoteAddress:'127.0.0.1',remotePort:10000};
 return {elapsed,phase:'minimal_cdp_attached',cdpState:'open',processes,ownership,debugPort:{port:9222,listeners:[endpoint],connections:[endpoint]},privateBytes:processes.reduce((n,p)=>n+p.privateBytes,0),workingSetBytes:processes.reduce((n,p)=>n+p.workingSetBytes,0)};
}
const samples=(ratio=1)=>Array.from({length:240},(_,i)=>sample(i*30,i<40?10:i>=200?ratio:1));
test('absolute slots cover all sixteen sessions and retain full end',()=>{
 assert.deepEqual(slot(resolveArm('B','full'),0,119),{startMs:7140000,deadlineMs:7200000,index:7});
 assert.deepEqual([0,1,2].map(k=>slot(resolveArm('B','preflight'),0,k).index),[0,1,2]);
 assert.equal(slot(resolveArm('A','full'),42,119).index,0);
 for(const args of [['C','full'],['A','fast']])assert.throws(()=>resolveArm(...args));
 for(const k of [-1,120,0.5])assert.throws(()=>slot(resolveArm('A','full'),0,k));
});
test('sampling follows absolute ticks without backfill',()=>{
 assert.equal(nextSampleAt(0,35000),60000);assert.equal(nextSampleAt(1000,31000),61000);
 assert.equal(nextSampleAt(0,125000),150000);
});
test('memory threshold is inclusive, warmup excluded, extra ratios descriptive',()=>{
 const pass=memoryResult(samples(1.2),7204,'full');assert.equal(pass.memoryPassed,true);assert.equal(pass.windows.length,5);assert.equal(pass.ratios.privateRatio,1.2);assert.equal(pass.windows[0].samples,40);
 assert.equal(memoryResult(samples(1.200001),7200,'full').memoryPassed,false);
 const peak=samples();for(let i=80;i<120;i++)peak[i]=sample(i*30,3);
 assert.equal(memoryResult(peak,7200,'full').memoryPassed,true);
 assert.equal(memoryResult(samples().slice(0,6),180,'preflight').memoryPassed,null);
});
test('valid thirty-sample windows pass and twenty-nine fail',()=>{
 const thirty=Array.from({length:180},(_,i)=>sample(i*40));assert.equal(memoryResult(thirty,7200,'full').memoryPassed,true);
 const missing=thirty.filter(s=>s.elapsed<1200||s.elapsed>=2400);
 missing.push(...Array.from({length:29},(_,i)=>sample(1200+i*1200/29)));missing.sort((a,b)=>a.elapsed-b.elapsed);
 assert.throws(()=>memoryResult(missing,7200,'full'),/insufficient_memory_samples/);
});
test('duplicate observations cannot fill a thirty-sample window',()=>{
 const rows=Array.from({length:180},(_,i)=>sample(i*40)).filter(s=>s.elapsed<1200||s.elapsed>=2400);
 rows.push(...Array.from({length:29},(_,i)=>sample(1200+i*1200/29)));rows.sort((a,b)=>a.elapsed-b.elapsed);
 assert.throws(()=>memoryResult(rows,7200,'full'),/insufficient_memory_samples/);rows.push(sample(1200));rows.sort((a,b)=>a.elapsed-b.elapsed);assert.throws(()=>memoryResult(rows,7200,'full'),/sample_boundary/);
});
for(const mode of ['gap','end-gap','late','duration','overshoot','sum','foreign','reused','identity','phase','none','extra','negative','nan'])test('rejects invalid memory '+mode,()=>{
 const rows=samples();let duration=7200;
 if(mode==='gap')rows.splice(1,1);
 if(mode==='end-gap')rows.pop();
 if(mode==='late')rows.push(sample(7200));
 if(mode==='duration')duration=7199;
 if(mode==='overshoot')duration=7216;
 if(mode==='sum')rows[3].privateBytes++;
 if(mode==='foreign')rows[3].ownership.descendants=[];
 if(mode==='reused')rows[3].processes[0].startedTicks='other';
 if(mode==='identity'){rows[3].processes[0].startedTicks='other';rows[3].ownership.startedTicks='other';}
 if(mode==='phase')rows[3].phase='natural';
 if(mode==='none')rows[3].debugPort.connections=[];
 if(mode==='extra')rows[3].debugPort.connections.push({...rows[3].debugPort.connections[0]});
 if(mode==='negative')rows[3].elapsed=-1;
 if(mode==='nan')rows[3].elapsed=NaN;
 assert.throws(()=>memoryResult(rows,duration,'full'));
});
