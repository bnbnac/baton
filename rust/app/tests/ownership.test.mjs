import test from 'node:test';
import assert from 'node:assert/strict';
import { Ownership } from '../.test-output/sessions/ownership.js';
const session=(id='session-a',state='user_owned',epoch=4)=>({id,state,epoch,has_terminal:true,intervention:null});
test('connection removal clears the choice and never auto-selects another connection',()=>{
  const view=new Ownership();view.updateConnections([{id:'a',display_name:'A'},{id:'b',display_name:'B'}]);
  assert.equal(view.selectedConnection,null);assert.equal(view.handoff(session()),null);
  view.selectConnection('a');assert.equal(view.handoff(session()).connection_id,'a');
  view.updateConnections([{id:'b',display_name:'B'}]);assert.equal(view.selectedConnection,null);assert.equal(view.handoff(session()),null);
});
test('a button action captures its session and epoch; pending state never reports ownership completion',()=>{
  const view=new Ownership();view.updateConnections([{id:'a',display_name:'A'}]);view.selectConnection('a');
  const target=session();const request=view.handoff(target);view.begin(target.id);
  assert.deepEqual(request,{id:'session-a',expected_epoch:4,connection_id:'a'});
  assert.equal(view.handoff(target),null);assert.equal(view.reclaim(session('session-a','agent_owned',5)),null);
  view.finish(target.id);assert.deepEqual(view.reclaim(session('session-a','agent_owned',5)),{id:'session-a',expected_epoch:5});
  assert.equal(target.state,'user_owned');assert.equal(view.handoff(session('session-b')).id,'session-b');assert.equal(request.id,'session-a');
});
test('transition states disable actions and only a requested intervention can be declined',()=>{
  const view=new Ownership();view.updateConnections([{id:'a',display_name:'A'}]);view.selectConnection('a');
  for(const state of ['connecting','transferring','reclaiming','closed']){assert.equal(view.handoff(session('s',state)),null);assert.equal(view.reclaim(session('s',state)),null);}
  const s={...session('s','agent_owned',8),intervention:{request_id:'r',reason:'<img onerror=x>',state:'requested'}};
  assert.deepEqual(view.decline(s),{id:'s',expected_epoch:8,request_id:'r'});assert.equal(s.state,'agent_owned');
  assert.equal(view.decline({...s,intervention:{...s.intervention,state:'declined'}}),null);
});
