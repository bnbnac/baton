import assert from 'node:assert/strict';
const median=a=>{a=[...a].sort((x,y)=>x-y);return (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2;};
const identity=p=>`${p.pid}:${p.startedTicks}`;
const group=p=>['app','renderer','adapter'].includes(p.role)?p.role:'otherWebView';
const groups=['app','renderer','adapter','otherWebView','total'];
const keys=['privateBytes','workingSetBytes'];
function provenance(a){
 assert.ok(Object.keys(a.sources).length>0,'missing_sources');
 for(const h of Object.values(a.sources))assert.match(h,/^[a-f0-9]{64}$/,'source_hash');
 for(const k of ['app','adapter'])assert.match(a.binaries[k].sha256,/^[a-f0-9]{64}$/,'binary_hash');
 assert.equal(a.fixtures.length,2,'fixture_count');
 for(const f of a.fixtures)assert.match(f.image,/^sha256:[a-f0-9]{64}$/,'fixture_image');
 assert.equal(a.fixtures[0].image,a.fixtures[1].image,'fixture_images_differ');
 for(const k of ['platform','arch','osRelease','node','webview','playwright'])assert.ok(typeof a.environment[k]==='string'&&a.environment[k].length>0,'environment_'+k);
}
export function analyzeArm(a){
 try{
  assert.equal(a.mode,'diagnostic','not_diagnostic');assert.equal(a.status,'diagnostic_completed','incomplete');
  assert.ok(['baseline','transitions'].includes(a.condition),'condition');
  assert.ok(Number.isFinite(a.elapsedSeconds)&&a.elapsedSeconds>=3600,'duration');provenance(a);
  for(const k of ['rates','audit','health','transitions'])assert.equal(a.checks[k],true,'check_'+k);
  assert.equal(a.cleanup.normalExit,true,'normal_exit');assert.equal(a.cleanup.forcedCleanup,false,'forced_cleanup');
  for(const k of ['remainingProcesses','remainingContainers'])assert.equal(a.cleanup[k],0,k);
  const known=new Map();let stable,previous=-1;
  for(const s of a.samples){
   assert.ok(Number.isFinite(s.elapsed)&&s.elapsed>=0&&s.elapsed<3600&&s.elapsed>previous,'sample_time');previous=s.elapsed;
   assert.ok(!s.phase||s.phase==='natural','gc_contamination');
   assert.equal(new Set(s.processes.map(p=>p.pid)).size,s.processes.length,'duplicate_pid');
   for(const p of s.processes){
    assert.ok(Number.isSafeInteger(p.pid)&&p.pid>0&&/^\d+$/.test(p.startedTicks),'identity');
    assert.ok(['app','adapter','renderer','browser','gpu-process','utility','crashpad-handler'].includes(p.role),'unknown_role');
    for(const k of keys)assert.ok(Number.isFinite(p[k])&&p[k]>=0,'invalid_memory');
    if(known.has(p.pid))assert.equal(known.get(p.pid),p.startedTicks,'pid_reused');else known.set(p.pid,p.startedTicks);
   }
   const counts=r=>s.processes.filter(p=>p.role===r);
   assert.equal(counts('app').length,1,'app_count');assert.equal(counts('renderer').length,1,'renderer_count');assert.equal(counts('adapter').length,32,'adapter_count');
   const current=s.processes.filter(p=>['app','renderer','adapter'].includes(p.role)).map(identity).sort();
   if(stable)assert.deepEqual(current,stable,'process_replaced');else stable=current;
  }
  const windows=[1200,2400].map(start=>{
   const rows=a.samples.filter(s=>s.elapsed>=start&&s.elapsed<start+1200);assert.ok(rows.length>=39,'sample_count');
   const times=[start,...rows.map(r=>r.elapsed),start+1200];for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]<=45,'sample_gap');
   return {start,end:start+1200,count:rows.length,groups:Object.fromEntries(groups.map(g=>[g,Object.fromEntries(keys.map(k=>[k,median(rows.map(r=>r.processes.filter(p=>g==='total'||group(p)===g).reduce((n,p)=>n+p[k],0)))]))]))};
  });
  assert.ok(a.diagnostics.every(d=>['natural','pre_gc','post_gc'].includes(d.phase)),'diagnostic_phase');
  const pre=a.diagnostics.filter(d=>d.phase==='pre_gc'),post=a.diagnostics.filter(d=>d.phase==='post_gc');
  assert.equal(pre.length,1,'pre_gc_count');assert.equal(post.length,1,'post_gc_count');
  assert.ok(pre[0].elapsed>=3600&&post[0].elapsed>=pre[0].elapsed,'early_gc');
  const natural=a.diagnostics.filter(d=>d.phase==='natural');assert.equal(natural.length,12,'natural_diagnostic_count');
  const times=[0,...natural.map(d=>d.elapsed),3600];for(let i=1;i<times.length;i++)assert.ok(times[i]>times[i-1]&&times[i]-times[i-1]<=315,'diagnostic_gap');
  assert.equal(new Set(natural.map(d=>Math.floor(d.elapsed/300))).size,12,'diagnostic_slots');
  for(const d of a.diagnostics){
   assert.ok(Number.isFinite(d.elapsed)&&d.elapsed>=0,'diagnostic_time');
   if(d.phase==='natural')assert.ok(d.elapsed<3600&&d.gc!==true,'natural_gc');
   for(const k of ['usedSize','totalSize','backingStorageSize','embedderHeapUsedSize'])assert.ok(Number.isFinite(d.heap[k])&&d.heap[k]>=0,'heap_'+k);
   for(const k of ['documents','nodes','jsEventListeners'])assert.ok(Number.isSafeInteger(d.dom[k])&&d.dom[k]>=0,'dom_'+k);
   for(const k of ['callbacks','domElements'])assert.ok(Number.isSafeInteger(d.state[k])&&d.state[k]>=0,'state_'+k);
   assert.equal(d.state.terminals,16,'terminals');
  }
  return {valid:true,reasons:[],condition:a.condition,windows,ratios:Object.fromEntries(groups.map(g=>[g,Object.fromEntries(keys.map(k=>[k,windows[0].groups[g][k]>0?windows[1].groups[g][k]/windows[0].groups[g][k]:null]))])),preGC:pre[0],postGC:post[0]};
 }catch(e){return {valid:false,reasons:[e.message],condition:a?.condition};}
}
export function analyzeComparison(a,b){
 const arms=[analyzeArm(a),analyzeArm(b)],reasons=arms.flatMap((r,i)=>r.reasons.map(s=>`${i}:${s}`));
 try{assert.equal(a.condition,'baseline');assert.equal(b.condition,'transitions');provenance(a);provenance(b);assert.deepEqual(a.sources,b.sources,'sources_differ');for(const k of ['app','adapter'])assert.equal(a.binaries[k].sha256,b.binaries[k].sha256,'binaries_differ');assert.equal(a.fixtures[0].image,b.fixtures[0].image,'server_images_differ');assert.deepEqual(a.environment,b.environment,'runtime_differ');}catch(e){reasons.push(e.message);}
 return {valid:reasons.length===0,reasons,arms};
}
