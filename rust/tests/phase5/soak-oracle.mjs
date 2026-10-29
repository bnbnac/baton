import assert from 'node:assert/strict';
export class LogOracle {
 constructor(id){this.id=id;this.count=0;this.bytes=0;this.reset();}
 reset(){this.buffer='';this.last=null;}
 push(text){
  this.bytes+=Buffer.byteLength(text);this.buffer+=text;
  assert.ok(this.buffer.length<=65536,'log_buffer_limit');
  let end;
  while((end=this.buffer.indexOf('\n'))>=0){
   const line=this.buffer.slice(0,end).replace(/\r$/,'');this.buffer=this.buffer.slice(end+1);
   const offset=line.indexOf('SOAK:');if(offset<0)continue;
   const m=/^SOAK:(\d+):(\d{8}):(x+)$/.exec(line.slice(offset));
   assert.ok(m,'log_payload_corrupt');assert.equal(m[3].length,1008,'log_payload_length');
   assert.equal(Number(m[1]),this.id,'foreign_session');const n=Number(m[2]);
   if(this.last!==null)assert.equal(n,this.last+1,'log_sequence');
   this.last=n;this.count++;
  }
 }
}
const median=values=>{const s=[...values].sort((a,b)=>a-b);return (s[Math.floor((s.length-1)/2)]+s[Math.floor(s.length/2)])/2;};
export function memoryWindows(samples,duration){
 assert.ok(duration>=7200,'insufficient_duration');const windows=[];
 for(let start=1200;start<7200;start+=1200){
  const rows=samples.filter(s=>s.elapsed>=start&&s.elapsed<start+1200);
  assert.ok(rows.length>=30,'insufficient_memory_samples');
  for(const r of rows)for(const k of ['privateBytes','workingSetBytes'])assert.ok(Number.isFinite(r[k])&&r[k]>0,'invalid_memory_sample');
  windows.push({start,end:start+1200,samples:rows.length,privateBytes:median(rows.map(s=>s.privateBytes)),workingSetBytes:median(rows.map(s=>s.workingSetBytes))});
 }
 const privateRatio=windows.at(-1).privateBytes/windows[0].privateBytes,workingSetRatio=windows.at(-1).workingSetBytes/windows[0].workingSetBytes;
 assert.ok(privateRatio<=1.2&&workingSetRatio<=1.2,'memory_growth_over_20_percent');return {windows,privateRatio,workingSetRatio};
}
