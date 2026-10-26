import assert from 'node:assert/strict';

// The entire evaluated program is fixed here. Arguments are JSON, never code.
function operate(action,args){
 const visible=n=>n.isConnected&&n.getClientRects().length>0&&getComputedStyle(n).display!=='none'&&getComputedStyle(n).visibility==='visible';
 const one=nodes=>{if(nodes.length!==1)throw Error('dom_ambiguous');const n=nodes[0];if(n.disabled||!visible(n))throw Error('dom_unavailable');return n;};
 const button=text=>one([...document.querySelectorAll('button')].filter(n=>n.textContent.trim()===text));
 const identity=()=>{const id=button('세션 ID 복사').getAttribute('title');if(id!==args.sessionId)throw Error('dom_session');return id;};
 if(action==='select')button(args.label+' 에이전트 제어').click();
 const sessionId=identity();
 if(action==='resize'){const n=one([...document.querySelectorAll('.terminal-workspace')]);n.style.width=args.width+'px';return {sessionId,width:args.width};}
 if(action==='reclaim')button('내가 제어하기').click();
 if(action==='choose_connection'||action==='handoff'){
  const n=one([...document.querySelectorAll('select[aria-label="전달할 MCP 연결"]')]);
  const matches=[...n.options].filter(o=>o.value===args.connectionId&&!o.disabled);if(matches.length!==1)throw Error('dom_connection_option');
  if(action==='choose_connection'){n.value=args.connectionId;n.dispatchEvent(new Event('change',{bubbles:true}));}
  const current=one([...document.querySelectorAll('select[aria-label="전달할 MCP 연결"]')]);
  if(current.value!==args.connectionId)throw Error('dom_connection');
  if(action==='handoff')button('에이전트에 전달').click();
  return {sessionId,connectionId:args.connectionId};
 }
 return {sessionId};
}
export function domExpression(action,args){
 assert.ok(['select','identity','resize','reclaim','choose_connection','handoff'].includes(action),'dom_action');
 assert.ok(args&&typeof args.sessionId==='string'&&args.sessionId.length>0&&args.sessionId.length<=128,'dom_session_arg');
 const allowed=['sessionId',...(action==='select'?['label']:action==='resize'?['width']:['choose_connection','handoff'].includes(action)?['connectionId']:[])];
 assert.ok(Object.keys(args).every(k=>allowed.includes(k)),'dom_args');
 if(action==='select')assert.match(args.label,/^soak-\d{2}$/);
 if(action==='resize')assert.ok([720,1000].includes(args.width),'dom_width');
 if(allowed.includes('connectionId'))assert.ok(typeof args.connectionId==='string'&&args.connectionId.length>0&&args.connectionId.length<=128,'dom_connection_arg');
 return `(${operate.toString()})(${JSON.stringify(action)},${JSON.stringify(args)})`;
}
