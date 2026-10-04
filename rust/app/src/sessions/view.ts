import type {Session} from '../bridge.js';
import {command} from '../bridge.js';
import {TerminalView} from '../terminal/terminal.js';
import {bindTerminal,terminalBridge} from '../terminal/bridge.js';
import type {Frame} from '../terminal/types.js';
type Entry={host:HTMLElement;view?:TerminalView;pending:Frame[];bytes:number;removed:boolean;latest:Session};
export class SessionViews {
  private readonly entries=new Map<string,Entry>();
  private selected:string|null=null;
  constructor(private readonly host:HTMLElement,private readonly error:(error:unknown)=>void){}
  update(sessions:Session[],selected:string|null){
    this.selected=selected;
    for(const [id,entry] of this.entries)if(!sessions.some(s=>s.id===id)){entry.removed=true;entry.view?.dispose();entry.host.remove();this.entries.delete(id);}
    for(const session of sessions){
      let entry=this.entries.get(session.id);
      if(!entry&&(session.has_terminal||['user_owned','agent_owned'].includes(session.state))){
        const host=document.createElement('div');host.className='terminal-view';host.hidden=session.id!==selected;this.host.append(host);
        entry={host,pending:[],bytes:0,removed:false,latest:session};this.entries.set(session.id,entry);void this.open(entry);
      }
      if(entry){entry.latest=session;entry.view?.applySnapshot(session);entry.host.hidden=session.id!==selected;entry.view?.setVisible(session.id===selected);}
    }
  }
  private async open(entry:Entry){
    try{
      const binding=await bindTerminal(entry.latest.id,frame=>{
        if(entry.removed)return;
        if(entry.view){void entry.view.write(frame).catch(this.error);return;}
        entry.bytes+=frame.bytes.length;
        if(entry.bytes>65536){entry.removed=true;this.error(Error('output_overload'));void command('close_session',{id:entry.latest.id}).catch(this.error);return;}
        entry.pending.push(frame);
      });
      if(entry.removed)return;
      entry.view=new TerminalView(binding,entry.host,terminalBridge(this.error));entry.view.applySnapshot(entry.latest);entry.view.setVisible(entry.latest.id===this.selected);
      for(const frame of entry.pending)void entry.view.write(frame).catch(this.error);
      entry.pending=[];entry.bytes=0;
    }catch(error){this.error(error);}
  }
}
