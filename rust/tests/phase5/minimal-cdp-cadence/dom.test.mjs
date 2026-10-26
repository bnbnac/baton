import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {domExpression} from './dom.mjs';

function box(){
 const nodes=[],calls=[];const add=(tag,text='',attrs={})=>{const n={tag,textContent:text,disabled:false,isConnected:true,style:{},getClientRects:()=>[{}],getAttribute:k=>attrs[k]??null,click:()=>calls.push(text),dispatchEvent:e=>{calls.push(e.type);},...attrs};nodes.push(n);return n;};
 add('button','세션 ID 복사',{title:'session0'});add('button','soak-00 에이전트 제어');add('button','내가 제어하기');add('button','에이전트에 전달');
 const select=add('select','',{'aria-label':'전달할 MCP 연결',options:[{value:'c16',disabled:false}],value:''});const terminal=add('workspace');
 const document={querySelectorAll:q=>nodes.filter(n=>q==='button'?n.tag==='button':q==='.terminal-workspace'?n===terminal:n===select)};
 const run=(action,args={})=>JSON.parse(JSON.stringify(runInNewContext(domExpression(action,{sessionId:'session0',...args}),{document,getComputedStyle:()=>({visibility:'visible',display:'block'}),Event:class{constructor(type){this.type=type;}}})));
 return {add,nodes,calls,select,terminal,run};
}
test('DOM handlers select, resize, reclaim, choose and handoff only',()=>{
 const b=box();b.run('select',{label:'soak-00'});assert.equal(b.run('identity').sessionId,'session0');
 assert.equal(b.run('resize',{width:720}).width,720);assert.equal(b.terminal.style.width,'720px');
 b.run('reclaim');assert.equal(b.run('choose_connection',{connectionId:'c16'}).connectionId,'c16');b.run('handoff',{connectionId:'c16'});
 assert.deepEqual(b.calls,['soak-00 에이전트 제어','내가 제어하기','change','에이전트에 전달']);
});
for(const mode of ['duplicate','disabled','hidden','foreign','missing'])test('rejects '+mode+' target before input',()=>{
 const b=box(),n=b.nodes.find(n=>n.textContent==='내가 제어하기');
 if(mode==='duplicate')b.add('button','내가 제어하기');if(mode==='disabled')n.disabled=true;if(mode==='hidden')n.getClientRects=()=>[];if(mode==='foreign')b.nodes[0].title='other';if(mode==='missing')b.nodes.splice(b.nodes.indexOf(n),1);
 // Attributes are returned by the fixture's getAttribute, so foreign ID is set there.
 if(mode==='foreign')b.nodes[0].getAttribute=()=> 'other';
 assert.throws(()=>b.run('reclaim'));assert.deepEqual(b.calls,[]);
});
test('connection mismatch and removed option cannot trigger handoff',()=>{
 const b=box();assert.throws(()=>b.run('handoff',{connectionId:'c16'}));b.select.options=[];assert.throws(()=>b.run('choose_connection',{connectionId:'c16'}));assert.deepEqual(b.calls,[]);
});
test('fresh DOM, quoted IDs and fixed widths cannot inject code',()=>{
 const b=box();b.run('identity');b.nodes[0].getAttribute=()=> 'changed';assert.throws(()=>b.run('identity'));
 assert.throws(()=>domExpression('resize',{sessionId:'s',width:900}));assert.throws(()=>domExpression('invoke',{}));
 const source=domExpression('identity',{sessionId:'x";throw Error("inject")'});assert.ok(!source.includes('__TAURI'));assert.ok(source.includes('return'));
});
