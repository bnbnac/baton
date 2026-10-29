import type {Terminal} from '@xterm/xterm';
import type {Binding,Frame,Query,TerminalBridge} from './types.js';
const expected=new Set(['QueryExpired','UnknownQuery','StaleControlEpoch','ControlUnavailable','SessionClosed']);
export class QueryRenderer {
  private active:Query|undefined;
  private replies:Promise<void>[]=[];
  constructor(private readonly term:Terminal,private readonly binding:Binding,private readonly bridge:TerminalBridge){
    term.parser.registerCsiHandler({final:'n'},params=>{if(params.length===1){if(params[0]===5)this.reply('dsr');if(params[0]===6)this.reply('cpr');}return true;});
    term.parser.registerCsiHandler({final:'c'},params=>{if(params.length===1&&params[0]===0)this.reply('da');return true;});
    // Responses to unsupported queries must not enter onData as user input.
    for(const identifier of [{prefix:'>',final:'c'},{prefix:'?',final:'n'},{intermediates:'$',final:'p'},{prefix:'?',intermediates:'$',final:'p'},{final:'t'}])term.parser.registerCsiHandler(identifier,()=>true);
    term.parser.registerDcsHandler({intermediates:'$',final:'q'},()=>true);
    for(const id of [4,8,10,11,12,52])term.parser.registerOscHandler(id,()=>true);
  }
  private reply(kind:Query['kind']){
    const query=this.active;if(query?.kind!==kind)return;
    const buffer=this.term.buffer.active;
    this.replies.push(this.bridge.reply(this.binding,query,kind==='cpr'?buffer.cursorY+1:undefined,kind==='cpr'?buffer.cursorX+1:undefined).catch(error=>{
      if(!error||typeof error!=='object'||!('code' in error)||!expected.has(String(error.code)))throw error;
    }));
    // Attach a rejection handler now, before the parser callback resolves.
    void this.replies.at(-1)!.catch(()=>{});
  }
  private parse(bytes:number[]){return new Promise<void>(resolve=>this.term.write(new Uint8Array(bytes),resolve));}
  async write(frame:Frame){
    this.replies=[];let start=0;
    try{
      for(const query of frame.queries){
        if(query.endOffset>start)await this.parse(frame.bytes.slice(start,query.endOffset));
        this.active=query;
        await this.parse([frame.bytes[query.endOffset]]);
        this.active=undefined;start=query.endOffset+1;
      }
      if(start<frame.bytes.length)await this.parse(frame.bytes.slice(start));
      await Promise.all(this.replies);
    }finally{this.active=undefined;}
  }
}
