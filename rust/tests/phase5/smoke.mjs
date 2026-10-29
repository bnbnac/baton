import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Adapter, data } from '../phase3/stdio.mjs';
import { verifyPackage } from './package.mjs';
import { reserveReport } from './report-path.mjs';

const [directoryArg, reportArg] = process.argv.slice(2);
if (!directoryArg || !reportArg || process.platform !== 'win32') throw Error('usage: smoke.mjs <extracted-package> <report.json> (Windows only)');
const directory = resolve(directoryArg), reportPath = resolve(reportArg);
const manifest = await verifyPackage(directory);
const reportFile = await reserveReport(directory, reportPath);
const report = { status: 'failed', startedUtc: new Date().toISOString(), executable: join(directory, 'baton-adapter.exe'), executableSha256: manifest.files['baton-adapter.exe'].sha256, guiAcceptance: 'pending', cleanMachineAcceptance: 'pending' };
const windows = process.env.SystemRoot;
let adapter, scratch;
try {
  scratch = await mkdtemp(join(directory, '..', 'smoke-'));
  assert.ok(windows);
  adapter = new Adapter(join(scratch, 'missing-endpoint'), { executable: report.executable, cwd: scratch, env: { PATH: `${windows}\\System32;${windows}` } });
  const initialized = await adapter.initialize();
  assert.equal(initialized.protocolVersion, '2025-11-25');
  const tools = (await adapter.request('tools/list', {})).tools;
  assert.deepEqual(tools.map(item => item.name).sort(), ['read_output', 'request_user_control', 'send_key', 'send_text', 'status']);
  assert.equal(data(await adapter.tool('status')).app_state, 'offline');
  const input = await adapter.tool('send_text', { session_id: '1'.repeat(32), control_epoch: 1, request_id: '2'.repeat(32), text: 'MUST_NOT_EXECUTE' });
  assert.equal(input.isError, true); assert.equal(data(input).code, 'app_offline');
  assert.equal(await adapter.eof(), 0); assert.equal(adapter.stderr, '');
  report.status = 'adapter_smoke_passed_gui_pending';
  report.checks = ['initialize', 'five_tools', 'offline_status', 'offline_input_rejected', 'eof_exit_zero', 'clean_stdio', 'windows_only_path'];
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  try { await adapter?.cleanup(); if (scratch) await rm(scratch, { recursive: true, force: true }); report.cleanup = 'passed'; }
  catch (error) { report.cleanup = String(error); report.status = 'failed'; process.exitCode = 1; }
  report.finishedUtc = new Date().toISOString();
  try { await reportFile.writeFile(JSON.stringify(report, null, 2) + '\n'); }
  finally { await reportFile.close(); }
}
console.log(JSON.stringify(report));
