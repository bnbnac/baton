// Run a product binary with isolated local state while a native UI driver exercises
// the system menu. No CDP, JS evaluation, diagnostic logging, or SSH session.
// Usage: node .../system-menu-smoke.mjs config.json output-directory
// The driver appends timestamped observations to actions.jsonl and creates done.json
// only after its planned cases. The last UI action must close the app normally.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,appendFile,open,access} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {Adapter,data} from '../phase3/stdio.mjs';
import {observe,deadline,stop} from '../helpers/process.mjs';

const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const out=resolve(process.argv[3]),root=process.cwd();
await mkdir(out);await mkdir(join(out,'local'));
const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
for(const binary of [config.app,config.adapter])assert.equal(await hash(resolve(binary.path)),binary.sha256);
const start=performance.now(),summary={startedUtc:new Date().toISOString(),runnerPid:process.pid,
 app:config.app,adapter:config.adapter,sshSessions:0,cdpConnections:0,phase5Acceptance:false};
const record=async(type,fields={})=>appendFile(join(out,'events.jsonl'),JSON.stringify({type,t:performance.now()-start,utc:new Date().toISOString(),...fields})+'\n');
const exists=async name=>{try{await access(join(out,name));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
let app,adapter,identity,onlineAt;
const log=await open(join(out,'process.log'),'wx');
try {
 const env={...process.env,PATH:dirname(config.pwsh)+';'+process.env.PATH,LOCALAPPDATA:join(out,'local'),
  BATON_WEBVIEW_DATA:join(out,'webview'),WEBVIEW2_USER_DATA_FOLDER:join(out,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:''};
 delete env.BATON_DIAGNOSTIC_LOG;delete env.BATON_TAO_LOG;
 app=observe(spawn(process.execPath,[join(root,'rust/tests/phase2/desktop-supervisor.mjs'),'-File',join(root,'rust/scripts/desktop-process.ps1'),
  '-Executable',resolve(config.app.path),'-Evidence',join(out,'process.json'),'-OwnerPid',String(process.pid),'-TimeoutSeconds','600'],
  {windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd],env}));
 await log.close();adapter=new Adapter(join(out,'local/BatonRust/v2'),{executable:resolve(config.adapter.path),cwd:out});
 await adapter.initialize();summary.adapterPid=adapter.process.child.pid;
 await writeFile(join(out,'launch.json'),JSON.stringify(summary,null,2));
 while(performance.now()-start<570000) {
  if(await exists('done.json')){summary.driverDone=JSON.parse(await readFile(join(out,'done.json'),'utf8'));break;}
  const state=data(await adapter.tool('status'));await record('status',{state});
  // The driver marks closing BEFORE selecting the native Close command.
  if(!await exists('closing.json')) {
   if(!identity&&state.app_state==='online'){identity={app:state.app_instance_id,connection:state.connection_id};onlineAt=performance.now();}
   if(identity){assert.equal(state.app_state,'online','frontend became offline');assert.equal(state.app_instance_id,identity.app);assert.equal(state.connection_id,identity.connection);}
  }
  if(onlineAt!==undefined&&performance.now()-onlineAt>=15000&&!await exists('ready.json'))await writeFile(join(out,'ready.json'),JSON.stringify({utc:new Date().toISOString(),identity}));
  await new Promise(r=>setTimeout(r,1000));
 }
 assert.ok(summary.driverDone,'native driver did not finish');assert.ok(identity,'never online');
 summary.exit=await deadline(app.closed,15000,'normal_app_exit');
 assert.equal(summary.exit.code,0,'supervisor exit');
 summary.adapterEof=await adapter.eof();
 summary.process=JSON.parse(await readFile(join(out,'process.json'),'utf8'));
 assert.equal(summary.process.exitCode,0,'app exit');
 assert.equal(summary.process.normalExit,true);
 assert.equal(summary.process.forcedCleanup,false);
 assert.equal(summary.process.descendantAudit,'verified');
 assert.equal(summary.process.failure,null);
 summary.actions=(await readFile(join(out,'actions.jsonl'),'utf8')).trim().split(/\r?\n/).map(JSON.parse);
} catch(error) {summary.failure=String(error);}
finally {
 for(const [name,fn] of [['adapter',()=>adapter?.cleanup()],['app',()=>app&&stop(app)]])try{await fn();}catch(e){summary[name+'CleanupFailure']=String(e);}
 summary.binariesUnchanged=await hash(resolve(config.app.path))===config.app.sha256&&await hash(resolve(config.adapter.path))===config.adapter.sha256;
 summary.finishedUtc=new Date().toISOString();
 await writeFile(join(out,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}
if(summary.failure)process.exitCode=1;
