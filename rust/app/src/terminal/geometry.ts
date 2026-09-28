import type {Terminal} from '@xterm/xterm';
import type {FitAddon} from '@xterm/addon-fit';
import type {Binding,TerminalBridge} from './types.js';
export class GeometryObserver {
  private readonly observer:ResizeObserver;
  private readonly host:HTMLElement;
  private visible:boolean;
  private stopped=false;
  private scheduled=0;
  private sequence=0;
  private sending=false;
  private pending:{cols:number;rows:number}|undefined;
  private last={cols:120,rows:32};
  constructor(private readonly binding:Binding,private readonly term:Terminal,private readonly fit:FitAddon,private readonly bridge:TerminalBridge){
    this.host=term.element!.parentElement!;this.visible=!this.host.hidden;
    this.observer=new ResizeObserver(()=>this.schedule());this.observer.observe(this.host);
    document.addEventListener('visibilitychange',this.visibility);
    window.addEventListener('resize',this.visibility);
    this.schedule();
  }
  private readonly visibility=()=>this.schedule();
  setVisible(visible:boolean){this.visible=visible;if(!visible)this.pending=undefined;this.schedule();}
  dispose(){if(this.stopped)return;this.stopped=true;this.pending=undefined;cancelAnimationFrame(this.scheduled);this.observer.disconnect();document.removeEventListener('visibilitychange',this.visibility);window.removeEventListener('resize',this.visibility);}
  private schedule(){if(this.stopped||this.scheduled)return;this.scheduled=requestAnimationFrame(()=>{this.scheduled=0;this.measure();});}
  private canMeasure(){return !this.stopped&&this.visible&&document.visibilityState==='visible'&&this.host.isConnected&&this.host.clientWidth>0&&this.host.clientHeight>0;}
  private measure(){
    if(!this.canMeasure())return;
    const proposed=this.fit.proposeDimensions();if(!proposed||!Number.isFinite(proposed.cols)||!Number.isFinite(proposed.rows))return;
    const dims={cols:Math.max(20,Math.min(500,Math.floor(proposed.cols))),rows:Math.max(5,Math.min(200,Math.floor(proposed.rows)))};
    if(dims.cols!==this.term.cols||dims.rows!==this.term.rows)this.term.resize(dims.cols,dims.rows);
    this.pending=dims;void this.drain();
  }
  private async drain(){
    if(this.sending)return;this.sending=true;
    try{while(this.pending&&this.canMeasure()){
      const dims=this.pending;this.pending=undefined;
      if(dims.cols===this.last.cols&&dims.rows===this.last.rows)continue;
      if(this.sequence===Number.MAX_SAFE_INTEGER)throw Error('resize_sequence_exhausted');
      await this.bridge.resize(this.binding,++this.sequence,dims.cols,dims.rows);this.last=dims;
    }}catch(error){this.dispose();this.bridge.error(error);}finally{this.sending=false;}
  }
}
