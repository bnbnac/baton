import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deadline, observe, stop } from './helpers/process.mjs';

function running(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
for (const stage of ['after-fixture-ready', 'auth-held', 'mcp-wait', 'terminal-wait', 'container-ready']) {
  test(`injected ${stage} failure exits nonzero and releases owned children only`, async () => {
    const sentinel = observe(fork(fileURLToPath(new URL('./fixtures/sentinel.mjs', import.meta.url)), [], { silent: true, windowsHide: true, execArgv: [] }));
    const runner = observe(fork(fileURLToPath(new URL('./helpers/cleanup-runner.mjs', import.meta.url)), [stage], { silent: true, windowsHide: true, execArgv: [] }));
    const messages = []; runner.child.on('message', message => messages.push(message));
    runner.child.stdout.resume(); runner.child.stderr.resume();
    try {
      const result = await deadline(runner.closed, 45000, 'failure_runner_timeout');
      assert.equal(result.code, 1);
      assert.equal(messages.find(x => x.type === 'failure')?.code, 'injected_' + stage);
      const children = messages.filter(x => x.type === 'owned');
      assert.equal(children.length, stage === 'auth-held' || stage === 'terminal-wait' ? 2 : 1);
      for (const child of children) assert.equal(running(child.pid), false, child.role + ' leaked');
      assert.equal(running(sentinel.child.pid), true);
      const pong = new Promise(resolve => sentinel.child.once('message', resolve));
      sentinel.child.send({ type: 'ping' });
      assert.deepEqual(await deadline(pong, 1000, 'sentinel_lost'), { type: 'pong' });
    } finally { await stop(runner); await stop(sentinel); }
  });
}
