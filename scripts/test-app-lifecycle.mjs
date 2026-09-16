// Verifies published app/adapter process lifetimes without SSH credentials.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, stat, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const appPath = resolve('artifacts/Baton/app/Baton.exe');
const adapterPath = resolve('artifacts/Baton/adapter/Baton.Adapter.exe');
await mkdir(resolve('artifacts'), { recursive: true });
const endpoint = await mkdtemp(join(resolve('artifacts'), 'lifecycle-'));
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition, description) {
  for (let i = 0; i < 100; i++) { if (await condition()) return; await delay(100); }
  throw new Error(`Timed out: ${description}`);
}
function start(path, args) {
  const process = spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  process.stderr.on('data', () => {});
  children.push(process);
  return process;
}
async function initializeAdapter() {
  const adapter = start(adapterPath, ['--label', 'Lifecycle verification', '--endpoint-dir', endpoint]);
  const lines = createInterface({ input: adapter.stdout });
  let initialized;
  lines.on('line', line => { const message = JSON.parse(line); if (message.id === 1) initialized = message; });
  adapter.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'baton-lifecycle-test', version: '1' } } }) + '\n');
  await until(() => initialized !== undefined || adapter.exitCode !== null, 'adapter initialize');
  assert.ok(initialized?.result, 'Published adapter must initialize');
  return adapter;
}
try {
  const app = start(appPath, ['--endpoint-dir', endpoint]);
  const discovery = join(endpoint, 'endpoint.bin');
  await until(async () => { try { return (await stat(discovery)).size > 0; } catch { return false; } }, 'app endpoint');
  const firstDiscovery = await readFile(discovery);
  const adapter = await initializeAdapter();
  app.kill();
  await until(() => app.exitCode !== null || app.signalCode !== null, 'app crash');
  await until(() => adapter.exitCode !== null || adapter.signalCode !== null, 'adapter exits after app crash');

  const restarted = start(appPath, ['--endpoint-dir', endpoint]);
  await until(async () => { try { return !firstDiscovery.equals(await readFile(discovery)); } catch { return false; } }, 'fresh discovery on restart');
  const nextAdapter = await initializeAdapter();
  assert.notEqual(restarted.pid, app.pid);
  nextAdapter.stdin.end();
  await until(() => nextAdapter.exitCode !== null, 'adapter EOF');
  assert.equal(nextAdapter.exitCode, 0);
  console.log(JSON.stringify({ passed: true, appCrashStopsAdapter: true, appRestartCreatesFreshEndpoint: true, adapterEofExitCode: nextAdapter.exitCode }));
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill();
  for (const child of children) await until(() => child.exitCode !== null || child.signalCode !== null, 'owned process cleanup');
}
