import assert from 'node:assert/strict';

// Instance-local wrappers leave frozen historical modules untouched. A deadline
// never cancels an in-flight operation; its outcome is awaited before cleanup.
export function installArmGuard(r){
 let mode='preparing',measurementStart,roundDeadline=null,violation,reported=false,stopFailure;
 const checkStop=r.checkStop?.bind(r);
 const preparationDeadline=r.born+r.contract.preparationMs;
 const g={
  get globalDeadline(){return measurementStart===undefined?preparationDeadline:measurementStart+r.contract.seconds*1000;},
  get deadline(){return ['tail','freeze'].includes(mode)?g.globalDeadline+r.contract.freezeGraceMs:Math.min(g.globalDeadline,roundDeadline??Infinity);},
  get mode(){return mode;},
  startMeasurement(startMs){
   assert.ok(mode==='preparing'&&!violation&&!stopFailure&&Number.isFinite(startMs)&&startMs>=r.born&&startMs<=r.now()&&r.now()<=preparationDeadline,'measurement_start');
   measurementStart=startMs;mode='measurement';
  },
  beginRound(deadline){
   assert.ok(mode==='measurement'&&!violation&&!stopFailure&&Number.isFinite(deadline)&&r.now()<deadline&&deadline<=g.globalDeadline,'round_admission');
   roundDeadline=deadline;
  },
  betweenRounds(){roundDeadline=null;},
  beginTail(){assert.ok(mode==='measurement'&&!violation&&!stopFailure&&roundDeadline===null,'tail_state');mode='tail';},
  beginFreeze(){assert.ok(measurementStart!==undefined&&['measurement','tail'].includes(mode),'freeze_state');mode='freeze';roundDeadline=null;},
  finish(){mode='finished';},
  async check(){
   if(mode==='finished')return;
   // Poll the original stop check before admitting any wrapped operation. Keep
   // the first stop latched even if its file disappears; finalization/cleanup
   // can still run after beginFreeze()/finish(). Never call our own wrapper.
   if(mode!=='freeze'){
    if(stopFailure)throw stopFailure;
    try{await checkStop?.();}catch(error){stopFailure=error;throw error;}
   }
   const observedAt=r.now(),deadline=g.deadline;
   if(mode!=='freeze'&&violation)throw Error(violation);
   if(observedAt<=deadline)return;
   const reason=mode==='preparing'?'preparation_deadline':mode==='freeze'?'freeze_deadline':mode==='tail'?'tail_deadline':observedAt>g.globalDeadline?'measurement_deadline':'round_deadline';
   violation??=reason;
   if(!reported){reported=true;await r.event('attached_deadline',{observedAt,deadline,reason});}
   throw Error(reason);
  }
 };
 r.cadenceGuard=g;
 for(const name of ['tool','read','checkStop','docker','ps'])if(typeof r[name]==='function'){
  const original=r[name].bind(r);
  r[name]=async(...args)=>{
   assert.ok(mode!=='freeze','measurement_frozen');
   if(mode==='tail'&&name==='tool')assert.ok(['status','read_output'].includes(args[1]),'read_only_tail');
   await g.check();
   try{const result=await original(...args);await g.check();return result;}catch(error){await g.check();throw error;}
  };
 }
 if(r.waitFor){const original=r.waitFor.bind(r);r.waitFor=async(check,label,timeout=45000,options)=>{
  await g.check();const value=await original(check,label,mode==='finished'?timeout:Math.min(timeout,Math.max(0,g.deadline-r.now())),options);await g.check();return value;
 };}
 r.during=async operation=>{
  await g.check();assert.ok(mode!=='freeze','measurement_frozen');assert.ok(mode!=='tail','read_only_tail');let done=false,result,failure;
  const pending=Promise.resolve().then(operation).then(v=>{result=v;},e=>{failure=e;}).finally(()=>{done=true;});
  try{while(!done){await g.check();await r.service();await r.sleep(100);}}finally{await pending;}
  await g.check();if(failure)throw failure;return result;
 };
 return g;
}
