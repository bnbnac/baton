import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open,readFile,access} from 'node:fs/promises';
import {resolve,join,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..'),[output,configuration,mode]=process.argv.slice(2);
assert.ok(output&&configuration&&['smoke','release'].includes(mode),'usage: native-soak-launch.mjs fresh-directory config.json smoke|release');
const out=resolve(output),configPath=resolve(configuration),rel=relative(join(root,'artifacts'),out);
assert.ok(rel&&!rel.startsWith('..')&&!isAbsolute(rel),'output_outside_artifacts');
try{await access(out);throw Error('output_already_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
const config=JSON.parse((await readFile(configPath,'utf8')).replace(/^\uFEFF/,''));
assert.equal(config.nativeDriver,'codex-computer-use');
for(const key of ['app','adapter'])assert.equal(createHash('sha256').update(await readFile(resolve(root,config[key].path))).digest('hex'),config[key].sha256,'binary_mismatch');
if(mode==='release'){assert.ok(config.smokeEvidence,'smoke_evidence_required');await access(resolve(root,config.smokeEvidence));}
const commit=(await promisify(execFile)('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true})).stdout.trim();
const record=await open(out+'.launch.json','wx');let log;
try{
 log=await open(out+'.log','wx');
 const child=spawn(process.execPath,[join(root,'rust/tests/phase5/native-soak.mjs'),out,configPath,mode],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd]});
 await new Promise((r,j)=>{child.once('spawn',r);child.once('error',j);});
 const result={pid:child.pid,out,mode,launchedUtc:new Date().toISOString(),commit,configPath};
 await record.writeFile(JSON.stringify(result,null,2));child.unref();console.log(JSON.stringify(result,null,2));
}finally{await log?.close();await record.close();}
