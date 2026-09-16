// Runs an installed native Codex app-server with an isolated test configuration.
// No model turn, user config edit, or authentication is performed.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';

const [codex, adapter, endpoint] = process.argv.slice(2);
if (!codex || !adapter || !endpoint) throw new Error('Usage: node scripts/test-codex-mcp.mjs <codex.exe> <adapter.exe> <running-app-endpoint-directory>');
const artifacts = resolve('artifacts');
await mkdir(artifacts, { recursive: true });
const testHome = await mkdtemp(join(artifacts, 'codex-smoke-'));
const tomlLiteral = value => { if (value.includes("'") || /[\r\n]/.test(value)) throw new Error('Unsupported path'); return `'${value}'`; };
await writeFile(join(testHome, 'config.toml'), `[mcp_servers.baton]\ncommand = ${tomlLiteral(resolve(adapter))}\nargs = ["--label", "Codex native smoke", "--endpoint-dir", ${tomlLiteral(resolve(endpoint))}]\nstartup_timeout_sec = 15\n`);
const child = spawn(codex, ['app-server'], { env: { ...process.env, CODEX_HOME: testHome }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const pending = new Map();
let sequence = 0;
child.stderr.on('data', () => {}); // Do not persist native harness diagnostics.
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  let message; try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id);
  if (waiter) { pending.delete(message.id); message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
});
child.on('exit', code => { for (const waiter of pending.values()) waiter.reject(new Error(`Codex exited: ${code}`)); pending.clear(); });
child.on('error', error => { for (const waiter of pending.values()) waiter.reject(error); pending.clear(); });
function request(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
try {
  const initialized = await request('initialize', { clientInfo: { name: 'baton-verification', version: '0.1.0' } });
  child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const catalog = await request('mcpServerStatus/list', { detail: 'toolsAndAuthOnly' });
  const server = catalog.data.find(item => item.name === 'baton');
  assert.ok(server, 'Baton must appear in native Codex catalog');
  assert.equal(server.toolsError ?? null, null);
  const names = Object.values(server.tools).map(tool => tool.name).sort();
  assert.deepEqual(names, ['read_output', 'send_key', 'send_text', 'status']);
  console.log(JSON.stringify({ passed: true, nativeCodex: initialized.userAgent ?? 'app-server', tools: names, modelTurnStarted: false }));
} finally {
  child.stdin.end();
  const cleanupTimer = setTimeout(() => child.kill(), 3000);
  cleanupTimer.unref();
  lines.close();
}
