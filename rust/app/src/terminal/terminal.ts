import {Terminal} from '@xterm/xterm';
import {InputController} from './input.js';
import {OutputQueue} from './output.js';
import {QueryRenderer} from './queries.js';
import type {Binding,Frame,Snapshot,TerminalBridge} from './types.js';
export class TerminalView {
  readonly term=new Terminal({cols:120,rows:32,scrollback:1000,allowProposedApi:false});
  readonly input:InputController;
  private readonly output:OutputQueue;
  private readonly removeListeners:()=>void;
  constructor(readonly binding:Binding,readonly host:HTMLElement,private readonly bridge:TerminalBridge){
    this.input=new InputController(binding,call=>bridge.input(call));
    this.term.open(host);
    const renderer=new QueryRenderer(this.term,binding,bridge);
    this.output=new OutputQueue(binding,async frame=>{await renderer.write(frame);await bridge.ack(binding,frame.seq);});
    const start=()=>this.input.compositionStart(),end=()=>this.input.compositionEnd();
    const key=(event:KeyboardEvent)=>{if(!event.isComposing&&event.keyCode!==229)this.input.ordinaryKey();};
    host.addEventListener('compositionstart',start,true);host.addEventListener('compositionend',end,true);host.addEventListener('keydown',key,true);
    this.removeListeners=()=>{host.removeEventListener('compositionstart',start,true);host.removeEventListener('compositionend',end,true);host.removeEventListener('keydown',key,true);};
    this.term.onData(data=>{void this.input.send(data).catch(error=>bridge.error(error));});
    this.term.onBinary(data=>{void this.input.binary(data).catch(error=>bridge.error(error));});
  }
  applySnapshot(snapshot:Snapshot){this.input.applySnapshot(snapshot);this.term.options.disableStdin=snapshot.state!=='user_owned';}
  write(frame:Frame){return this.output.write(frame);}
  setVisible(visible:boolean){this.host.hidden=!visible;}
  dispose(){this.removeListeners();this.input.dispose();this.output.dispose();this.term.dispose();}
}
