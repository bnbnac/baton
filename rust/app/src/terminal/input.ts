import type {Binding,InputCall,Snapshot} from './types.js';
type Action={text:string;binary:boolean;epoch:number;resolve:()=>void;reject:(error:unknown)=>void};
export class InputController {
  private snapshot:Snapshot={state:'closed',epoch:0};
  private composition:{epoch:number;allowed:boolean}|undefined;
  private composing=false;
  private stopped=false;
  private active=false;
  private sequence=0;
  private queue:Action[]=[];
  private idle:(()=>void)[]=[];
  constructor(readonly binding:Binding,private readonly invoke:(call:InputCall)=>Promise<void>){}
  applySnapshot(snapshot:Snapshot){this.snapshot={...snapshot};}
  compositionStart(){this.composing=true;this.composition={epoch:this.snapshot.epoch,allowed:this.snapshot.state==='user_owned'};}
  compositionEnd(){this.composing=false;}
  // Keep the origin until xterm's deferred composition commit consumes it.
  ordinaryKey(){if(!this.composing)this.composition=undefined;}
  send(text:string):Promise<void>{return this.enqueue(text,false);}
  binary(text:string):Promise<void>{return this.enqueue(text,true);}
  flush():Promise<void>{return this.active?new Promise(resolve=>this.idle.push(resolve)):Promise.resolve();}
  dispose(){this.stopped=true;for(const action of this.queue.splice(0))action.reject(Error('input_closed'));}
  private allowed(epoch:number){return !this.stopped&&this.snapshot.state==='user_owned'&&this.snapshot.epoch===epoch;}
  private enqueue(text:string,binary:boolean):Promise<void>{
    const origin=this.composition;if(!this.composing)this.composition=undefined;
    const epoch=origin?.epoch??this.snapshot.epoch;
    if(origin?.allowed===false||!this.allowed(epoch))return Promise.reject(Error('input_not_owned'));
    if(this.queue.length>=32)return Promise.reject(Error('input_queue_full'));
    return new Promise((resolve,reject)=>{this.queue.push({text,binary,epoch,resolve,reject});void this.drain();});
  }
  private async drain(){
    if(this.active)return;
    this.active=true;
    try{
      let action:Action|undefined;
      while((action=this.queue.shift())){
        try{
          for(const data of chunks(action.text,action.binary)){
            if(!this.allowed(action.epoch))throw Error('input_not_owned');
            if(this.sequence===Number.MAX_SAFE_INTEGER)throw Error('input_sequence_exhausted');
            await this.invoke({binding:this.binding,epoch:action.epoch,inputSeq:++this.sequence,data});
          }
          action.resolve();
        }catch(error){action.reject(error);}
      }
    }finally{this.active=false;for(const resolve of this.idle.splice(0))resolve();}
  }
}
function* chunks(text:string,binary:boolean):Generator<number[]>{
  const encoder=new TextEncoder();let chunk:number[]=[];
  for(const scalar of text){
    const bytes=binary?[scalar.charCodeAt(0)]:Array.from(encoder.encode(scalar));
    if(binary&&(scalar.length!==1||bytes[0]>255))throw Error('invalid_binary_input');
    if(chunk.length+bytes.length>16384){yield chunk;chunk=[];}
    chunk.push(...bytes);
  }
  if(chunk.length)yield chunk;
}
