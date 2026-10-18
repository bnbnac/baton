export function transitionFixture(round=0){
 const index=round%16,visit=Math.floor(round/16),previous=visit%2?index+16:index,target=(previous+16)%32,epoch=visit*2+1;
 return {round,index,before:{session:'s'+index,adapter:previous,epoch,stream:`stream-${index}-${epoch}`},
  selected:{session:'s'+index,geometry:{rows:32,columns:120},selectedAt:100,stableAt:850},resized:{geometry:{rows:40,columns:140},observedAt:900},remote:'40 140',
  reclaimed:{session_id:'s'+index,state:'user_owned',control_epoch:epoch+1,stream_id:null},
  assigned:{connection_id:'c'+target,session:{session_id:'s'+index,state:'agent_owned',control_epoch:epoch+2,stream_id:`stream-${index}-${epoch+2}`}},
  oldOwner:{connection_id:'c'+previous,sessions:[]},targetConnection:'c'+target,adapter:target};
}
