export type Challenge={session:string;attempt:string;challenge:string};
export class AuthState {
  current:Challenge|null=null; fields:string[]=[];
  show(challenge:Challenge){this.clear();this.current=challenge;}
  take(){const answer={challenge:this.current,fields:this.fields};this.fields=[];this.current=null;return answer;}
  clear(){this.fields.fill('');this.fields=[];this.current=null;}
}
