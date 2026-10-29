import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reserveReport } from './report-path.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'baton-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageDir = join(root, 'package'); await mkdir(packageDir);
  return { root, packageDir };
}
test('new report outside package is reserved once', async t => {
  const { root, packageDir } = await fixture(t), path = join(root, 'report.json');
  const handle = await reserveReport(packageDir, path);
  await handle.writeFile('evidence'); await handle.close();
  await assert.rejects(reserveReport(packageDir, path));
  assert.equal(await readFile(path, 'utf8'), 'evidence');
});
test('report cannot overwrite payload or create extra package files', async t => {
  const { packageDir } = await fixture(t), path = join(packageDir, 'baton.exe');
  await writeFile(path, 'payload');
  await assert.rejects(reserveReport(packageDir, path));
  await assert.rejects(reserveReport(packageDir, join(packageDir, 'new-report.json')));
  assert.equal(await readFile(path, 'utf8'), 'payload');
});
test('report parent alias into package is rejected', async t => {
  const { root, packageDir } = await fixture(t), alias = join(root, 'alias');
  await symlink(packageDir, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(reserveReport(packageDir, join(alias, 'report.json')));
});
