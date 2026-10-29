import {invoke,Channel} from '@tauri-apps/api/core';
import type {Binding,Frame,TerminalBridge} from './types.js';
export function terminalBridge(error:(error:unknown)=>void):TerminalBridge {
  const call=(name:string,request:unknown)=>invoke<void>(name,{request});
  return {
    input:({inputSeq,...rest})=>call('user_input',{...rest,input_seq:inputSeq}),
    ack:(binding,seq)=>call('ack_output',{binding,seq}),
    reply:(binding,q,row,column)=>call('terminal_reply',{binding,epoch:q.epoch,query:q.id,kind:q.kind,row,column}),
    resize:(binding,seq,columns,rows)=>call('resize_terminal',{binding,resize_seq:seq,columns,rows}),error,
  };
}
export function bindTerminal(session:string,callback:(frame:Frame)=>void):Promise<Binding>{
  const output=new Channel<Frame>();output.onmessage=callback;
  return invoke('bind_terminal',{request:{id:session},output});
}
