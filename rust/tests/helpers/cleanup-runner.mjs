import { runSshCase } from './ssh-case.mjs';
import { initializedClient } from './mcp-client.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import { deadline, observe, stop } from './process.mjs';
const stage = process.argv[2];
try {
  if (stage === 'terminal-wait' || stage === 'container-ready') {
    // Resolve from repository, not caller's current directory.
    const repo = new URL('../../../', import.meta.url);
    const evidenceDir = new URL('.superpowers/sdd/2026-09-20-rust-phase-0/', repo);
    await mkdir(evidenceDir, { recursive: true });
    const evidence = fileURLToPath(new URL('cleanup-' + randomUUID() + '.json', evidenceDir));
    const script = new URL(stage === 'terminal-wait' ? '../../scripts/test-terminal.ps1' : '../../scripts/test-openssh.ps1', import.meta.url);
    const child = observe(spawn('pwsh', ['-NoProfile', '-File', fileURLToPath(script), '-InjectFailure', stage === 'terminal-wait' ? '-ReportPath' : '-CleanupReport', evidence], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    process.send?.({ type: 'owned', pid: child.child.pid, role: 'powershell-runner' });
    child.child.stdout.resume(); child.child.stderr.resume();
    try {
      const exit = await deadline(child.closed, 35000, 'injection_timeout');
      if (exit.code !== 1) throw new Error('wrong_injection_exit');
      if (stage === 'terminal-wait') {
        const result = JSON.parse(await readFile(evidence, 'utf8'));
        const cleanup = JSON.parse(await readFile(evidence + '.cleanup.json', 'utf8'));
        if (result[0].name !== 'output_wait_ready' || !result[0].passed || !cleanup.exited) throw new Error('terminal_cleanup_unverified');
        process.send?.({ type: 'owned', pid: cleanup.pid, role: 'terminal-probe' });
      } else {
        const cleanup = JSON.parse(await readFile(evidence, 'utf8'));
        if (cleanup.remaining !== 0) throw new Error('container_cleanup_unverified');
        const remaining = execFileSync('docker', ['ps', '--all', '--quiet', '--filter', 'label=baton.rust-probe=' + cleanup.label], { encoding: 'utf8', windowsHide: true });
        if (remaining.trim()) throw new Error('container_still_exists');
      }
      throw new Error('injected_' + stage);
    } finally { await stop(child); }
  } else if (stage === 'mcp-wait') {
    const client = await initializedClient();
    process.send?.({ type: 'owned', pid: client.handle.child.pid, role: 'mcp-probe' });
    try {
      client.request('tools/call', { name: 'probe_wait', arguments: {} }).catch(() => {});
      await client.waitNotification('notifications/message', 'probe_wait_started');
      throw new Error('injected_mcp-wait');
    } finally { await client.cleanup(); }
  } else await runSshCase(stage === 'auth-held' ? 'cancel-late-success' : 'password-pty', {
    injectFailure: stage,
    onSpawn: (handle, role) => process.send?.({ type: 'owned', pid: handle.child.pid, role }),
  });
  process.exitCode = 0;
} catch (error) {
  process.send?.({ type: 'failure', code: error.message }); process.exitCode = 1;
} finally { process.disconnect?.(); }
