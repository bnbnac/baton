import '@xterm/xterm/css/xterm.css';
import {invoke} from '@tauri-apps/api/core';
import {subscribe,command,type Session} from './bridge.js';
import {TerminalView} from './terminal/terminal.js';
import {bindTerminal,terminalBridge} from './terminal/bridge.js';
import type {Frame,Binding} from './terminal/types.js';
const host=document.querySelector<HTMLElement>('#terminal')!;
const enc=new TextEncoder();const bytes=(s:string)=>Array.from(enc.encode(s));
const hex=(s:string)=>bytes(s).map(b=>b.toString(16).padStart(2,'0')).join('');
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// Observe browser side-effect entry points; never access the user's clipboard.
let sideEffects=0;
window.open=()=>{sideEffects++;return null;};
if(navigator.clipboard)for(const name of ['read','readText','write','writeText']){
  Object.defineProperty(navigator.clipboard,name,{value:()=>{sideEffects++;return Promise.reject(Error('fixture_clipboard_access'));}});
}
for(const name of ['showOpenFilePicker','showSaveFilePicker','showDirectoryPicker'])Object.defineProperty(window,name,{value:()=>{sideEffects++;return Promise.reject(Error('fixture_file_access'));}});
document.addEventListener('click',event=>{if(event.target instanceof HTMLInputElement&&event.target.type==='file')sideEffects++;},true);
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
async function rejected(p:Promise<unknown>){try{await p;}catch{return;}throw Error('expected_rejection');}
async function until(check:()=>boolean|Promise<boolean>,label:string){const end=Date.now()+8000;while(!await check()){if(Date.now()>end)throw Error(label);await delay(10);}}
const sessions=new Map<string,Session>();let active:TerminalView|undefined;let number=0;
const fixture=(request:unknown)=>invoke<any>('fixture',{request});
const owner=async(binding:Binding,user:boolean,stream=1)=>{const s=await invoke<Session>('set_owner',{binding,user,stream});active?.applySnapshot(s);return s;};
const cases:Record<string,{parts:string[];want:string}>={
 cpr_agent_owned:{parts:['\x1b[2;3H\x1b[6n'],want:'\x1b[2;3R'},
 mixed_queries:{parts:['\x1b[2;3H\x1b[5n\x1b[6n\x1b[c\x1b[0c'],want:'\x1b[0n\x1b[2;3R\x1b[?1;2c\x1b[?1;2c'},
 two_cpr:{parts:['\x1b[2;3H\x1b[6n\x1b[4;5H\x1b[6n'],want:'\x1b[2;3R\x1b[4;5R'},
 leading_zero:{parts:['\x1b[06n\x1b[2;3H\x1b[6n'],want:'\x1b[1;1R\x1b[2;3R'},
 osc_escape:{parts:['\x1b]0;\x1b[6n\x07\x1b[2;3H\x1b[6n'],want:'\x1b[1;1R\x1b[2;3R'},
 dcs_escape:{parts:['\x1bPq\x1b[6n\x1b\\\x1b[2;3H\x1b[6n'],want:'\x1b[1;1R\x1b[2;3R'},
 untracked_prefix:{parts:['\x1b['+'0'.repeat(70)+'6n\x1b[2;3H\x1b[6n'],want:'\x1b[2;3R'},
 alternate:{parts:['\x1b[?1049h\x1b[4;5H\x1b[6n\x1b[?1049l\x1b[6n'],want:'\x1b[4;5R\x1b[1;1R'},
 origin:{parts:['\x1b[3;20r\x1b[?6h\x1b[2;3H\x1b[6n'],want:'\x1b[4;3R'},
 scroll_region:{parts:['\x1b[3;20r\x1b[20;4H\n\x1b[6n'],want:'\x1b[20;4R'},
 wrap_pending:{parts:['\x1b[1;120HX\x1b[6n'],want:'\x1b[1;121R'},
 wrap_max:{parts:['\x1b[200;500HX\x1b[6n'],want:'\x1b[200;501R'},
 token_attacks:{parts:['\x1b[2;3H\x1b[6n'],want:'\x1b[2;3R'},
 expired:{parts:['\x1b[2;3H\x1b[6n'],want:''},epoch:{parts:['\x1b[2;3H\x1b[6n'],want:''},tokenless:{parts:['\x1b[2;3H\x1b[6n'],want:''},
 untrusted_sequences:{parts:['\x1b]52;c;?\x07\x1b]0;'+'x'.repeat(70000)+'\x07\x1bP'+'x'.repeat(70000)+'\x1b\\\x1b['+'1'.repeat(70000)+'m\x1b[?6n\x1b[>c\x1b[18t\x1b[?1$p\x1bP$qm\x1b\\\x1b]10;?\x07'],want:''},
 output_pressure:{parts:['X'.repeat(65537)],want:''},input_paths:{parts:['\x1b[?1000h\x1b[?1006h'],want:'KEY붙여넣기'},
 private_public_private:{parts:['P','Q','R'],want:''},
 hidden_parser:{parts:['\x1b[2;3H\x1b[6n'],want:'\x1b[2;3R'},
 unsupported_user:{parts:['\x1b[>c\x1b[?6n\x1b[18t\x1b[?1$p\x1bP$qm\x1b\\\x1b]4;1;?\x07\x1b]10;?\x07\x1b]52;c;?\x07'],want:''},
 tokenless_user:{parts:['\x1b[5n\x1b[6n\x1b[c'],want:''},
};
for(let i=1;i<=3;i++)cases[`split_${i}`]={parts:['\x1b[2;3H'+'\x1b[6n'.slice(0,i),'\x1b[6n'.slice(i)],want:'\x1b[2;3R'};
for(let i=1;i<=14;i++){const s='\x1b[06n\x1b[2;3H\x1b[6n';cases[`mixed_split_${i}`]={parts:[s.slice(0,i),s.slice(i)],want:'\x1b[1;1R\x1b[2;3R'};}
async function scenario(name:string,port:number){
 const username=`fixture-${++number}`;let received=0,finished=0,failed:unknown,chain=Promise.resolve();
 const info=await command<Session>('connect_session',{host:'127.0.0.1',port,username,label:name,method:'password'});
 await until(()=>sessions.get(info.id)?.state==='user_owned','connect_timeout');
 const pending:Frame[]=[];let view:TerminalView|undefined;
 const accept=(frame:Frame)=>{received+=frame.bytes.length;chain=chain.then(async()=>{
   const q=frame.queries[0];const b=frame.binding;
   if(q&&name==='expired')await delay(2100);
   if(q&&name==='epoch')await owner(b,true);
   if(q&&name==='token_attacks'){
     await rejected(bridge.reply({...b,view:'00000000000000000000000000000000'},q,2,3));
     await rejected(bridge.reply(b,{...q,epoch:q.epoch-1},2,3));
     await rejected(bridge.reply(b,{...q,kind:'da'}));
     await rejected(bridge.reply(b,q,201,3));
   }
   if(name.startsWith('tokenless'))frame={...frame,queries:[]};
   if(name==='output_pressure')await rejected(bridge.ack(b,frame.seq+1));
   await view!.write(frame);
   if(name==='output_pressure')await rejected(bridge.ack(b,frame.seq));
   if(q&&name==='token_attacks'){await rejected(bridge.reply(b,q,2,3));await rejected(view!.write(frame));}
   finished+=frame.bytes.length;
 }).catch(e=>{failed=e;});};
 const binding=await bindTerminal(info.id,frame=>view?accept(frame):pending.push(frame));
 const errors:unknown[]=[];const bridge=terminalBridge(e=>errors.push(e));
 view=new TerminalView(binding,host,bridge);active=view;view.applySnapshot(sessions.get(info.id)!);
 for(const frame of pending)accept(frame);
 try{
   if(!['private_public_private','unsupported_user','tokenless_user'].includes(name))await owner(binding,false);
   if(name==='wrap_max')view.term.resize(500,200);
   if(name==='hidden_parser')view.setVisible(false);
   let total=0;
   for(const part of cases[name].parts){total+=bytes(part).length;await fixture({action:'inject',user:username,bytes:bytes(part)});await until(()=>!!failed||finished>=total,'output_timeout');if(failed)throw failed;
     if(name==='private_public_private'){
       if(part==='P')await owner(binding,false);
       if(part==='Q'){equal(await invoke('public_read',{binding}),'Q');await owner(binding,true);}
       if(part==='R'){equal(view.term.buffer.active.getLine(0)?.translateToString(true),'PQR');await owner(binding,false,2);equal(await invoke('public_read',{binding}),'');}
     }
   }
   if(name==='input_paths'){
     view.term.input('BLOCKED');view.term.paste('차단');await view.input.flush();
     await owner(binding,true);view.term.input('KEY');view.term.paste('붙여넣기');await view.input.flush();
   }
   const s=['epoch','input_paths','unsupported_user','tokenless_user'].includes(name)?sessions.get(info.id)!:await owner(binding,true);const marker='__FENCE__';
   await bridge.input({binding,epoch:s.epoch,inputSeq:100000,data:bytes(marker)});
   let audit:any;await until(async()=>{audit=await fixture({action:'audit',user:username});return audit?.hex.endsWith(hex(marker));},'wire_timeout');
   equal(audit.hex,hex(cases[name].want+marker));equal(finished,total);equal(received,total);
   equal(sideEffects,0);
   if(name!=='input_paths')equal(errors.length,0);
 }finally{active=undefined;view.dispose();host.replaceChildren();await command('close_session',{id:info.id});await until(async()=>{try{await command('remove_closed_session',{id:info.id});return true;}catch{return false;}},'close_timeout');}
}
async function overload(name:string,port:number){
 const username=`fixture-${++number}`,survivor=`fixture-${++number}`;
 const create=async(user:string)=>{const s=await command<Session>('connect_session',{host:'127.0.0.1',port,username:user,label:name,method:'password'});await until(()=>sessions.get(s.id)?.state==='user_owned','connect_timeout');return s;};
 const bad=await create(username),good=await create(survivor);let delivered=0;
 const badBinding=await bindTerminal(bad.id,frame=>{delivered+=frame.bytes.length;});
 const goodBinding=await bindTerminal(good.id,()=>{});const bridge=terminalBridge(()=>{});
 try{
   const payload=name==='queue_overload'?'X'.repeat(1048577):'\x1b[6n'.repeat(33);
   await fixture({action:'inject',user:username,bytes:bytes(payload)});
   await until(()=>sessions.get(bad.id)?.state==='closed','overload_not_closed');
   if(delivered>65536)throw Error('inflight_budget_exceeded');
   await rejected(bridge.input({binding:badBinding,epoch:0,inputSeq:1,data:bytes('BLOCKED')}));
   await bridge.input({binding:goodBinding,epoch:0,inputSeq:1,data:bytes('SURVIVOR')});
   let audit:any;await until(async()=>{audit=await fixture({action:'audit',user:survivor});return audit.hex===hex('SURVIVOR');},'survivor_failed');
   equal((await fixture({action:'audit',user:username})).hex,'');
 }finally{for(const s of [bad,good]){await command('close_session',{id:s.id});await until(async()=>{try{await command('remove_closed_session',{id:s.id});return true;}catch{return false;}},'close_timeout');}}
}
async function run(){const outcomes:{name:string;passed:boolean;error?:string}[]=[];
 await subscribe(event=>{if(event.type==='sessions'){for(const s of event.sessions){sessions.set(s.id,s);if(active?.binding.session===s.id)active.applySnapshot(s);}}else if(event.type==='auth'){const p=event.prompt;void command('answer_auth',{session:p.session,attempt:p.attempt,challenge:p.challenge,answer:p.kind==='host'?{kind:'host',accept:true}:{kind:'password',password:'fixture-only'}});}});
 const {port,single}=await invoke<{port:number;single?:string}>('fixture_config');
 for(const name of single?[single]:[...Object.keys(cases),'queue_overload','query_overload']){await fixture({action:'progress',name});try{if(name.endsWith('_overload'))await overload(name,port);else await scenario(name,port);outcomes.push({name,passed:true});}catch(e){outcomes.push({name,passed:false,error:JSON.stringify(e instanceof Error?e.message:e)});}}
 await invoke('finish',{outcomes});
}
void run().catch(error=>{void invoke('finish',{outcomes:[{name:'startup',passed:false,error:String(error)}]});});
