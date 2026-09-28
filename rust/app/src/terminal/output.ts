import type {Binding,Frame} from './types.js';
export class OutputQueue {
  private sequence=0;
  private bytes=0;
  private active=false;
  private stopped=false;
  private queue:{frame:Frame;resolve:()=>void;reject:(e:unknown)=>void}[]=[];
  constructor(readonly binding:Binding,private readonly consume:(frame:Frame)=>Promise<void>){}
  write(frame:Frame):Promise<void>{
    if(this.stopped)return Promise.reject(Error('output_closed'));
    if(frame.binding.session!==this.binding.session||frame.binding.view!==this.binding.view)return Promise.reject(Error('foreign_frame'));
    if(!Number.isSafeInteger(frame.seq)||frame.seq!==this.sequence+1)return Promise.reject(Error('invalid_frame_sequence'));
    if(!frame.bytes.length||this.bytes+frame.bytes.length>65536||frame.bytes.some(b=>!Number.isInteger(b)||b<0||b>255))return Promise.reject(Error('invalid_frame_bytes'));
    let previous=-1;
    for(const q of frame.queries){
      if(!Number.isSafeInteger(q.id)||q.id<1||!Number.isSafeInteger(q.epoch)||q.epoch<0||!Number.isInteger(q.endOffset)||q.endOffset<=previous||q.endOffset>=frame.bytes.length||!['dsr','cpr','da'].includes(q.kind))return Promise.reject(Error('invalid_query_mark'));
      previous=q.endOffset;
    }
    this.sequence=frame.seq;this.bytes+=frame.bytes.length;
    return new Promise((resolve,reject)=>{this.queue.push({frame,resolve,reject});void this.drain();});
  }
  dispose(){this.stopped=true;for(const item of this.queue.splice(0)){this.bytes-=item.frame.bytes.length;item.reject(Error('output_closed'));}}
  private async drain(){
    if(this.active)return;this.active=true;
    try{let item;while((item=this.queue.shift())){
      try{await this.consume(item.frame);item.resolve();}catch(error){item.reject(error);this.dispose();}
      finally{this.bytes-=item.frame.bytes.length;}
    }}finally{this.active=false;}
  }
}
