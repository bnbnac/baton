import {invoke,Channel} from '@tauri-apps/api/core';
export type Intervention={request_id:string;reason:string;state:'requested'|'declined'};
export type Connection={id:string;display_name:string};
export type Session={id:string;label:string;host:string;port:number;username:string;state:string;epoch:number;error:string|null;has_terminal:boolean;assigned_connection:string|null;intervention:Intervention|null};
export type Prompt={session:string;attempt:string;challenge:string;kind:'host'|'password'|'key'|'interactive';display:string;prompts:{text:string;echo:boolean}[]};
export type SessionSnapshot={revision:number;sessions:Session[]};
export type Event=({type:'sessions'}&SessionSnapshot)|{type:'connections';connections:Connection[]}|{type:'auth';prompt:Prompt}|{type:'heartbeat';challenge:string};
export function command<T>(name:string,request:unknown){return invoke<T>(name,{request});}
export async function subscribe(callback:(event:Event)=>void):Promise<void>{
  let revision=0;
  const receive=(event:Event)=>{
    if(event.type==='heartbeat'){void command('frontend_pong',{id:event.challenge}).catch(()=>{});return;}
    if(event.type==='sessions'){
      if(!Number.isSafeInteger(event.revision)||event.revision<=revision)return;
      revision=event.revision;
    }
    callback(event);
  };
  const events=new Channel<Event>();events.onmessage=receive;
  const initial=await invoke<SessionSnapshot>('list_sessions',{events});
  // A notification may already have delivered a newer list while invoke waited.
  receive({type:'sessions',...initial});
}
