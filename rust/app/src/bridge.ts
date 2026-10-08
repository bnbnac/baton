import {invoke,Channel} from '@tauri-apps/api/core';
export type Intervention={request_id:string;reason:string;state:'requested'|'declined'};
export type Connection={id:string;display_name:string};
export type Session={id:string;label:string;host:string;port:number;username:string;state:string;epoch:number;error:string|null;has_terminal:boolean;assigned_connection:string|null;intervention:Intervention|null};
export type Prompt={session:string;attempt:string;challenge:string;kind:'host'|'password'|'key'|'interactive';display:string;prompts:{text:string;echo:boolean}[]};
export type Event={type:'sessions';sessions:Session[]}|{type:'connections';connections:Connection[]}|{type:'auth';prompt:Prompt}|{type:'heartbeat';challenge:string};
export function command<T>(name:string,request:unknown){return invoke<T>(name,{request});}
export async function subscribe(callback:(event:Event)=>void){const events=new Channel<Event>();events.onmessage=event=>{if(event.type==='heartbeat'){void command('frontend_pong',{id:event.challenge}).catch(()=>{});}else callback(event);};return invoke<Session[]>('list_sessions',{events});}
