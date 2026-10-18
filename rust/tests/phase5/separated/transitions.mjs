import assert from 'node:assert/strict';
export function verifyTransition({before,selected,resized,remote,reclaimed,assigned,oldOwner,targetConnection}){
 assert.equal(selected.session,before.session,'selected_session');assert.ok(selected.stableAt-selected.selectedAt>=750,'geometry_unstable');assert.ok(resized.observedAt>=selected.stableAt,'resize_before_selection');
 for(const g of [selected.geometry,resized.geometry])for(const key of ['rows','columns'])assert.ok(Number.isInteger(g[key])&&g[key]>0,'invalid_geometry');
 assert.ok(selected.geometry.rows!==resized.geometry.rows||selected.geometry.columns!==resized.geometry.columns,'geometry_unchanged');assert.deepEqual(remote.trim().split(/\s+/).map(Number),[resized.geometry.rows,resized.geometry.columns],'remote_geometry');
 assert.equal(reclaimed.session_id,before.session);assert.equal(reclaimed.state,'user_owned');assert.ok(reclaimed.control_epoch>before.epoch,'reclaim_epoch');assert.equal(reclaimed.stream_id,null,'private_stream');
 const p=assigned.session;assert.equal(assigned.connection_id,targetConnection,'target_connection');assert.equal(p.session_id,before.session);assert.equal(p.state,'agent_owned');assert.ok(p.control_epoch>reclaimed.control_epoch,'handoff_epoch');assert.ok(typeof p.stream_id==='string'&&p.stream_id.length&&p.stream_id!==before.stream,'handoff_stream');
 assert.ok(!oldOwner.sessions.some(s=>s.session_id===before.session),'old_owner_retained');assert.notEqual(oldOwner.connection_id,targetConnection,'same_owner');return {verified:true};
}
export function verifyRounds(rows,count,sessions,connections){
 assert.equal(rows.length,count,'round_count');assert.equal(sessions.length,16);assert.equal(connections.length,32);const bindings=new Map();
 for(let round=0;round<count;round++){
  const r=rows[round],index=round%16;assert.equal(r.round,round,'round_order');assert.equal(r.index,index);assert.equal(r.before.session,sessions.find(s=>s.index===index)?.id);
  assert.equal(r.adapter,(r.before.adapter+16)%32,'alternate_adapter');assert.equal(r.targetConnection,connections[r.adapter]);assert.equal(r.oldOwner.connection_id,connections[r.before.adapter]);
  if(bindings.has(index))assert.deepEqual(r.before,bindings.get(index),'binding_chain');else assert.equal(r.before.adapter,index,'initial_adapter');
  verifyTransition(r);bindings.set(index,{session:r.before.session,adapter:r.adapter,epoch:r.assigned.session.control_epoch,stream:r.assigned.session.stream_id});
 }
 return {rounds:count};
}
export async function selectedGeometry(r,s,selectedAt){
 let geometry,stableSince;
 return r.waitFor(async()=>{const p=await r.sessionStatus(s);assert.equal(p.state,'agent_owned');if(!geometry||geometry.rows!==p.geometry.rows||geometry.columns!==p.geometry.columns){geometry=p.geometry;stableSince=r.now();}return r.now()-stableSince>=750?{session:s.id,geometry,selectedAt:Math.max(selectedAt,stableSince),stableAt:r.now()}:false;},'selected_geometry');
}
export async function remoteGeometry(r,s,round,geometry){
 const path=`/tmp/separated-size-${s.index}-${round}`;await r.command(s,`stty size > ${path}`);
 const remote=await r.waitFor(async()=>await r.docker('exec',r.fixtures[s.index%2].id,'sh','-c',`cat ${path} 2>/dev/null || true`),'remote_geometry');
 await r.event('remote_geometry',{session:s.id,round,geometry,remote});assert.deepEqual(remote.split(/\s+/).map(Number),[geometry.rows,geometry.columns]);return remote;
}
export async function performFunctionalTransition(r,round){
 const s=r.sessions[round%16],before={session:s.id,adapter:s.adapter,epoch:s.epoch,stream:s.stream},page=r.page;
 await r.during(()=>page.getByRole('button',{name:`soak-${String(s.index).padStart(2,'0')} 에이전트 제어`,exact:true}).click());
 const fullId=await page.getByRole('button',{name:'세션 ID 복사',exact:true}).getAttribute('title');assert.equal(fullId,s.id,'visible_session_id');
 const selected=await selectedGeometry(r,s,r.now());await r.event('selected',{round,...selected});
 await r.during(()=>page.locator('.terminal-workspace').evaluate((el,width)=>{el.style.width=width+'px';},selected.geometry.columns>=90?720:1000));
 const resized=await r.waitFor(async()=>{const p=await r.sessionStatus(s);return p.geometry.rows!==selected.geometry.rows||p.geometry.columns!==selected.geometry.columns?{geometry:p.geometry,observedAt:r.now()}:false;},'resized');
 const remote=await remoteGeometry(r,s,round,resized.geometry);
 await r.setTransition(s,'reclaiming');await r.during(()=>page.getByRole('button',{name:'내가 제어하기',exact:true}).click());
 const reclaimed=await r.waitFor(async()=>{const p=await r.sessionStatus(s);return p.state==='user_owned'?p:false;},'reclaimed');await r.setTransition(s,'reclaimed');
 const adapter=(before.adapter+16)%32,targetConnection=r.connections[adapter];
 await r.during(()=>page.getByLabel('전달할 MCP 연결').selectOption(targetConnection));await r.during(()=>page.getByRole('button',{name:'에이전트에 전달',exact:true}).click());
 const assigned=await r.waitFor(async()=>{const a=await r.status(adapter),p=a.sessions.find(p=>p.session_id===s.id);return p?.state==='agent_owned'?{connection_id:a.connection_id,session:p}:false;},'assigned');
 const oldOwner=await r.status(before.adapter),record={round,index:s.index,before,selected,resized,remote,reclaimed,assigned,oldOwner,targetConnection,adapter};verifyTransition(record);
 await r.adoptBinding(s,{adapter,epoch:assigned.session.control_epoch,stream:assigned.session.stream_id});return record;
}
export async function runFunctional(r,{transition=performFunctionalTransition}={}){
 await r.startMeasurement();const records=[];
 try{
  for(let round=0;round<r.contract.rounds;round++){
   const record=await transition(r,round);records.push(record);await r.event('transition',record);await r.audit(round);await r.health();await r.service();
  }
  verifyRounds(records,r.contract.rounds,r.sessions,r.connections);r.summary.rates=r.outputRates();for(const rate of r.summary.rates)assert.ok(rate.bytesPerSecond>=1024,'output_rate');
 }finally{await r.freeze();}
 await r.verifyAudits();r.summary.normalWorkloadPassed=true;r.summary.completedRounds=records.length;return {workloadPassed:true,rounds:records.length};
}
