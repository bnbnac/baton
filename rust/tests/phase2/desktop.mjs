import {fork,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {observe,stop,deadline} from '../helpers/process.mjs';
const expectFailure=process.argv.includes('--expect-failure');
const report=resolve(process.env.BATON_DESKTOP_REPORT??fileURLToPath(new URL('../../../.superpowers/sdd/2026-09-27-rust-phase-2-desktop/desktop-result.json',import.meta.url)));
const fixture=observe(fork(fileURLToPath(new URL('./desktop-fixture.mjs',import.meta.url)),[],{silent:true,windowsHide:true,execArgv:[]}));let app,second;
try{
  const config=await deadline(new Promise(resolve=>fixture.child.on('message',m=>{if(m.type==='ready')resolve(m);})),5000,'fixture_ready_timeout');
  second=observe(fork(fileURLToPath(new URL('./desktop-fixture.mjs',import.meta.url)),[],{silent:true,windowsHide:true,execArgv:[]}));
  const other=await deadline(new Promise(resolve=>second.child.on('message',m=>{if(m.type==='ready')resolve(m);})),5000,'second_ready_timeout');
  const runDir=await mkdtemp(join(tmpdir(),'baton-desktop-'));const runReport=join(runDir,'result.json');
  const exe=fileURLToPath(new URL('../../target/debug/baton-ui-acceptance.exe',import.meta.url));
  app=observe(spawn(exe,[],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BATON_FIXTURE_PORT:String(config.port),BATON_CONTROL_PORT:String(config.control),BATON_SECOND_PORT:String(other.port),BATON_SECOND_CONTROL:String(other.control),BATON_DESKTOP_REPORT:runReport,BATON_WEBVIEW_DATA:join(runDir,'webview')}}));
  let stderr='';app.child.stderr.on('data',b=>{stderr+=b;process.stderr.write(b);});
  const exit=await deadline(app.closed,180000,'desktop_timeout');if(exit.code!==0)throw Error(`desktop_exit_${exit.code}: ${stderr}`);
  const result=JSON.parse(await readFile(runReport,'utf8'));result.process={pid:app.child.pid,normalExit:true,descendantAudit:'unverified'};
  await writeFile(report,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  if(!result.outcomes.length||result.outcomes.some(x=>!x.passed)!==expectFailure)throw Error('unexpected_desktop_result');
}finally{for(const r of await Promise.allSettled([...(app?[stop(app)]:[]),...(second?[stop(second)]:[]),stop(fixture)]))if(r.status==='rejected')throw r.reason;}
