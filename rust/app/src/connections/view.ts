import type {Session} from '../bridge.js';
import {Ownership} from '../sessions/ownership.js';
type Send=(name:string,request:unknown)=>Promise<unknown>;
function element<K extends keyof HTMLElementTagNameMap>(tag:K,text=''){const el=document.createElement(tag);el.textContent=text;return el;}
export class OwnershipView {
  constructor(private root:HTMLElement,private model:Ownership,private send:Send,private refresh:()=>void,private error:(error:unknown)=>void){}
  render(session:Session|undefined){
    this.root.replaceChildren();if(!session)return;
    const ids=element('div');ids.className='ownership-ids';ids.append(element('span',`세션 ${session.id.slice(0,12)}`));
    const copy=(text:string,id:string)=>{const button=element('button',text);button.className='secondary';button.title=id;button.onclick=()=>{void navigator.clipboard.writeText(id).catch(this.error);};return button;};
    ids.append(copy('세션 ID 복사',session.id));
    if(session.assigned_connection){ids.append(element('span',`${session.state==='agent_owned'?'제어 연결':'연결 기록'} ${session.assigned_connection.slice(0,12)}`),copy('연결 ID 복사',session.assigned_connection));}
    this.root.append(ids);
    const actions=element('div');actions.className='ownership-actions';
    const select=element('select');select.setAttribute('aria-label','전달할 MCP 연결');select.disabled=session.state!=='user_owned'||this.model.busy(session.id);
    const placeholder=element('option',this.model.connections.length?'MCP 연결 선택':'연결된 MCP 없음');placeholder.value='';select.append(placeholder);
    for(const c of this.model.connections){const option=element('option',`MCP ${c.id.slice(0,12)}`);option.value=c.id;option.title=c.display_name;select.append(option);}
    select.value=this.model.selectedConnection??'';select.onchange=()=>{this.model.selectConnection(select.value);this.refresh();};actions.append(select);
    const action=(label:string,name:string,request:{id:string}|null)=>{const button=element('button',label);button.disabled=!request;button.onclick=()=>{if(!request)return;this.model.begin(request.id);this.refresh();void this.send(name,request).catch(this.error).finally(()=>{this.model.finish(request.id);this.refresh();});};return button;};
    actions.append(action('에이전트에 전달','handoff_session',this.model.handoff(session)),action('내가 제어하기','reclaim_session',this.model.reclaim(session)));this.root.append(actions);
    const guidance=element('p',session.state==='agent_owned'?'에이전트 공개 구간: 이번 전달 이후의 출력만 공유됩니다. 현재 화면의 이전 스크롤 기록은 공유되지 않습니다.':session.state==='transferring'||session.state==='reclaiming'?'제어권 전환 중입니다. 전환이 끝날 때까지 양측 입력이 차단됩니다.':'현재 화면: 사용자 제어 중에는 새 입력과 출력이 에이전트에 공개되지 않습니다. 전달 시 새 공개 구간이 시작됩니다.');guidance.className='muted';this.root.append(guidance);
    if(session.intervention){const notice=element('section');notice.className='intervention';notice.append(element('strong',session.intervention.state==='requested'?'사용자 개입 요청':'개입 요청 거절됨'),element('p',session.intervention.reason));
      if(session.intervention.state==='requested'){notice.append(element('small','요청 알림만으로 제어권이나 실행 승인이 바뀌지 않습니다.'),action('회수해서 처리','reclaim_session',this.model.reclaim(session)),action('요청 거절','decline_intervention',this.model.decline(session)));}
      this.root.append(notice);
    }
  }
}
