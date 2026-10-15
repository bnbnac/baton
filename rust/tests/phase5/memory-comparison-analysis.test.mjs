import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeArm,analyzeComparison} from './memory-comparison-analysis.mjs';
const hash='a'.repeat(64);
function arm(condition='baseline'){
 const processes=value=>[{pid:1,startedTicks:'1',role:'app',privateBytes:value,workingSetBytes:value*2},{pid:2,startedTicks:'2',role:'renderer',privateBytes:value,workingSetBytes:value*2},...Array.from({length:32},(_,i)=>({pid:i+10,startedTicks:String(i+10),role:'adapter',privateBytes:1,workingSetBytes:2}))];
 const d=(elapsed,phase)=>({elapsed,phase,heap:{usedSize:200,totalSize:300,backingStorageSize:10,embedderHeapUsedSize:50},dom:{documents:2,nodes:100,jsEventListeners:20},state:{callbacks:17,terminals:16,domElements:50}});
 return {condition,mode:'diagnostic',status:'diagnostic_completed',elapsedSeconds:3601,sources:{runner:hash},binaries:{app:{sha256:hash},adapter:{sha256:hash}},fixtures:[{image:'sha256:'+hash},{image:'sha256:'+hash}],environment:{platform:'win32',arch:'x64',osRelease:'test',node:'22',webview:'155',playwright:'1'},checks:{rates:true,audit:true,health:true,transitions:true},cleanup:{normalExit:true,forcedCleanup:false,remainingProcesses:0,remainingContainers:0},samples:Array.from({length:120},(_,i)=>({elapsed:i*30,processes:processes(i<80?100:150)})),diagnostics:[...Array.from({length:12},(_,i)=>d(i*300+5,'natural')),d(3601,'pre_gc'),d(3602,'post_gc')]};
}
test('half-open windows and GC observations remain separate, growth is not invalidity',()=>{
 const a=arm(),b=arm('transitions');a.diagnostics[1].privateBytes=999999;
 const r=analyzeComparison(a,b);assert.equal(r.valid,true,JSON.stringify(r));
 assert.equal(r.arms[0].windows[0].count,40);assert.equal(r.arms[0].windows[1].count,40);
 assert.equal(r.arms[0].windows[0].groups.renderer.privateBytes,100);
 assert.equal(r.arms[0].windows[1].groups.renderer.privateBytes,150);
 assert.equal(r.arms[0].ratios.renderer.privateBytes,1.5);
});
for(const [name,mutate] of [
 ['missing window',a=>{a.samples=a.samples.filter(s=>s.elapsed<2400);}],
 ['one missing sample creates long gap',a=>{a.samples.splice(70,1);}],
 ['missing leading coverage',a=>{a.samples=a.samples.filter(s=>s.elapsed>=1260);}],
 ['missing ending coverage',a=>{a.samples=a.samples.filter(s=>s.elapsed<3540);}],
 ['duplicate sample',a=>{a.samples.splice(70,0,a.samples[70]);}],
 ['renderer replaced',a=>{a.samples[70].processes[1].pid=999;}],
 ['PID reused',a=>{a.samples[70].processes[1].startedTicks='999';}],
 ['renderer missing',a=>{a.samples[70].processes.splice(1,1);}],
 ['adapter missing',a=>{a.samples[70].processes.pop();}],
 ['GC sample contamination',a=>{a.samples[70].phase='post_gc';}],
 ['premature GC',a=>{a.diagnostics.at(-1).elapsed=3599;}],
 ['missing natural diagnostics',a=>{a.diagnostics=a.diagnostics.filter(d=>d.phase!=='natural');}],
 ['missing diagnostic slot',a=>{a.diagnostics.splice(5,1);}],
 ['missing DOM',a=>{delete a.diagnostics[5].dom;}],
 ['missing callback count',a=>{delete a.diagnostics[5].state.callbacks;}],
 ['invalid backing size',a=>{a.diagnostics[5].heap.backingStorageSize=NaN;}],
 ['early natural GC',a=>{a.diagnostics[5].gc=true;}],
 ['fixture image differs within arm',a=>{a.fixtures[1].image='sha256:'+'b'.repeat(64);}],
 ['missing fixture',a=>{a.fixtures.pop();}],
 ['missing runtime provenance',a=>{delete a.environment;}],
 ['missing GC',a=>{a.diagnostics.pop();}],
 ['invalid memory',a=>{a.samples[70].processes[1].privateBytes=NaN;}],
 ['short duration',a=>{a.elapsedSeconds=3599;}],
 ['smoke',a=>{a.mode='smoke';}],
 ['failed load',a=>{a.checks.rates=false;}],
 ['failed audit',a=>{a.checks.audit=false;}],
 ['failed transition',a=>{a.checks.transitions=false;}],
 ['incomplete run',a=>{a.status='running';}],
 ['forced cleanup',a=>{a.cleanup.forcedCleanup=true;}],
 ['remaining process',a=>{a.cleanup.remainingProcesses=1;}],
 ['remaining container',a=>{a.cleanup.remainingContainers=1;}],
 ['missing provenance',a=>{a.sources={};}],
 ])test('rejects '+name,()=>{const a=arm();mutate(a);assert.equal(analyzeArm(a).valid,false);});
test('rejects condition and source/binary differences',()=>{
 const a=arm(),b=arm('transitions');assert.equal(analyzeComparison(a,arm()).valid,false);
 b.sources.runner='b'.repeat(64);assert.equal(analyzeComparison(a,b).valid,false);
 b.sources.runner=hash;b.binaries.adapter.sha256='c'.repeat(64);assert.equal(analyzeComparison(a,b).valid,false);
});
test('rejects server image and runtime differences between arms',()=>{
 const a=arm(),b=arm('transitions');b.fixtures.forEach(f=>{f.image='sha256:'+'b'.repeat(64);});assert.equal(analyzeComparison(a,b).valid,false);
 const c=arm('transitions');c.environment.webview='156';assert.equal(analyzeComparison(a,c).valid,false);
});
