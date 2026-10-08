import type {Connection,Session} from '../bridge.js';
export class Ownership {
  connections:Connection[]=[];
  selectedConnection:string|null=null;
  private pending=new Set<string>();
  updateConnections(connections:Connection[]){this.connections=connections;if(!connections.some(c=>c.id===this.selectedConnection))this.selectedConnection=null;}
  selectConnection(id:string){this.selectedConnection=this.connections.some(c=>c.id===id)?id:null;}
  begin(id:string){this.pending.add(id);}
  finish(id:string){this.pending.delete(id);}
  busy(id:string){return this.pending.has(id);}
  handoff(session:Session){return session.state==='user_owned'&&session.has_terminal&&!this.busy(session.id)&&this.selectedConnection?{id:session.id,expected_epoch:session.epoch,connection_id:this.selectedConnection}:null;}
  reclaim(session:Session){return session.state==='agent_owned'&&!this.busy(session.id)?{id:session.id,expected_epoch:session.epoch}:null;}
  decline(session:Session){return session.state==='agent_owned'&&!this.busy(session.id)&&session.intervention?.state==='requested'?{id:session.id,expected_epoch:session.epoch,request_id:session.intervention.request_id}:null;}
}
