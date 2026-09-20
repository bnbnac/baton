import test from 'node:test';
import assert from 'node:assert/strict';
import { McpClient, initializedClient } from './helpers/mcp-client.mjs';

test('stdio offline status and tools stay available without an app', async () => {
  const c = await initializedClient();
  try {
    const list = await c.request('tools/list', {});
    assert.deepEqual(list.tools.map(x => x.name).sort(), ['probe_wait','read_output','request_user_control','send_key','send_text','status']);
    const status = await c.request('tools/call', { name: 'status', arguments: {} });
    assert.deepEqual(JSON.parse(status.content.find(x => x.type === 'text').text), { contract_version: 2, app_state: 'offline', app_instance_id: null, connection_id: null, sessions: [] });
    assert.equal(c.isRunning, true);
    c.closeStdin(); assert.equal(await c.waitExit(3000), 0);
  } finally { await c.cleanup(); }
});

test('offline errors and unknown tool leave later status usable', async () => {
  const c = await initializedClient();
  try {
    for (const name of ['send_text', 'send_key', 'read_output', 'request_user_control']) {
      const response = await c.request('tools/call', { name, arguments: {} });
      assert.equal(response.isError, true);
      assert.equal(response.content[0].text, 'app_offline');
    }
    await assert.rejects(c.request('tools/call', { name: 'unknown', arguments: {} }), /rpc_/);
    assert.equal((await c.request('tools/call', { name: 'status', arguments: {} })).isError ?? false, false);
  } finally { await c.cleanup(); }
});

test('cancellation releases wait job and does not block concurrent status', async () => {
  const c = await initializedClient();
  try {
    const waiting = c.request('tools/call', { name: 'probe_wait', arguments: {} }, 40);
    const settled = waiting.then(() => 'resolved', e => e.message); // Attach rejection handler immediately.
    await c.waitNotification('notifications/message', 'probe_wait_started');
    await c.request('tools/call', { name: 'status', arguments: {} }, 41);
    c.notify('notifications/cancelled', { requestId: 40, reason: 'test' });
    await c.waitNotification('notifications/message', 'probe_wait_cancelled');
    assert.notEqual(await settled, 'request_timeout');
    await c.request('tools/call', { name: 'status', arguments: {} }, 42);
    assert.equal(c.isRunning, true);
  } finally { await c.cleanup(); }
});

test('EOF before initialize terminates the adapter', async () => {
  const c = McpClient.start();
  try { c.closeStdin(); assert.equal(await c.waitExit(3000), 0); }
  finally { await c.cleanup(); }
});

test('EOF while a tool waits terminates the adapter', async () => {
  const c = await initializedClient();
  try {
    const wait = c.request('tools/call', { name: 'probe_wait', arguments: {} }); wait.catch(() => {});
    await c.waitNotification('notifications/message', 'probe_wait_started');
    c.closeStdin(); assert.equal(await c.waitExit(3000), 0);
  } finally { await c.cleanup(); }
});
