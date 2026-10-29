import test from 'node:test';
import assert from 'node:assert/strict';
import { runSshCase } from './helpers/ssh-case.mjs';

// Break caught: omitted PTY, altered/duplicate input, or missing resize.
test('password opens one PTY and forwards exact input and resize', async () => {
  const r = await runSshCase('password-pty');
  assert.equal(r.outcome, 'ok');
  assert.equal(r.ptyRequests, 1);
  assert.equal(r.shellRequests, 1);
  assert.deepEqual(r.receivedHex, ['4142430d']);
  assert.deepEqual(r.sizes, [[120, 32], [91, 27]]);
  assert.equal(r.fixtureStopped && r.probeStopped, true);
});
