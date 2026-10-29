import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {executable} from './helper.mjs';import {deadline,observe,stop} from '../helpers/process.mjs';
test('product SSH transport: real OpenSSH geometry and foreground interrupt',async()=>{
  assert.ok(process.env.BATON_PROBE_SSH_PORT,'run test-openssh.ps1 -Phase2');assert.ok(process.env.BATON_PROBE_HOST_KEY);
  const p=observe(spawn(await executable(),[],{windowsHide:true,stdio:['pipe','pipe','pipe']}));let output='',errors='';p.child.stdout.on('data',b=>output+=b);p.child.stderr.on('data',b=>errors+=b);
  try {p.child.stdin.end(JSON.stringify({case:'openssh',port:Number(process.env.BATON_PROBE_SSH_PORT),host_fingerprint:process.env.BATON_PROBE_HOST_KEY,private_key:null})+'\n');assert.equal((await deadline(p.closed,15000,'driver_timeout')).code,0,errors);const messages=output.trim().split('\n').map(l=>JSON.parse(l));assert.equal(messages.find(m=>m.outcome)?.outcome,'ok',output);for(const stage of ['initial-32x120','resized-27x91','interrupt-survived','owned-stream-dropped'])assert.ok(messages.some(m=>m.stage===stage),stage);}finally{await stop(p);}
});
