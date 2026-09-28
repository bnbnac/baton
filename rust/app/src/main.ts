import './style.css';
import '@xterm/xterm/css/xterm.css';
import {SessionViews} from './sessions/view.js';
import {command,subscribe,type Session,type Prompt} from './bridge.js';
import {AuthState} from './auth-state.js';
const root=document.querySelector<HTMLDivElement>('#app')!;
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const el=document.createElement(tag);el.textContent=text;el.className=className;return el;}
const header=element('header');header.append(element('strong','Baton'),element('span','내가 연결하고, 내가 제어하는 셸','muted'));
const layout=element('main'),sidebar=element('aside'),list=element('nav'),workspace=element('section','','workspace'),title=element('h1','SSH 세션'),subtitle=element('p','서버를 연결하면 이곳에서 터미널을 사용할 수 있습니다.','muted'),auth=element('section','','auth'),terminal=element('div','','terminal-workspace'),error=element('p','','error');
const form=element('form','','connection');form.append(element('h2','새 연결'));
function field(parent:HTMLElement,label:string,type='text',value=''){const wrapper=element('label',label);const input=element('input');input.type=type;input.value=value;input.autocomplete='off';wrapper.append(input);parent.append(wrapper);return input;}
const label=field(form,'이름'),host=field(form,'서버 주소'),port=field(form,'포트','number','22'),username=field(form,'사용자 이름');host.required=true;username.required=true;port.min='1';port.max='65535';
const method=element('select');for(const [value,text] of [['password','비밀번호'],['key','개인 키'],['interactive','추가 인증']]){const option=element('option',text);option.value=value;method.append(option);}form.append(method);const connect=element('button','연결');form.append(connect);
sidebar.append(element('h2','세션'),list,form);workspace.append(title,subtitle,auth,terminal,error);layout.append(sidebar,workspace);root.append(header,layout);
let sessions:Session[]=[],selected:string|null=null,shownAuth='';const prompts=new Map<string,Prompt>();const secrets=new AuthState();
function showError(e:unknown){error.textContent=typeof e==='object'&&e!==null&&'code' in e?String(e.code):'요청을 처리하지 못했습니다.';}
const views=new SessionViews(terminal,showError);
const states:Record<string,string>={connecting:'연결 중',user_owned:'사용자 제어',agent_owned:'에이전트 제어',transferring:'전달 중',reclaiming:'회수 중',closed:'종료됨'};
function render(){list.replaceChildren();for(const s of sessions){const button=element('button','','session'+(selected===s.id?' active':''));button.append(element('strong',s.label||s.host),element('small',states[s.state]??s.state));button.onclick=()=>{selected=s.id;render();};list.append(button);}const s=sessions.find(s=>s.id===selected);title.textContent=s?(s.label||s.host):'SSH 세션';subtitle.textContent=s?`${s.username}@${s.host}:${s.port} · ${states[s.state]??s.state}`:'서버를 연결하면 이곳에서 터미널을 사용할 수 있습니다.';views.update(sessions,selected);renderAuth(s);if(s?.error)error.textContent=s.error;}
function renderAuth(session:Session|undefined){const p=session&&session.state!=='closed'?prompts.get(session.id):undefined;const key=p?`${p.session}/${p.attempt}/${p.challenge}`:session?`${session.id}/${session.state}`:'';if(key===shownAuth)return;shownAuth=key;secrets.clear();auth.replaceChildren();if(!session)return;
  const close=element('button',session.state==='closed'?'목록에서 제거':'연결 종료','secondary');close.onclick=()=>{void command(session.state==='closed'?'remove_closed_session':'close_session',{id:session.id}).catch(showError);};auth.append(close);if(!p)return;
  secrets.show(p);const panel=element('form','','challenge');panel.append(element('h2',p.kind==='host'?'서버 신원 확인':'인증'),element('pre',p.display));const inputs:HTMLInputElement[]=[];let file:HTMLInputElement|undefined;
  if(p.kind==='key'){file=field(panel,'개인 키 파일','file');inputs.push(field(panel,'키 암호','password'));}else if(p.kind!=='host'){for(const f of p.prompts)inputs.push(field(panel,f.text,f.echo?'text':'password'));}
  const submit=element('button',p.kind==='host'?'이 연결에서 신뢰':'인증');panel.append(submit);
  panel.onsubmit=async event=>{event.preventDefault();submit.disabled=true;error.textContent='';try {
    let answer:unknown;
    if(p.kind==='host'){answer={kind:'host',accept:true};}else if(p.kind==='key'){const keyFile=file?.files?.[0];if(!keyFile||keyFile.size>1048576)throw {code:'1 MiB 이하의 키 파일을 선택하세요.'};answer={kind:'key',encoded:await keyFile.text(),passphrase:inputs[0].value};}else{secrets.fields=inputs.map(i=>i.value);const sent=secrets.take();answer=p.kind==='password'?{kind:'password',password:sent.fields[0]??''}:{kind:'interactive',responses:sent.fields};}
    inputs.forEach(i=>i.value='');if(file)file.value='';secrets.clear();prompts.delete(p.session);shownAuth='';auth.replaceChildren();await command('answer_auth',{session:p.session,attempt:p.attempt,challenge:p.challenge,answer});render();
  }catch(e){inputs.forEach(i=>i.value='');if(file)file.value='';secrets.clear();submit.disabled=false;showError(e);}};
  if(p.kind==='host'){const reject=element('button','거부','secondary');reject.type='button';reject.onclick=()=>{inputs.forEach(i=>i.value='');prompts.delete(p.session);void command('answer_auth',{session:p.session,attempt:p.attempt,challenge:p.challenge,answer:{kind:'host',accept:false}}).catch(showError);};panel.append(reject);}auth.append(panel);
}
form.onsubmit=async event=>{event.preventDefault();connect.disabled=true;error.textContent='';try {const s=await command<Session>('connect_session',{label:label.value,host:host.value,port:Number(port.value),username:username.value,method:method.value});selected=s.id;render();}catch(e){showError(e);}finally{connect.disabled=false;}};
void subscribe(event=>{if(event.type==='sessions'){sessions=event.sessions;for(const s of sessions)if(s.state==='closed')prompts.delete(s.id);if(!sessions.some(s=>s.id===selected))selected=sessions[0]?.id??null;render();}else if(event.type==='auth'){prompts.set(event.prompt.session,event.prompt);render();}}).then(initial=>{sessions=initial;render();}).catch(showError);
