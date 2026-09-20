import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observe, deadline, stop } from './helpers/process.mjs';

test('OpenSSH reports actual geometry and survives foreground interrupt', async () => {
  assert.ok(process.env.BATON_PROBE_SSH_PORT, 'run through test-openssh.ps1');
  assert.ok(process.env.BATON_PROBE_HOST_KEY);
  const proc = observe(spawn(fileURLToPath(new URL('../target/debug/baton-ssh-probe.exe', import.meta.url)), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
  let output = '';
  proc.child.stdout.on('data', b => { output += b; if (output.length > 65536) proc.child.kill(); });
  let stages = '';
  proc.child.stderr.on('data', b => { stages += b; if (stages.length > 65536) proc.child.kill(); });
  try {
    proc.child.stdin.end(JSON.stringify({ case: 'openssh', host: '127.0.0.1', port: Number(process.env.BATON_PROBE_SSH_PORT), hostFingerprint: process.env.BATON_PROBE_HOST_KEY,
      credential: { username: 'batonfixture', password: 'baton-fixture-only' } }) + '\n');
    assert.equal((await deadline(proc.closed, 12000, 'probe_timeout')).code, 0);
    assert.deepEqual(JSON.parse(output), { outcome: 'ok' }, stages);
  } finally { await stop(proc); }
});
