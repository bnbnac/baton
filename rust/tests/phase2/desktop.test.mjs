import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {observe,deadline,stop} from '../helpers/process.mjs';
import {checkDesktop,terminalCases} from './evidence.mjs';
test('real WebView terminal and geometry cases have complete wire and shutdown evidence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'baton-desktop-test-')),report=process.env.BATON_DESKTOP_REPORT??join(dir,'result.json');
 const runner=observe(spawn(process.execPath,[fileURLToPath(new URL('./desktop.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,BATON_DESKTOP_SUITE:'all',BATON_DESKTOP_CASE:'',BATON_DESKTOP_REPORT:report}}));
 let errors='';runner.child.stdout.resume();runner.child.stderr.on('data',b=>errors+=b);
 try{assert.equal((await deadline(runner.closed,180000,'desktop_test_timeout')).code,0,errors);checkDesktop(JSON.parse(await readFile(report,'utf8')),[...terminalCases,'geometry']);}finally{await stop(runner);}
});
