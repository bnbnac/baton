import {fork,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,mkdir,readFile,writeFile,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {observe,stop,deadline} from '../helpers/process.mjs';
const expectFailure=process.argv.includes('--expect-failure');
const manual=process.env.BATON_DESKTOP_SUITE==='manual',manualProxy=manual||process.env.BATON_DESKTOP_SUITE==='manual-smoke';
const runDir=process.env.BATON_MANUAL_RUN_DIR?resolve(process.env.BATON_MANUAL_RUN_DIR):await mkdtemp(join(tmpdir(),'baton-desktop-'));
await mkdir(runDir,{recursive:true});
const fixtureEnv={...process.env,...(manualProxy?{BATON_MANUAL_PROXY_PORT:process.env.BATON_PROBE_SSH_PORT,BATON_MANUAL_AUDIT_LOG:join(runDir,'observations.jsonl')}:{})};
const report=resolve(process.env.BATON_DESKTOP_REPORT??fileURLToPath(new URL('../../../.superpowers/sdd/2026-09-27-rust-phase-2-desktop/desktop-result.json',import.meta.url)));
const fixture=observe(fork(fileURLToPath(new URL('./desktop-fixture.mjs',import.meta.url)),[],{silent:true,windowsHide:true,execArgv:[],env:fixtureEnv}));let app,second;
try{
  const config=await deadline(new Promise(resolve=>fixture.child.on('message',m=>{if(m.type==='ready')resolve(m);})),5000,'fixture_ready_timeout');
  second=observe(fork(fileURLToPath(new URL('./desktop-fixture.mjs',import.meta.url)),[],{silent:true,windowsHide:true,execArgv:[]}));
  const other=await deadline(new Promise(resolve=>second.child.on('message',m=>{if(m.type==='ready')resolve(m);})),5000,'second_ready_timeout');
  const runReport=join(runDir,'result.json');
  const exe=fileURLToPath(new URL('../../target/debug/baton-ui-acceptance.exe',import.meta.url));
  const processReport=process.env.BATON_PROCESS_REPORT??join(runDir,'process.json');
  // The monitor must outlive this runner, including closure of its stdio pipes.
  const monitorLog=await open(processReport+'.log','w');
  try{app=observe(spawn(process.execPath,[fileURLToPath(new URL('./desktop-supervisor.mjs',import.meta.url)),'-File',fileURLToPath(new URL('../../scripts/desktop-process.ps1',import.meta.url)),'-Executable',exe,'-Evidence',processReport,'-OwnerPid',String(process.pid),'-TimeoutSeconds',manual?'1800':'180'],{detached:true,windowsHide:true,stdio:['ignore',monitorLog.fd,monitorLog.fd],env:{...process.env,BATON_FIXTURE_PORT:String(config.port),BATON_CONTROL_PORT:String(config.control),BATON_SECOND_PORT:String(other.port),BATON_SECOND_CONTROL:String(other.control),BATON_DESKTOP_REPORT:runReport,BATON_WEBVIEW_DATA:join(runDir,'webview')}}));}finally{await monitorLog.close();}
  if(manual)console.log('MANUAL_OBSERVATIONS '+join(runDir,'observations.jsonl'));
  const exit=await deadline(app.closed,manual?1810000:190000,'desktop_timeout');if(exit.code!==0)throw Error(`desktop_exit_${exit.code}: ${await readFile(processReport+'.log','utf8')}`);
  const result=JSON.parse(await readFile(runReport,'utf8'));result.process=JSON.parse(await readFile(processReport,'utf8'));
  await writeFile(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  if(!manual&&(!result.outcomes.length||result.outcomes.some(x=>!x.passed)!==expectFailure))throw Error('unexpected_desktop_result');
}finally{for(const r of await Promise.allSettled([...(app?[stop(app)]:[]),...(second?[stop(second)]:[]),stop(fixture)]))if(r.status==='rejected')throw r.reason;}
