import {invoke} from '@tauri-apps/api/core';
import {command,type Session} from './bridge.js';
import {TerminalView} from './terminal/terminal.js';
import {bindTerminal,terminalBridge} from './terminal/bridge.js';
import type {Frame} from './terminal/types.js';

// Acceptance-only controls. A capture records bytes; it never declares a pass.
export async function manualTerminal(port:number,host:HTMLElement,sessions:Map<string,Session>,setActive:(view:TerminalView)=>void,smoke:boolean){
 const request=(value:unknown)=>invoke<any>('fixture',{request:value});
 const wait=async(check:()=>boolean|Promise<boolean>,label:string)=>{const end=Date.now()+10000;while(!await check()){if(Date.now()>end)throw Error(label);await new Promise(r=>setTimeout(r,10));}};
 const user='fixture-manual';let view:TerminalView|undefined,raw='',mode='user_owned',stream=1;
 const pending:Frame[]=[];
 const bar=document.createElement('section');bar.style.cssText='font:14px sans-serif;padding:8px;display:flex;gap:8px;flex-wrap:wrap';host.before(bar);
 const status=document.createElement('pre');status.style.cssText='margin:4px;white-space:pre-wrap';bar.after(status);
 const select=document.createElement('select');
 for(const id of ['physical-key','physical-paste','ime-commit','ime-reclaim-mid-composition','mouse','hidden-restore','minimize-restore','dpi-100','dpi-150','dpi-200','interactive-vi','interactive-top','webview-descendant-exit']){const option=document.createElement('option');option.value=id;option.textContent=id;select.append(option);}bar.append(select);
 const errors:unknown[]=[];
 const fail=(error:unknown)=>{errors.push(error);status.textContent=String(error instanceof Error?error.message:JSON.stringify(error));};
 function button(label:string,action:()=>Promise<unknown>|void){const b=document.createElement('button');b.textContent=label;b.onclick=()=>{void Promise.resolve().then(action).catch(fail);};bar.append(b);}
 const session=await command<Session>('connect_session',{host:'127.0.0.1',port,username:user,label:'Manual · isolated OpenSSH',method:'password'});
 await wait(()=>sessions.get(session.id)?.state==='user_owned','manual_connect_timeout');
 const receive=(frame:Frame)=>{raw+=new TextDecoder().decode(new Uint8Array(frame.bytes));void view!.write(frame).catch(fail);};
 const binding=await bindTerminal(session.id,frame=>view?receive(frame):pending.push(frame));
 host.style.width='calc(100vw - 32px)';host.style.height='calc(100vh - 210px)';
 view=new TerminalView(binding,host,terminalBridge(fail));setActive(view);view.applySnapshot(sessions.get(session.id)!);for(const frame of pending)receive(frame);
 const ownership=async(userOwned:boolean)=>{const snapshot=await invoke<Session>('set_owner',{binding,user:userOwned,stream:stream++});view!.applySnapshot(snapshot);mode=snapshot.state;status.textContent=`${mode} · epoch ${snapshot.epoch}`;view!.term.focus();};
 const begin=async()=>{await view!.input.flush();const result=await request({action:'mark',user,caseId:select.value,mode});if(result.error)throw Error(result.error);status.textContent=`기록 시작: ${select.value} / ${mode}`;view!.term.focus();};
 const capture=async()=>{await view!.input.flush();const result=await request({action:'capture',user});if(result.error)throw Error(result.error);status.textContent=JSON.stringify(result);return result;};
 button('UserOwned',()=>ownership(true));button('AgentOwned',()=>ownership(false));button('구간 시작',begin);button('수신 기록',capture);
 button('조합 중 전환 예약',()=>{host.addEventListener('compositionstart',()=>{setTimeout(()=>{void ownership(false).then(()=>ownership(true)).catch(fail);},500);},{once:true,capture:true});status.textContent='다음 IME 조합 시작 0.5초 뒤 AgentOwned → UserOwned. 조합을 유지한 뒤 확정하세요.';view!.term.focus();});
 button('숨기기 / 복귀',()=>view!.setVisible(Boolean(host.hidden)));
 button('관측 종료',async()=>{await invoke('finish',{outcomes:[]});});
 status.textContent='격리된 시험 서버입니다. 구간 시작 → 실제 키·붙여넣기·IME·마우스 조작 → 수신 기록. 판정과 화면은 별도로 기록하세요.';
 view.term.focus();
 if(smoke){
   await wait(()=>raw.includes('$')||raw.includes('#'),'manual_shell_prompt_missing');
   await begin();const text="printf '\\155\\141\\156\\165\\141\\154\\055\\163\\155\\157\\153\\145\\n'\r";
   await view.input.send(text);await wait(()=>raw.includes('manual-smoke\r\n'),'manual_shell_output_missing');
   const observed=await capture();const expected=Array.from(new TextEncoder().encode(text)).map(n=>n.toString(16).padStart(2,'0')).join('');
   if(observed.receivedHex!==expected)throw Error('manual_server_audit_mismatch');
   await ownership(false);await begin();try{await view.input.send('BLOCKED');throw Error('manual_input_not_blocked');}catch(e){if(e instanceof Error&&e.message==='manual_input_not_blocked')throw e;}
   const blocked=await capture();if(blocked.receivedHex!=='')throw Error('manual_agent_bytes_leaked');
   // Input denial is expected; other bridge/render errors remain failures.
   if(errors.length)throw Error('manual_render_error');
   await invoke('finish',{outcomes:[{name:'manual-smoke',passed:true}]});
 }
}
