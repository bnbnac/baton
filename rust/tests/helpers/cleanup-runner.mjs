import { runSshCase } from './ssh-case.mjs';
import { initializedClient } from './mcp-client.mjs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir } from 'node:fs/promises';
import { deadline, observe, stop } from './process.mjs';
import { recoverOwned } from './recover-owned.mjs';
const stage = process.argv[2];
try {
  if (['terminal-wait', 'container-ready', 'terminal-runner-timeout', 'container-runner-timeout'].includes(stage)) {
    const kind = stage.startsWith('terminal-') ? 'terminal' : 'container';
    const timed = stage.endsWith('runner-timeout');
    // Resolve from repository, not caller's current directory.
    const repo = new URL('../../../', import.meta.url);
    const evidenceDir = new URL('.superpowers/sdd/2026-09-20-rust-phase-0/', repo);
    await mkdir(evidenceDir, { recursive: true });
    const evidence = fileURLToPath(new URL('cleanup-' + randomUUID() + '.json', evidenceDir));
    const script = new URL(kind === 'terminal' ? '../../scripts/test-terminal.ps1' : '../../scripts/test-openssh.ps1', import.meta.url);
    const child = observe(spawn('pwsh', ['-NoProfile', '-File', fileURLToPath(script), timed ? '-StallAfterReady' : '-InjectFailure', kind === 'terminal' ? '-ReportPath' : '-CleanupReport', evidence], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    const manifest = evidence + '.owned.json';
    process.send?.({ type: 'resource', kind, manifest });
    process.send?.({ type: 'owned', pid: child.child.pid, role: 'powershell-runner' });
    child.child.stdout.resume(); child.child.stderr.resume();
    let failure, recovered;
    try {
      if (timed) {
        const barrier = async () => {
          for (;;) {
            try { await readFile(evidence + '.barrier'); return; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (child.child.exitCode !== null || child.child.signalCode !== null) throw new Error('exited_before_barrier');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        };
        await deadline(barrier(), 15000, 'barrier_timeout');
      }
      const exit = await deadline(child.closed, timed ? 200 : 35000, 'injection_timeout');
      if (exit.code !== 1) throw new Error('wrong_injection_exit');
      if (kind === 'terminal') {
        const result = JSON.parse(await readFile(evidence, 'utf8'));
        const cleanup = JSON.parse(await readFile(evidence + '.cleanup.json', 'utf8'));
        if (result[0].name !== 'output_wait_ready' || !result[0].passed || !cleanup.exited) throw new Error('terminal_cleanup_unverified');
        process.send?.({ type: 'owned', pid: cleanup.pid, role: 'terminal-probe' });
      } else {
        const cleanup = JSON.parse(await readFile(evidence, 'utf8'));
        if (cleanup.remaining !== 0) throw new Error('container_cleanup_unverified');
      }
      throw new Error('injected_' + stage);
    } catch (error) { failure = error; }
    finally {
      // Killing only PowerShell cannot run its finally. The parent owns recovery.
      try { await stop(child); } catch { /* Retry exit observation after resource recovery. */ }
      recovered = await recoverOwned(kind, manifest);
      await deadline(child.closed, 3000, 'runner_did_not_exit_after_recovery');
    }
    if (timed && failure?.message === 'injection_timeout') {
      if (!recovered) throw new Error('missing_owned_resource');
      if (kind === 'terminal') process.send?.({ type: 'owned', pid: recovered.pid, role: 'terminal-probe' });
      throw new Error('injected_' + stage);
    }
    throw failure ?? new Error('injection_did_not_fail');
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
