// Run: node --test rust/tests/phase5/ui-stability.mjs
// Requires app dependencies plus Playwright (BATON_PLAYWRIGHT_PATH) and Edge
// or another Chromium executable (BATON_BROWSER_PATH). No SSH server is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createServer} from '../../app/node_modules/vite/dist/node/index.js';
const {chromium}=await import(pathToFileURL(process.env.BATON_PLAYWRIGHT_PATH??'C:/Users/sj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href);
const session={id:'session-a',label:'A',host:'localhost',port:22,username:'fixture',state:'user_owned',epoch:2,error:null,has_terminal:true,assigned_connection:null,intervention:null};
test('UI controls remain usable across snapshots without hiding ownership changes',async t=>{
  const server=await createServer({root:fileURLToPath(new URL('../../app/',import.meta.url)),server:{host:'127.0.0.1',port:0},configFile:false});
  let browser;
  try{
    await server.listen();
    browser=await chromium.launch({executablePath:process.env.BATON_BROWSER_PATH??'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
    const origin=server.resolvedUrls.local[0];
    async function panel(){
      const page=await browser.newPage();
      await page.route('**/fixture',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="panel"></div>'}));
      await page.goto(origin+'fixture');
      await page.evaluate(async session=>{
        const {OwnershipView}=await import('/src/connections/view.ts');const {Ownership}=await import('/src/sessions/ownership.ts');
        const model=new Ownership();model.updateConnections([{id:'a',display_name:'A'},{id:'b',display_name:'B'}]);model.selectConnection('a');
        const f={model,session,requests:[],resolve:null};window.fixture=f;
        f.view=new OwnershipView(document.querySelector('#panel'),model,(name,request)=>{f.requests.push({name,request});return new Promise(resolve=>f.resolve=resolve);},()=>f.view.render(f.session),e=>{throw e;});
        f.view.render(session);
      },session);
      return page;
    }
    await t.test('same session and connection snapshots preserve focused selection',async()=>{
      const page=await panel();
      try{
        await page.locator('select').focus();
        const retained=await page.evaluate(()=>{const f=window.fixture,select=document.querySelector('select');for(let i=0;i<100;i++){f.model.updateConnections(structuredClone(f.model.connections));f.view.render(structuredClone(f.session));}return select===document.activeElement&&select.isConnected;});
        assert.equal(retained,true,'identical snapshots must not detach the focused selector');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.evaluate(()=>window.fixture.model.selectedConnection),'b');
        await page.getByRole('button',{name:'에이전트에 전달',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[{name:'handoff_session',request:{id:'session-a',expected_epoch:2,connection_id:'b'}}]);
      }finally{await page.close();}
    });
    await t.test('new epoch, pending request and disconnected selection update actions',async()=>{
      const page=await panel();
      try{
        await page.evaluate(()=>{const f=window.fixture;f.session.has_terminal=false;f.view.render(f.session);});
        assert.equal(await page.getByRole('button',{name:'에이전트에 전달',exact:true}).isDisabled(),true);
        await page.evaluate(()=>{const f=window.fixture;f.session.has_terminal=true;f.view.render(f.session);});
        await page.evaluate(()=>{const f=window.fixture;f.session.epoch=7;f.view.render(f.session);});
        await page.getByRole('button',{name:'에이전트에 전달',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[{name:'handoff_session',request:{id:'session-a',expected_epoch:7,connection_id:'a'}}]);
        assert.equal(await page.locator('select').isDisabled(),true);
        assert.equal(await page.getByRole('button',{name:'에이전트에 전달',exact:true}).isDisabled(),true);
        await page.evaluate(async()=>{const f=window.fixture;f.resolve();await new Promise(r=>setTimeout(r,0));});
        assert.equal(await page.locator('select').isDisabled(),false);
        await page.evaluate(()=>{const f=window.fixture;f.model.updateConnections([{id:'b',display_name:'B'}]);f.view.render(f.session);});
        assert.equal(await page.locator('select').inputValue(),'');
        assert.equal(await page.getByRole('button',{name:'에이전트에 전달',exact:true}).isDisabled(),true);
        assert.equal(await page.locator('option[value=a]').count(),0);
      }finally{await page.close();}
    });
    await t.test('ownership, intervention and session changes refresh captured requests',async()=>{
      const page=await panel();
      try{
        await page.evaluate(()=>{const f=window.fixture;Object.assign(f.session,{id:'session-b',state:'agent_owned',epoch:8,assigned_connection:'b',intervention:{request_id:'r1',reason:'first',state:'requested'}});f.view.render(f.session);f.session.intervention={request_id:'r2',reason:'second',state:'requested'};f.view.render(f.session);});
        assert.equal(await page.locator('select').isDisabled(),true);
        assert.equal(await page.locator('.intervention p').innerText(),'second');
        await page.getByRole('button',{name:'요청 거절',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[{name:'decline_intervention',request:{id:'session-b',expected_epoch:8,request_id:'r2'}}]);
        await page.evaluate(async()=>{const f=window.fixture;f.resolve();await new Promise(r=>setTimeout(r,0));f.session.epoch=9;f.session.intervention.state='declined';f.view.render(f.session);});
        assert.equal(await page.getByRole('button',{name:'요청 거절',exact:true}).count(),0);
        await page.getByRole('button',{name:'내가 제어하기',exact:true}).click();
        assert.deepEqual(await page.evaluate(()=>window.fixture.requests[1]),{name:'reclaim_session',request:{id:'session-b',expected_epoch:9}});
        await page.evaluate(()=>window.fixture.view.render(undefined));
        assert.equal(await page.locator('#panel button').count(),0);
      }finally{await page.close();}
    });
    await t.test('session tab focus survives identical snapshots and unrelated epoch changes',async()=>{
      const page=await browser.newPage();
      try{
        // Only the external Tauri IPC boundary is replaced; render and views are real.
        await page.route('**/src/bridge.ts',route=>route.fulfill({contentType:'text/javascript',body:'export async function command(){throw Error("unexpected command");} export async function subscribe(callback){window.emit=callback;return []; }'}));
        await page.goto(origin);
        await page.waitForFunction(()=>typeof window.emit==='function');
        const sessions=[{...session,state:'connecting',has_terminal:false},{...session,id:'session-b',label:'B',state:'connecting',has_terminal:false}];
        await page.evaluate(sessions=>{window.sessions=sessions;window.emit({type:'sessions',sessions});},sessions);
        await page.locator('nav button').nth(1).focus();
        const retained=await page.evaluate(()=>{const button=document.activeElement;for(let i=0;i<100;i++)window.emit({type:'sessions',sessions:structuredClone(window.sessions)});window.sessions[0].epoch=9;window.emit({type:'sessions',sessions:structuredClone(window.sessions)});return document.activeElement===button&&button.isConnected;});
        assert.equal(retained,true,'session buttons must survive output-only snapshots');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('h1').innerText(),'B');
        await page.evaluate(()=>{window.sessions[1].label='Renamed';window.sessions[1].state='closed';window.emit({type:'sessions',sessions:structuredClone(window.sessions)});});
        assert.equal(await page.locator('nav button.active strong').innerText(),'Renamed');
        assert.equal(await page.locator('nav button.active small').innerText(),'종료됨');
        await page.evaluate(()=>window.emit({type:'sessions',sessions:[window.sessions[0]]}));
        assert.equal(await page.locator('nav button').count(),1);assert.equal(await page.locator('h1').innerText(),'A');
      }finally{await page.close();}
    });
  }finally{await browser?.close();await server.close();}
});
