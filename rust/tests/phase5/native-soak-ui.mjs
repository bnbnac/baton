import {resolve,join} from 'node:path';
import {readRequest,acknowledge} from './native-soak-control.mjs';
const [action,out,id,selectedSession]=process.argv.slice(2);
if(!out||!['peek','done','failed'].includes(action))throw Error('usage: native-soak-ui.mjs peek|done|failed evidence-directory [request-id] [selected-session-id]');
const dir=join(resolve(out),'native');
if(action==='peek')console.log(JSON.stringify(await readRequest(dir),null,2));
else{await acknowledge(dir,id,action==='done'?'performed':'failed',Date.now,selectedSession);console.log('Action receipt recorded; MCP/server verification is still required.');}
