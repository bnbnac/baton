import {command,type Session,type Connection} from './bridge.js';
import {TerminalView} from './terminal/terminal.js';
import {bindTerminal,terminalBridge} from './terminal/bridge.js';
import type {Frame} from './terminal/types.js';
import {Ownership} from './sessions/ownership.js';
import {OwnershipView} from './connections/view.js';
type Fixture=(request:unknown)=>Promise<any>;
type Entry={session:Session;user:string;server:number;view:TerminalView;pane:HTMLElement};
const encode=(s:string)=>Array.from(new TextEncoder().encode(s));
const hex=(s:string)=>encode(s).map(b=>b.toString(16).padStart(2,'0')).join('');
function check(value:unknown,label:string):asserts value {if(!value)throw Error(label);}
async function until(check:()=>unknown|Promise<unknown>,label:string){const end=Date.now()+8000;while(!await check()){if(Date.now()>end)throw Error(label);await new Promise(r=>setTimeout(r,10));}}
export async function phase3(name:string,ports:number[],host:HTMLElement,sessions:Map<string,Session>,fixture:Fixture,setRefresh:(refresh:(()=>void)|undefined)=>void){
 const entries:Entry[]=[],errors:unknown[]=[];let serial=0;
 const id=()=> (++serial).toString(16).padStart(32,'0');
 const screen=(e:Entry)=>{const b=e.view.term.buffer.active;return Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)??'').join('\n');};
 const call=async(owner:string,tool:string,args:unknown={})=>{const response=await fixture({action:'mcp-call',owner,name:tool,arguments:args});check(!response.error,'fixture_error');return {body:JSON.parse(response.content[0].text),error:!!response.isError};};
 const ok=async(owner:string,tool:string,args:unknown={})=>{const result=await call(owner,tool,args);check(!result.error,`unexpected_${tool}_${result.body.code}`);return result.body;};
 const status=async(owner:string,e:Entry)=>{const s=await ok(owner,'status');const session=s.sessions.find((s:any)=>s.session_id===e.session.id);check(session,'missing_assigned_session');return session;};
 const audit=(e:Entry)=>fixture({action:'audit',user:e.user,server:e.server});
 const inject=async(e:Entry,text:string)=>{await fixture({action:'inject',user:e.user,server:e.server,bytes:encode(text)});await until(()=>screen(e).includes(text.trim()),'screen_output_missing');};
 const panel=document.createElement('section');host.prepend(panel);const model=new Ownership();let selected:Entry|undefined;
 const render=()=>{for(const e of entries)e.view.applySnapshot(sessions.get(e.session.id)!);widget.render(selected?sessions.get(selected.session.id):undefined);};
 const widget=new OwnershipView(panel,model,command,render,e=>errors.push(e));setRefresh(render);
 const create=async(server:number,label:string)=>{
   const user=`fixture-phase3-${entries.length}`,session=await command<Session>('connect_session',{host:'127.0.0.1',port:ports[server-1],username:user,label,method:'password'});
   await until(()=>sessions.get(session.id)?.state==='user_owned','connect_timeout');const pane=document.createElement('div');pane.style.cssText='width:950px;height:420px';host.append(pane);
   let view:TerminalView|undefined;const pending:Frame[]=[];const receive=(frame:Frame)=>{void view!.write(frame).catch(e=>errors.push(e));};
   const binding=await bindTerminal(session.id,frame=>view?receive(frame):pending.push(frame));view=new TerminalView(binding,pane,terminalBridge(e=>errors.push(e)));view.applySnapshot(sessions.get(session.id)!);for(const frame of pending)receive(frame);
   const entry={session,user,server,view,pane};entries.push(entry);if(!selected)selected=entry;else{pane.hidden=true;view.setVisible(false);}render();return entry;
 };
 let owners:any;
 const handoff=async(e:Entry,owner:string)=>{await command('handoff_session',{id:e.session.id,expected_epoch:sessions.get(e.session.id)!.epoch,connection_id:owners[owner].connection_id});await until(()=>sessions.get(e.session.id)?.state==='agent_owned','handoff_timeout');return status(owner,e);};
 const reclaim=async(e:Entry)=>{await command('reclaim_session',{id:e.session.id,expected_epoch:sessions.get(e.session.id)!.epoch});await until(()=>sessions.get(e.session.id)?.state==='user_owned','reclaim_timeout');};
 const send=async(owner:string,e:Entry,text:string,request_id=id())=>{const s=await status(owner,e);return ok(owner,'send_text',{session_id:s.session_id,control_epoch:s.control_epoch,request_id,text});};
 const read=async(owner:string,e:Entry,cursor=0,wait_ms=0)=>{const s=await status(owner,e);return ok(owner,'read_output',{session_id:s.session_id,control_epoch:s.control_epoch,stream_id:s.stream_id,cursor,limit:32768,wait_ms});};
 try {
   owners=await fixture({action:'mcp-start'});check(owners.a.connection_id!==owners.b.connection_id,'connections_not_distinct');
   model.updateConnections(await command<Connection[]>('list_agent_connections',{}));check(model.connections.length===2,'unexpected_connection_count');
   if(name==='phase3-integration') {
     for(let i=0;i<4;i++){const e=await create(i===2?2:1,`shell-${i}`);await handoff(e,i===3?'b':'a');}
     for(let i=0;i<4;i++){const rid=id();await send(i===3?'b':'a',entries[i],`MARKER_${i}`,rid);await send(i===3?'b':'a',entries[i],`MARKER_${i}`,rid);await until(async()=> (await audit(entries[i])).hex===hex(`MARKER_${i}`),'not_exactly_once');}
     const b=await status('b',entries[3]),before=await audit(entries[3]);
     for(const [tool,args] of [['send_text',{request_id:id(),text:'NEVER'}],['read_output',{stream_id:b.stream_id,cursor:0,limit:100,wait_ms:0}]] as const){const result=await call('a',tool,{session_id:b.session_id,control_epoch:b.control_epoch,...args});check(result.error&&result.body.code==='not_owner','foreign_session_not_rejected');}
     check((await audit(entries[3])).hex===before.hex,'foreign_input_was_written');
     await reclaim(entries[1]);await fixture({action:'mcp-eof',owner:'a'});
     await until(async()=> (await audit(entries[0])).closed&&(await audit(entries[2])).closed,'disconnected_owner_shell_not_closed');
     check(!(await audit(entries[1])).closed,'reclaimed_user_shell_closed');check(!(await audit(entries[3])).closed,'other_owner_shell_closed');
     await send('b',entries[3],'_ALIVE');await until(async()=> (await audit(entries[3])).hex===hex('MARKER_3_ALIVE'),'other_owner_not_live');
     entries[1].view.term.input('USER_ALIVE');await entries[1].view.input.flush();await until(async()=> (await audit(entries[1])).hex===hex('MARKER_1USER_ALIVE'),'reclaimed_user_not_live');
   } else if(name==='phase3-ownership') {
     const e=await create(1,'public-boundary'),original=e.view.term.element;
     await inject(e,'PRIVATE_BEFORE\r\n');const a=await handoff(e,'a');await inject(e,'PUBLIC_ONE\r\n');const publicPage=await read('a',e);check(publicPage.text.includes('PUBLIC_ONE')&&!publicPage.text.includes('PRIVATE_BEFORE'),'initial_public_boundary');
     const pending=call('a','read_output',{session_id:a.session_id,control_epoch:a.control_epoch,stream_id:a.stream_id,cursor:publicPage.end_cursor,limit:32768,wait_ms:10000});await ok('a','status');await reclaim(e);check((await pending).error,'pending_read_not_revoked');
     await inject(e,'PRIVATE_AFTER\r\n');const b=await handoff(e,'b');check(b.stream_id!==a.stream_id,'stream_reused');const empty=await read('b',e);check(empty.text===''&&empty.next_cursor===0,'private_history_exposed');
     const staleStream=await call('b','read_output',{session_id:b.session_id,control_epoch:b.control_epoch,stream_id:a.stream_id,cursor:0,limit:100,wait_ms:0});check(staleStream.error&&staleStream.body.code==='stale_stream','old_stream_accepted');
     const staleEpoch=await call('b','send_text',{session_id:b.session_id,control_epoch:a.control_epoch,request_id:id(),text:'NEVER'});check(staleEpoch.error&&staleEpoch.body.code==='stale_control_epoch','old_epoch_accepted');
     const transcript=(await fixture({action:'transcript'})).json;check(!transcript.includes('PRIVATE_BEFORE')&&!transcript.includes('PRIVATE_AFTER'),'private_bytes_in_mcp');
     await fixture({action:'inject',user:e.user,server:e.server,bytes:encode('PRIVATE_BEFORE\r\n')});await until(async()=> (await read('b',e)).text.includes('PRIVATE_BEFORE'),'new_remote_redraw_not_public');
     check(e.view.term.element===original&&screen(e).includes('PRIVATE_BEFORE')&&screen(e).includes('PRIVATE_AFTER'),'scrollback_or_terminal_replaced');check((await audit(e)).hex==='','rejected_input_wrote_bytes');
   } else if(name==='phase3-sudo') {
     const e=await create(1,'authentication-needed');await handoff(e,'a');await send('a',e,'sudo -n du -sh /root\r');await until(async()=> (await read('a',e)).text.includes('a password is required'),'auth_required_missing');
     const s=await status('a',e);await ok('a','request_user_control',{session_id:s.session_id,control_epoch:s.control_epoch,request_id:id(),reason:'직접 인증이 필요합니다.'});
     await until(()=>sessions.get(e.session.id)?.intervention?.state==='requested','intervention_not_visible');check(panel.textContent?.includes('직접 인증이 필요합니다.'),'intervention_badge_missing');
     check(sessions.get(e.session.id)!.state==='agent_owned','notification_transferred_ownership');check((await audit(e)).sudo===1,'notification_reexecuted_command');
     await reclaim(e);e.view.term.input('fixture-auth\r');await e.view.input.flush();await until(()=>screen(e).includes('Fixture password:'),'private_auth_prompt_missing');
     e.view.term.input('SYNTHETIC_PASSWORD_PHASE3\r');await e.view.input.flush();await until(()=>screen(e).includes('AUTH_READY'),'private_auth_failed');
     await handoff(e,'a');check((await read('a',e)).text==='','private_auth_output_exposed');check((await audit(e)).sudo===1,'handoff_reexecuted_sudo');
     await send('a',e,'sudo -n du -sh /root\r');await until(async()=> (await read('a',e)).text.includes('44K'),'approved_retry_not_successful');
     const denied=await create(2,'permission-denied');await fixture({action:'sudo-mode',server:2,user:denied.user,mode:'denied'});await handoff(denied,'b');await send('b',denied,'sudo -n du -sh /root\r');await until(async()=> (await read('b',denied)).text.includes('command not allowed'),'permission_denial_missing');
     const a=await audit(e),b=await audit(denied);check(a.sudo===2&&a.auth===1&&a.forbidden===0&&b.sudo===1&&b.auth===0&&b.forbidden===0,'unexpected_auth_or_sudo_execution');
     const transcript=(await fixture({action:'transcript'})).json;for(const privateText of ['SYNTHETIC_PASSWORD_PHASE3','Fixture password:','AUTH_READY','fixture-auth'])check(!transcript.includes(privateText),'private_auth_data_in_mcp');
   } else throw Error('unknown_phase3_case');
   check(errors.length===0,'terminal_error');
 } finally {
   setRefresh(undefined);for(const e of entries){e.view.dispose();e.pane.remove();await command('close_session',{id:e.session.id});}panel.remove();
 }
}
