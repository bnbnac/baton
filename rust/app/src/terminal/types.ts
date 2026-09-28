export type Binding={session:string;view:string};
export type Snapshot={state:string;epoch:number};
export type Query={id:number;kind:'dsr'|'cpr'|'da';epoch:number;endOffset:number};
export type Frame={binding:Binding;seq:number;bytes:number[];queries:Query[]};
export type InputCall={binding:Binding;epoch:number;inputSeq:number;data:number[]};
export interface TerminalBridge {
  input(call:InputCall):Promise<void>;
  ack(binding:Binding,seq:number):Promise<void>;
  reply(binding:Binding,query:Query,row?:number,column?:number):Promise<void>;
  resize(binding:Binding,seq:number,columns:number,rows:number):Promise<void>;
  error(error:unknown):void;
}
