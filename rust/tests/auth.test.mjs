import test from 'node:test';
import assert from 'node:assert/strict';
import { runSshCase } from './helpers/ssh-case.mjs';

test('cancel remains latched when held authentication actually succeeds afterward', async () => {
  const r = await runSshCase('cancel-late-success');
  assert.equal(r.outcome, 'cancelled');
  assert.equal(r.authReleaseAttempts, 1);
  assert.equal(r.authReleasedWhileOpen, true);
  assert.equal(r.successObservedAfterCancel, true);
  assert.equal(r.authReleasedBeforeClose, true);
  assert.equal(r.shellRequests, 0);
  assert.equal(r.ptyRequests, 0);
});

// Break caught: late auth completion or fallback must not open a shell after refusal/cancel.
for (const [name, outcome] of [
  ['host-reject', 'host_rejected'], ['host-cancel', 'cancelled'],
  ['wrong-password', 'auth_failed'], ['wrong-key-passphrase', 'auth_failed'],
  ['cancel-before-auth', 'cancelled'], ['cancel-between-rounds', 'cancelled'],
  ['cancel-before-shell', 'cancelled'], ['cancel-late-success', 'cancelled'],
]) {
  test(name, async () => {
    const r = await runSshCase(name);
    assert.equal(r.outcome, outcome);
    assert.equal(r.shellRequests, 0);
    assert.equal(r.ptyRequests, 0);
    assert.deepEqual(r.receivedHex, []);
    if (name.startsWith('host-') || name === 'cancel-before-auth' || name === 'wrong-key-passphrase') assert.equal(r.authRequests, 0);
  });
}
for (const name of ['encrypted-key', 'interactive-two-rounds', 'password-then-interactive']) {
  test(name, async () => {
    const r = await runSshCase(name);
    assert.equal(r.outcome, 'ok');
    assert.equal(r.shellRequests, 1);
    assert.equal(r.ptyRequests, 1);
    if (name === 'interactive-two-rounds' || name === 'password-then-interactive') assert.equal(r.authRounds, 2);
  });
}
