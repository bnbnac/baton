import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {reserveLaunch,root} from './run.mjs';
import {resolveContract,validateConfig} from './contract.mjs';
import {sha256} from './runtime.mjs';
const [output,configPath,scope,profile]=process.argv.slice(2);assert.ok(output&&configPath,'usage: launch.mjs fresh-dir config.json M|F|N preflight|full');
const contract=resolveContract(scope,profile),out=resolve(output),configuration=resolve(configPath),config=validateConfig(JSON.parse((await readFile(configuration,'utf8')).replace(/^\uFEFF/,'')));
for(const key of ['app','adapter'])assert.equal(await sha256(resolve(root,config[key].path)),config[key].sha256,'binary_hash');
if(contract.profile==='full'&&scope!=='N')assert.ok(config.preflightEvidence?.[scope],'preflight_required');
const execute=promisify(execFile),commit=(await execute('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true})).stdout.trim();const {record,log}=await reserveLaunch(root,out);
try{
 const child=spawn(process.execPath,[join(root,'rust/tests/phase5/separated/run.mjs'),out,configuration,scope,profile],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
 await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});
 const info={pid:child.pid,out,configuration,scope,profile,commit,launchedUtc:new Date().toISOString()};
 await record.writeFile(JSON.stringify(info,null,2)+'\n');child.unref();console.log(JSON.stringify(info,null,2));
}finally{await log.close();await record.close();}
