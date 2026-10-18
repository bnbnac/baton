import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {publishNative} from './native.mjs';
const [action,out,id,observation]=process.argv.slice(2);
if(!out||!['peek','start','done','failed'].includes(action))throw Error('usage: native-ui.mjs peek|start|done|failed evidence-dir [request-id] [observation-json]');
const dir=join(resolve(out),'native');
async function optional(name){try{return JSON.parse(await readFile(join(dir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
if(action==='peek')console.log(JSON.stringify({pending:await optional('pending.json'),active:await optional('active.json')},null,2));
else{
 const result=await publishNative(dir,action,id,observation?JSON.parse(observation):undefined);
 if(action==='start'){
  const end=performance.now()+5000;let active;
  do{active=await optional('active.json');if(active?.id===id)break;await new Promise(r=>setTimeout(r,100));}while(performance.now()<end);
  result.active=active?.id===id?active:null;result.inputAllowed=Boolean(result.active);
 }
 console.log(JSON.stringify(result,null,2));
}
