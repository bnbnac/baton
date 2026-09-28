import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {observe,deadline,stop} from '../helpers/process.mjs';
test('normal desktop close observes every WebView descendant exit before fixture cleanup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-cleanup-test-')),report=join(dir,'report.json');
 const runner=observe(spawn(process.execPath,[fileURLToPath(new URL('./desktop.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BATON_DESKTOP_REPORT:report,BATON_DESKTOP_CASE:'cpr_agent_owned'}}));
 let errors='';runner.child.stdout.resume();runner.child.stderr.on('data',b=>errors+=b);
 try{assert.equal((await deadline(runner.closed,40000,'cleanup_test_timeout')).code,0,errors);const result=JSON.parse(await readFile(report,'utf8'));assert.equal(result.process.descendantAudit,'verified');assert.equal(result.process.forcedCleanup,false);assert.ok(result.process.descendants.length>0);assert.ok(result.process.descendants.every(p=>p.exited&&p.startedTicks&&p.path));}finally{await stop(runner);}
});
async function waitJson(path,check,label){const end=Date.now()+15000;while(Date.now()<end){try{const value=JSON.parse(await readFile(path,'utf8'));if(check(value))return value;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}await new Promise(r=>setTimeout(r,50));}throw Error(label);}
function alive(pid){try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
for(const stage of ['auth-wait','output-wait','before-cleanup'])test(`interrupted ${stage} runner releases only its own app and WebViews`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-interrupt-'));
 const launch=kind=>{const report=join(dir,kind+'.json'),barrier=join(dir,kind+'.barrier'),processReport=join(dir,kind+'.process.json');const runner=observe(spawn(process.execPath,[fileURLToPath(new URL('./desktop.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BATON_DESKTOP_REPORT:report,BATON_PROCESS_REPORT:processReport,BATON_DESKTOP_HOLD:kind,BATON_DESKTOP_BARRIER:barrier,BATON_DESKTOP_CASE:'cpr_agent_owned'}}));runner.child.stdout.resume();runner.child.stderr.resume();return {runner,barrier,processReport};};
 const sentinel=launch('sentinel'),victim=launch(stage);
 try{
   await waitJson(sentinel.barrier,v=>v.stage==='sentinel','sentinel_barrier_missing');
   await waitJson(victim.barrier,v=>v.stage===stage,'interruption_barrier_missing');
   const keep=await waitJson(sentinel.processReport,v=>v.descendants.length>0,'sentinel_identity_missing');
   const owned=await waitJson(victim.processReport,v=>v.descendants.length>0,'owned_identity_missing');
   victim.runner.child.kill();await deadline(victim.runner.closed,5000,'runner_kill_timeout');
   const cleaned=await waitJson(victim.processReport,v=>v.forcedCleanup&&v.descendantAudit==='verified','owned_cleanup_not_observed');
   assert.equal(alive(owned.pid),false);assert.ok(cleaned.descendants.every(p=>p.exited&&!alive(p.pid)));assert.equal(alive(keep.pid),true);assert.ok(keep.descendants.some(p=>alive(p.pid)));
 }finally{const results=await Promise.allSettled([victim,sentinel].map(async item=>{item.runner.child.kill();await stop(item.runner);await waitJson(item.processReport,v=>(v.forcedCleanup||v.normalExit)&&v.descendantAudit==='verified','final_cleanup_timeout');}));for(const result of results)if(result.status==='rejected')throw result.reason;}
});
