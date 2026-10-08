import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Adapter, data } from './stdio.mjs';
import { deadline } from '../helpers/process.mjs';
const missing = fileURLToPath(new URL(`../../../artifacts/phase3-missing-${process.pid}`, import.meta.url));
test('offline adapter initializes and exposes exactly five strict v2 tools', async t => {
  const adapter = new Adapter(missing); t.after(() => adapter.cleanup());
  const initialized = await adapter.initialize();
  assert.equal(initialized.protocolVersion, '2025-11-25');
  assert.match(initialized.instructions, /sudo -n/);
  const tools = (await adapter.request('tools/list', {})).tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['read_output', 'request_user_control', 'send_key', 'send_text', 'status']);
  for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tools.find(tool => tool.name === 'read_output').inputSchema.required, ['session_id', 'control_epoch', 'stream_id', 'cursor', 'limit', 'wait_ms']);
  assert.deepEqual(data(await adapter.tool('status')), { contract_version: 2, app_state: 'offline', app_instance_id: null, connection_id: null, sessions: [] });
  const result = await adapter.tool('send_text', { session_id: '1'.repeat(32), control_epoch: 1, request_id: '2'.repeat(32), text: 'NO EXECUTION' });
  assert.equal(result.isError, true); assert.equal(data(result).code, 'app_offline');
  assert.equal(await adapter.eof(), 0); assert.equal(adapter.stderr, '');
});
test('invalid or missing ownership parameters are JSON-RPC invalid_params', async t => {
  const adapter = new Adapter(missing); t.after(() => adapter.cleanup()); await adapter.initialize();
  for (const [name, args] of [ ['send_text', {}], ['status', { session_id: '1'.repeat(32) }], ['probe_wait', {}],
    ['send_key', { session_id: '1'.repeat(32), control_epoch: -1, request_id: '2'.repeat(32), key: 'Enter' }],
    ['send_text', { session_id: '1'.repeat(32), control_epoch: 1, request_id: '2'.repeat(32), text: 'x', method: 'status' }],
  ]) await assert.rejects(adapter.tool(name, args), error => error.code === -32602);
  assert.equal(await adapter.eof(), 0);
});
test('EOF before initialize exits without stdout contamination', async t => {
  const adapter = new Adapter(missing); t.after(() => adapter.cleanup()); assert.equal(await adapter.eof(), 0);
});
for (const terminated of [false, true]) {
  test(`oversized ${terminated ? 'terminated' : 'unterminated'} MCP line closes adapter without waiting for EOF`, async t => {
    const adapter = new Adapter(missing); t.after(() => adapter.cleanup()); await adapter.initialize();
    adapter.process.child.stdin.write(' '.repeat(262145) + (terminated ? '\n' : ''));
    const exit = await deadline(adapter.process.closed, 2000, 'oversized_line_not_rejected');
    assert.equal(exit.code, 0); assert.equal(adapter.stderr, '');
  });
}
test('MCP line at the size boundary works and the next frame starts a fresh budget', async t => {
  const adapter = new Adapter(missing); t.after(() => adapter.cleanup()); await adapter.initialize();
  const id = 10000, result = new Promise((resolve, reject) => adapter.pending.set(id, {resolve, reject}));
  const line = JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name:'status',arguments:{}}}).padEnd(262144, ' ');
  adapter.process.child.stdin.write(line + '\n');
  assert.equal(data(await deadline(result, 2000, 'boundary_line_rejected')).app_state, 'offline');
  assert.equal(data(await adapter.tool('status')).app_state, 'offline');
  assert.equal(await adapter.eof(), 0);
});
