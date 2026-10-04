import '@xterm/xterm/css/xterm.css';
import {invoke} from '@tauri-apps/api/core';
import {subscribe,command,type Session} from './bridge.js';
import {TerminalView} from './terminal/terminal.js';
import {bindTerminal,terminalBridge} from './terminal/bridge.js';
import type {Frame,Binding} from './terminal/types.js';
import {manualTerminal} from './manual.js';
import {SessionViews} from './sessions/view.js';
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
let openSshMode=false,openSshFingerprint:string|undefined;
let holdStage:string|undefined;
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
   const dims=name==='wrap_max'?[500,200]:[120,32];
   const screen=view.term.element!.querySelector('.xterm-screen')!.getBoundingClientRect();
   host.style.width=`${Math.ceil(screen.width/view.term.cols*dims[0]+15)}px`;host.style.height=`${Math.ceil(screen.height/view.term.rows*dims[1])}px`;
   await until(()=>view!.term.cols===dims[0]&&view!.term.rows===dims[1],'test_viewport_not_fitted');
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
async function remoteExit(port:number,late:boolean){
 const username=`fixture-${++number}`,errors:unknown[]=[];
 const info=await command<Session>('connect_session',{host:'127.0.0.1',port,username,label:'remote-exit',method:'password'});
 await until(()=>sessions.get(info.id)?.state==='user_owned','connect_timeout');
 let view:TerminalView|undefined,views:SessionViews|undefined,chain=Promise.resolve(),rendered=0;
 const pending:Frame[]=[];
 const consume=(frame:Frame)=>{chain=chain.then(async()=>{
   await until(()=>sessions.get(info.id)?.state==='closed','remote_not_closed');
   await view!.write(frame);rendered+=frame.bytes.length;
 }).catch(e=>{errors.push(e);});};
 if(!late){
   const binding=await bindTerminal(info.id,frame=>view?consume(frame):pending.push(frame));
   view=new TerminalView(binding,host,terminalBridge(e=>errors.push(e)));active=view;
   view.applySnapshot(sessions.get(info.id)!);for(const frame of pending)consume(frame);
 }
 // More than one in-flight window, followed by a query that must not revive input.
 const payload='X'.repeat(65536)+'\r\nFINAL_RESULT\r\n\x1b[6n';
 await fixture({action:'remote-exit',user:username,bytes:bytes(payload)});
 await until(()=>sessions.get(info.id)?.state==='closed','remote_not_closed');
 equal(sessions.get(info.id)?.has_terminal,true);
 if(late){
   views=new SessionViews(host,e=>errors.push(e));views.update([sessions.get(info.id)!],info.id);
   await until(()=>!!host.querySelector('.xterm-screen')||errors.length>0,'late_terminal_missing');
   await until(()=>host.textContent?.includes('FINAL_RESULT')===true||errors.length>0,'late_final_result_not_rendered');
 }else{
   await until(()=>rendered===bytes(payload).length||errors.length>0,'final_output_missing');
   const b=view!.term.buffer.active;
   const screen=Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)??'').join('\n');
   if(!screen.includes('FINAL_RESULT'))throw Error('final_result_not_rendered');
   await rejected(terminalBridge(()=>{}).input({binding:view!.binding,epoch:0,inputSeq:1,data:[3]}));
 }
 if(errors.length)throw errors[0];equal((await fixture({action:'audit',user:username})).hex,'');
 // Rendering is asserted above; removal also waits for the SSH driver's bounded cleanup.
 await until(async()=>{try{await command('remove_closed_session',{id:info.id});return true;}catch{return false;}},'remote_close_cleanup_timeout');
 if(errors.length)throw errors[0];active=undefined;view?.dispose();views?.update([],null);host.replaceChildren();
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
async function geometry(port:number,second:number){
 const entries:{session:Session;view:TerminalView;username:string;server:number;host:HTMLElement}[]=[];
 const errors:unknown[]=[];
 try{
   for(let i=0;i<3;i++){
     const username=`fixture-${++number}`,server=i===2?2:1;
     const session=await command<Session>('connect_session',{host:'127.0.0.1',port:server===2?second:port,username,label:`geometry-${i}`,method:'password'});
     await until(()=>sessions.get(session.id)?.state==='user_owned','connect_timeout');
     const pane=document.createElement('div');pane.style.cssText='width:900px;height:480px';pane.hidden=i!==0;host.append(pane);
     let view:TerminalView;const binding=await bindTerminal(session.id,frame=>{void view.write(frame).catch(e=>errors.push(e));});
     view=new TerminalView(binding,pane,terminalBridge(e=>errors.push(e)));view.applySnapshot(sessions.get(session.id)!);view.setVisible(i===0);
     entries.push({session,view,username,server,host:pane});
   }
   const a=entries[0];
   const audit=(e:typeof a)=>fixture({action:'audit',user:e.username,server:e.server});
   const size=async(cols:number,rows:number)=>{
     const screen=a.view.term.element!.querySelector('.xterm-screen')!.getBoundingClientRect();
     a.host.style.width=`${Math.ceil(screen.width/a.view.term.cols*cols+15)}px`;
     a.host.style.height=`${Math.ceil(screen.height/a.view.term.rows*rows)}px`;
     await until(async()=>{const r=await audit(a);return r.sizes.at(-1)[0]===cols&&r.sizes.at(-1)[1]===rows;},'remote_geometry_not_fitted');
     equal([a.view.term.cols,a.view.term.rows],[cols,rows]);
   };
   await size(91,27);await size(120,32);await size(91,27);
   const prior=(await audit(a)).sizes.length;
   await size(91,27);await delay(150);equal((await audit(a)).sizes.length,prior);
   a.view.setVisible(false);a.host.style.width='700px';a.host.style.height='400px';await delay(150);equal((await audit(a)).sizes.length,prior);
   a.view.setVisible(true);await until(async()=> (await audit(a)).sizes.length>prior,'restore_not_fitted');
   const restored=(await audit(a)).sizes.length;
   a.host.style.width='0px';a.host.style.height='0px';await delay(150);equal((await audit(a)).sizes.length,restored);
   for(const e of entries.slice(1))equal((await audit(e)).sizes.map((x:number[])=>x.slice(0,2)),[[120,32]]);
   await rejected(terminalBridge(()=>{}).resize({...a.view.binding,view:entries[1].view.binding.view},100,80,24));
   a.host.style.width='1px';a.host.style.height='1px';await until(async()=>{const sizes=(await audit(a)).sizes;return sizes.at(-1)[0]===20&&sizes.at(-1)[1]===5;},'minimum_not_clamped');
   a.host.style.width='10000px';a.host.style.height='10000px';await until(async()=>{const sizes=(await audit(a)).sizes;return sizes.at(-1)[0]===500&&sizes.at(-1)[1]===200;},'maximum_not_clamped');
   const finalCount=(await audit(a)).sizes.length;
   a.view.applySnapshot({state:'closed',epoch:1});a.host.style.width='1000px';a.host.style.height='600px';await delay(150);equal((await audit(a)).sizes.length,finalCount);
   a.view.dispose();a.host.style.width='1100px';await delay(150);equal((await audit(a)).sizes.length,finalCount);
   equal(sessions.get(a.session.id)?.epoch,0);equal(errors,[]);
 }finally{for(const e of entries){e.view.dispose();e.host.remove();await command('close_session',{id:e.session.id});await until(async()=>{try{await command('remove_closed_session',{id:e.session.id});return true;}catch{return false;}},'close_timeout');}}
}
async function interactiveOpenSsh(port:number,second:number){
 const entries:{session:Session;view:TerminalView;host:HTMLElement;raw:string;failure?:unknown}[]=[];
 const screen=(view:TerminalView)=>{const b=view.term.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)??'').join('\n');};
 const send=async(e:typeof entries[number],text:string)=>{e.view.term.input(text);await e.view.input.flush();if(e.failure)throw e.failure;};
 const marker=async(e:typeof entries[number],text:string)=>{const start=e.raw.length;await send(e,`printf '${text}\\n'\r`);await until(()=>e.raw.slice(start).includes(text+'\r\n'),'shell_marker_missing');};
 try{
   for(let i=0;i<3;i++){
     const session=await command<Session>('connect_session',{host:'127.0.0.1',port:i===2?second:port,username:'batonfixture',label:`openssh-${i}`,method:'password'});
     await until(()=>sessions.get(session.id)?.state==='user_owned','openssh_connect_timeout');
     const pane=document.createElement('div');pane.style.cssText='width:1000px;height:580px';pane.hidden=i!==0;host.append(pane);
     let entry:typeof entries[number]|undefined;const pending:Frame[]=[];
     const consume=(frame:Frame)=>{entry!.raw+=new TextDecoder().decode(new Uint8Array(frame.bytes));void entry!.view.write(frame).catch(e=>entry!.failure=e);};
     const binding=await bindTerminal(session.id,frame=>entry?consume(frame):pending.push(frame));
     const view=new TerminalView(binding,pane,terminalBridge(e=>{if(entry)entry.failure=e;}));view.applySnapshot(sessions.get(session.id)!);view.setVisible(i===0);
     entry={session,view,host:pane,raw:''};entries.push(entry);for(const frame of pending)consume(frame);
     await send(entry,"stty -echo; PS1='BATON_SHELL> '; printf '__READY__\\n'\r");
     await until(()=>entry!.raw.includes('__READY__\r\n'),'shell_not_ready');
   }
   const a=entries[0];active=a.view;
   for(let i=0;i<entries.length;i++)await marker(entries[i],`SHELL_${i}`);
   for(let i=0;i<entries.length;i++)for(let j=0;j<entries.length;j++)if(i!==j&&entries[i].raw.includes(`SHELL_${j}`))throw Error('shell_crossed');
   const beforeVi=a.raw.length;await send(a,'vi\r');await until(()=>a.view.term.buffer.active.type==='alternate'&&a.raw.slice(beforeVi).includes('No file'),'vi_not_open');
   await send(a,'iBATON_EDITOR_TEST\x1b');await until(()=>screen(a.view).includes('BATON_EDITOR_TEST'),'vi_input_missing');
   await owner(a.view.binding,false,7);
   a.host.style.width='850px';a.host.style.height='500px';
   await until(async()=>String(await invoke('public_read',{binding:a.view.binding})).includes('BATON_EDITOR_TEST'),'vi_resize_redraw_not_observed');
   await owner(a.view.binding,true);
   let start=a.raw.length;await send(a,':q!\r');await until(()=>a.raw.slice(start).includes('BATON_SHELL>'),'vi_did_not_exit');
   start=a.raw.length;await send(a,'top\r');await until(()=>/Mem:|CPU:|load average/.test(a.raw.slice(start)),'interactive_top_not_open');
   a.host.style.width='940px';a.host.style.height='540px';await delay(250);
   start=a.raw.length;await send(a,'q');await until(()=>a.raw.slice(start).includes('BATON_SHELL>'),'top_did_not_exit');
   start=a.raw.length;await send(a,"printf '__SLEEP__\\n'; sleep 30\r");await until(()=>a.raw.slice(start).includes('__SLEEP__\r\n'),'sleep_not_started');await send(a,'\x03');await marker(a,'AFTER_INTERRUPT');
   for(const e of entries.slice(1)){start=e.raw.length;await send(e,'stty size\r');await until(()=>e.raw.slice(start).includes('32 120\r\n'),'other_pty_resized');}
   start=a.raw.length;await send(a,'stty size\r');await until(()=>a.raw.slice(start).includes(`${a.view.term.rows} ${a.view.term.cols}\r\n`),'local_remote_size_mismatch');
   for(const e of entries)if(e.failure)throw e.failure;
 }finally{active=undefined;for(const e of entries){e.view.dispose();e.host.remove();await command('close_session',{id:e.session.id});await until(async()=>{try{await command('remove_closed_session',{id:e.session.id});return true;}catch{return false;}},'close_timeout');}}
}
async function run(){const outcomes:{name:string;passed:boolean;error?:string}[]=[];
 await subscribe(event=>{if(event.type==='sessions'){for(const s of event.sessions){sessions.set(s.id,s);if(active?.binding.session===s.id)active.applySnapshot(s);}}else if(event.type==='auth'){const p=event.prompt;if(holdStage==='auth-wait'&&p.kind==='password'){void fixture({action:'barrier',stage:holdStage});return;}void command('answer_auth',{session:p.session,attempt:p.attempt,challenge:p.challenge,answer:p.kind==='host'?{kind:'host',accept:!openSshMode||!!openSshFingerprint&&p.display.endsWith(openSshFingerprint)}:{kind:'password',password:openSshMode?'baton-fixture-only':'fixture-only'}});}});
 const {port,second,single,suite,openssh,otherOpenSsh,fingerprint,hold}=await invoke<{port:number;second:number;single?:string;suite:string;openssh?:string;otherOpenSsh?:string;fingerprint?:string;hold?:string}>('fixture_config');
 holdStage=hold;
 if(suite==='manual'||suite==='manual-smoke'){await manualTerminal(port,host,sessions,view=>{active=view;},suite==='manual-smoke');return;}
 if(hold==='sentinel'){await fixture({action:'barrier',stage:hold});return;}
 if(hold==='auth-wait'||hold==='output-wait'){
   const username=`fixture-${++number}`;
   const s=await command<Session>('connect_session',{host:'127.0.0.1',port,username,label:hold,method:'password'});
   if(hold==='auth-wait')return;
   await until(()=>sessions.get(s.id)?.state==='user_owned','connect_timeout');
   await bindTerminal(s.id,()=>{void fixture({action:'barrier',stage:hold});});
   await fixture({action:'inject',user:username,bytes:bytes('X'.repeat(65537))});return;
 }
 openSshMode=suite==='openssh';openSshFingerprint=fingerprint;
 const names=single?[single]:suite==='openssh'?['interactive-openssh']:suite==='geometry'?['geometry']:suite==='all'?[...Object.keys(cases),'queue_overload','query_overload','remote_exit','remote_exit_late_view','geometry']:[...Object.keys(cases),'queue_overload','query_overload','remote_exit','remote_exit_late_view'];
 for(const name of names){host.hidden=false;await fixture({action:'progress',name});try{if(name==='interactive-openssh')await interactiveOpenSsh(Number(openssh),Number(otherOpenSsh));else if(name==='geometry')await geometry(port,second);else if(name.startsWith('remote_exit'))await remoteExit(port,name==='remote_exit_late_view');else if(name.endsWith('_overload'))await overload(name,port);else await scenario(name,port);outcomes.push({name,passed:true});}catch(e){outcomes.push({name,passed:false,error:JSON.stringify(e instanceof Error?e.message:e)});}}
 if(hold==='before-cleanup'){await fixture({action:'barrier',stage:hold});return;}
 await invoke('finish',{outcomes});
}
void run().catch(error=>{void invoke('finish',{outcomes:[{name:'startup',passed:false,error:String(error)}]});});
