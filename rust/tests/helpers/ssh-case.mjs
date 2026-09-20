import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { deadline, observe, stop } from './process.mjs';

export async function runSshCase(name, options = {}) {
  const fixture = observe(fork(fileURLToPath(new URL('../fixtures/ssh.mjs', import.meta.url)), [name], { silent: true, windowsHide: true, execArgv: [] }));
  options.onSpawn?.(fixture, 'fixture');
  const events = [];
  let probe;
  let stdout = '', stderr = '';
  try {
    const ready = await deadline(new Promise((resolve, reject) => {
      fixture.child.on('message', m => { events.push(m); if (m.type === 'ready') resolve(m); });
      fixture.child.once('error', reject);
      fixture.closed.then(() => reject(new Error('fixture_exited_before_ready')));
    }), 5000, 'fixture_not_ready');
    if (options.injectFailure === 'after-fixture-ready') throw new Error('injected_after-fixture-ready');
    probe = observe(spawn(fileURLToPath(new URL('../../target/debug/baton-ssh-probe.exe', import.meta.url)), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    options.onSpawn?.(probe, 'ssh-probe');
    probe.child.stdout.on('data', b => { stdout += b; if (stdout.length > 65536) probe.child.kill(); });
    probe.child.stderr.on('data', b => { stderr += b; if (stderr.length > 65536) probe.child.kill(); });
    probe.child.stdin.on('error', () => {});
    const reader = createInterface({ input: probe.child.stdout });
    reader.on('line', line => {
      const message = JSON.parse(line);
      if (message.outcome) probe.child.stdin.end();
      if (message.stage === 'cancel-barrier') probe.child.stdin.write('{"cancel":true}\n');
      if (message.stage === 'cancelled' && name === 'cancel-late-success') fixture.child.send({ type: 'release-auth' });
    });
    let rejectInjected;
    const injected = new Promise((_, reject) => { rejectInjected = reject; });
    fixture.child.on('message', m => {
      if (m.type !== 'auth-held') return;
      if (options.injectFailure === 'auth-held') rejectInjected(new Error('injected_auth-held'));
      else probe.child.stdin.write('{"cancel":true}\n');
    });
    probe.child.stdin.write(JSON.stringify({ case: name, host: '127.0.0.1', port: ready.port,
      hostFingerprint: name === 'host-reject' ? 'SHA256:WRONG' : ready.fingerprint,
      credential: { username: 'fixture', password: name === 'wrong-password' ? 'wrong' : 'fixture-only',
        privateKey: ready.privateKey ?? null, passphrase: name === 'wrong-key-passphrase' ? 'wrong' : 'fixture-key-pass',
        responses: ['123456', '654321'] } }) + '\n');
    const exited = await deadline(Promise.race([probe.closed, injected]), 12000, 'probe_timeout');
    if (exited.code !== 0) throw new Error('probe_process_failed');
    for (const secret of ['fixture-only', 'fixture-key-pass', '123456', '654321', 'PRIVATE KEY']) {
      if (stdout.includes(secret) || stderr.includes(secret)) throw new Error('credential_leaked');
    }
    const control = stdout.trim().split('\n').map(x => JSON.parse(x));
    const result = control.find(x => x.outcome);
    // Stop the fixture after the client disconnects; child close drains IPC messages.
    await stop(fixture);
    return {
      outcome: result.outcome,
      stages: stderr.trim().split('\n'),
      authRequests: events.filter(x => x.type === 'authentication').length,
      authReleaseAttempts: events.filter(x => x.type === 'auth-release-attempted').length,
      authReleasedWhileOpen: events.find(x => x.type === 'auth-release-attempted')?.connectionOpen ?? false,
      successObservedAfterCancel: control.findIndex(x => x.stage === 'cancelled') >= 0 && control.findIndex(x => x.stage === 'late-auth-success-observed') > control.findIndex(x => x.stage === 'cancelled'),
      authReleasedBeforeClose: events.findIndex(x => x.type === 'auth-released') >= 0 && events.findIndex(x => x.type === 'closed') > events.findIndex(x => x.type === 'auth-released'),
      shellRequests: events.filter(x => x.type === 'shell').length,
      ptyRequests: events.filter(x => x.type === 'pty').length,
      receivedHex: events.some(x => x.type === 'received') ? [events.filter(x => x.type === 'received').map(x => x.hex).join('')] : [],
      sizes: events.filter(x => x.type === 'pty' || x.type === 'resize').map(x => [x.columns, x.rows]),
      authRounds: events.filter(x => x.type === 'auth-round').length, fixtureStopped: true, probeStopped: true,
    };
  } finally {
    const cleanups = await Promise.allSettled([...(probe ? [stop(probe)] : []), stop(fixture)]);
    const failed = cleanups.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
  }
}
