import { fork, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deadline, observe, stop } from './process.mjs';

export async function runSshCase(name) {
  const fixture = observe(fork(fileURLToPath(new URL('../fixtures/ssh.mjs', import.meta.url)), [], { silent: true, windowsHide: true }));
  const events = [];
  let probe;
  let stdout = '', stderr = '';
  try {
    const ready = await deadline(new Promise((resolve, reject) => {
      fixture.child.on('message', m => { events.push(m); if (m.type === 'ready') resolve(m); });
      fixture.child.once('error', reject);
      fixture.closed.then(() => reject(new Error('fixture_exited_before_ready')));
    }), 5000, 'fixture_not_ready');
    probe = observe(spawn(fileURLToPath(new URL('../../target/debug/baton-ssh-probe.exe', import.meta.url)), [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    probe.child.stdout.on('data', b => { stdout += b; if (stdout.length > 65536) probe.child.kill(); });
    probe.child.stderr.on('data', b => { stderr += b; if (stderr.length > 65536) probe.child.kill(); });
    probe.child.stdin.on('error', () => {});
    probe.child.stdin.end(JSON.stringify({ case: name, host: '127.0.0.1', port: ready.port, hostFingerprint: ready.fingerprint, credential: { username: 'fixture', password: 'fixture-only' } }) + '\n');
    const exited = await deadline(probe.closed, 12000, 'probe_timeout');
    if (exited.code !== 0) throw new Error('probe_process_failed');
    if (stdout.includes('fixture-only') || stderr.includes('fixture-only')) throw new Error('credential_leaked');
    const result = JSON.parse(stdout.trim());
    // Stop the fixture after the client disconnects; child close drains IPC messages.
    await stop(fixture);
    return {
      outcome: result.outcome,
      stages: stderr.trim().split('\n'),
      authRequests: events.filter(x => x.type === 'authentication').length,
      shellRequests: events.filter(x => x.type === 'shell').length,
      ptyRequests: events.filter(x => x.type === 'pty').length,
      receivedHex: events.some(x => x.type === 'received') ? [events.filter(x => x.type === 'received').map(x => x.hex).join('')] : [],
      sizes: events.filter(x => x.type === 'pty' || x.type === 'resize').map(x => [x.columns, x.rows]),
      authRounds: 0, fixtureStopped: true, probeStopped: true,
    };
  } finally {
    if (probe) await stop(probe);
    await stop(fixture);
  }
}
