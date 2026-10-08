import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { observe, deadline, stop } from '../helpers/process.mjs';
export class Adapter {
  constructor(endpoint) {
    this.process = observe(spawn(fileURLToPath(new URL('../../target/debug/baton-adapter.exe', import.meta.url)), [], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, BATON_RUST_ENDPOINT_DIR: endpoint },
    }));
    this.next = 1; this.pending = new Map(); this.failure = null; this.stderr = '';
    let buffer = '';
    this.process.child.stdout.setEncoding('utf8');
    this.process.child.stdout.on('data', chunk => {
      buffer += chunk;
      try {
        while (buffer.includes('\n')) {
          const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (Buffer.byteLength(line) > 262144) throw Error('oversized_mcp_frame');
          const message = JSON.parse(line);
          if (message.jsonrpc !== '2.0') throw Error('stdout_contamination');
          if ('id' in message) {
            const pending = this.pending.get(message.id);
            if (!pending) continue; // A cancelled request can finish concurrently.
            this.pending.delete(message.id);
            message.error ? pending.reject(Object.assign(Error('rpc_error'), message.error)) : pending.resolve(message.result);
          }
        }
        if (Buffer.byteLength(buffer) > 262144) throw Error('oversized_mcp_frame');
      } catch (error) { this.fail(error); }
    });
    this.process.child.stderr.setEncoding('utf8');
    this.process.child.stderr.on('data', data => { this.stderr += data; });
    this.process.child.stdin.on('error', error => this.fail(error));
    this.process.closed.then(() => {
      if (buffer.trim()) this.fail(Error('partial_stdout_frame'));
      for (const waiter of this.pending.values()) waiter.reject(Error('adapter_closed'));
      this.pending.clear();
    }, error => this.fail(error));
  }
  fail(error) { this.failure ??= error; for (const waiter of this.pending.values()) waiter.reject(error); this.pending.clear(); }
  request(method, params, id = this.next++) {
    if (this.failure) return Promise.reject(this.failure);
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.process.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    const result = deadline(promise, 5000, 'mcp_timeout'); result.catch(() => {}); return result;
  }
  notify(method, params) { this.process.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
  async initialize() {
    const result = await this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'baton-test', version: '0.1' } });
    this.notify('notifications/initialized', {}); return result;
  }
  tool(name, args = {}, id) { return this.request('tools/call', { name, arguments: args }, id); }
  async eof() { this.process.child.stdin.end(); const exit = await deadline(this.process.closed, 2000, 'eof_timeout'); if (this.failure) throw this.failure; return exit.code; }
  async cleanup() { await stop(this.process); }
}
export function data(result) { return JSON.parse(result.content[0].text); }
