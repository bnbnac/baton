import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deadline, observe, stop } from './process.mjs';

export class McpClient {
  static start(exe = fileURLToPath(new URL('../../target/debug/baton-mcp-probe.exe', import.meta.url))) { return new McpClient(exe); }
  constructor(exe) {
    this.handle = observe(spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }));
    this.nextId = 1; this.pending = new Map(); this.cancelled = new Set(); this.notifications = []; this.watchers = new Set(); this.failure = null;
    let buffered = '';
    this.handle.child.stdout.setEncoding('utf8');
    this.handle.child.stdout.on('data', chunk => {
      buffered += chunk;
      if (Buffer.byteLength(buffered) > 262144) return this.fail(new Error('stdout_frame_limit'));
      while (buffered.includes('\n')) {
        const end = buffered.indexOf('\n'); const line = buffered.slice(0, end); buffered = buffered.slice(end + 1);
        try {
          const message = JSON.parse(line);
          if (message.jsonrpc !== '2.0') throw new Error('not_json_rpc');
          if ('id' in message) {
            const waiter = this.pending.get(message.id);
            if (!waiter && this.cancelled.has(message.id)) continue;
            if (!waiter) throw new Error('unexpected_response_id');
            this.pending.delete(message.id);
            message.error ? waiter.reject(new Error('rpc_' + message.error.code)) : waiter.resolve(message.result);
          } else {
            if (this.notifications.length >= 64) throw new Error('notification_limit');
            this.notifications.push(message);
            for (const wake of this.watchers) wake();
          }
        } catch (error) { this.fail(error); }
      }
    });
    this.handle.child.stderr.resume();
    this.handle.child.stdin.on('error', error => this.fail(error));
    this.handle.closed.then(() => {
      if (buffered.trim()) this.fail(new Error('incomplete_stdout_frame'));
      for (const p of this.pending.values()) p.reject(new Error('server_closed'));
      this.pending.clear();
    }, error => this.fail(error));
  }
  fail(error) { this.failure ??= error; for (const p of this.pending.values()) p.reject(error); this.pending.clear(); }
  get isRunning() { return this.handle.child.exitCode === null && this.handle.child.signalCode === null; }
  request(method, params, explicitId) {
    if (this.failure) return Promise.reject(this.failure);
    if (this.pending.size >= 16) return Promise.reject(new Error('pending_limit'));
    const id = explicitId ?? this.nextId++;
    if (this.pending.has(id)) return Promise.reject(new Error('duplicate_id'));
    const promise = new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); });
    this.handle.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const result = deadline(promise, 5000, 'request_timeout'); result.catch(() => {}); return result;
  }
  notify(method, params) {
    if (method === 'notifications/cancelled') {
      const waiter = this.pending.get(params.requestId);
      if (waiter) { this.pending.delete(params.requestId); this.cancelled.add(params.requestId); waiter.reject(new Error('client_cancelled')); }
    }
    this.handle.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async waitNotification(method, data) {
    let wake;
    const waiting = new Promise(resolve => {
      wake = () => {
        const i = this.notifications.findIndex(n => n.method === method && n.params.data === data);
        if (i >= 0) resolve(this.notifications.splice(i, 1)[0]);
      };
      this.watchers.add(wake); wake();
    });
    try { return await deadline(waiting, 5000, 'notification_timeout'); }
    finally { this.watchers.delete(wake); }
  }
  closeStdin() { this.handle.child.stdin.end(); }
  async waitExit(ms) { const result = await deadline(this.handle.closed, ms, 'exit_timeout'); if (this.failure) throw this.failure; return result.code; }
  async cleanup() { await stop(this.handle); }
}

export async function initializedClient() {
  const client = McpClient.start();
  try {
  const result = await client.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'baton-phase0', version: '0.1.0' } });
  if (result.protocolVersion !== '2025-11-25') { await client.cleanup(); throw new Error('protocol_mismatch'); }
  client.notify('notifications/initialized', {});
  return client;
  } catch (error) { await client.cleanup(); throw error; }
}
