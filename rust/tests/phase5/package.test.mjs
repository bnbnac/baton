import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest, verifyPackage } from './package.mjs';

function pe(subsystem) {
  const bytes = Buffer.alloc(256);
  bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64);
  bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(128, 84);
  bytes.writeUInt16LE(2, 86); bytes.writeUInt16LE(0x20b, 88);
  bytes.writeUInt16LE(subsystem, 156); return bytes;
}
const provenance = { commit: 'a'.repeat(40), sourceSha256: 'b'.repeat(64) };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'baton-package-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'baton.exe'), pe(2));
  await writeFile(join(dir, 'baton-adapter.exe'), pe(3));
  await writeFile(join(dir, 'README.txt'), 'Unaccepted candidate. WebView2 required.');
  return dir;
}
test('candidate records exact payload hashes and Windows executable types', async t => {
  const dir = await fixture(t), manifest = await createManifest(dir, provenance);
  assert.equal(manifest.status, 'candidate_unaccepted');
  assert.equal(manifest.files['baton.exe'].pe.subsystem, 2);
  assert.equal(manifest.files['baton-adapter.exe'].pe.subsystem, 3);
  assert.deepEqual(await verifyPackage(dir), manifest);
  await assert.rejects(createManifest(dir, provenance));
});
for (const kind of ['tamper', 'missing', 'extra', 'bad_pe', 'arm', 'wrong_subsystem', 'bad_manifest', 'path_escape']) {
  test(`rejects ${kind}`, async t => {
    const dir = await fixture(t);
    await createManifest(dir, provenance);
    if (kind === 'tamper') await writeFile(join(dir, 'README.txt'), 'changed');
    if (kind === 'missing') await unlink(join(dir, 'baton.exe'));
    if (kind === 'extra') await writeFile(join(dir, 'acceptance.exe'), pe(2));
    if (['bad_pe', 'arm', 'wrong_subsystem'].includes(kind)) {
      const bytes = kind === 'bad_pe' ? Buffer.from('MZ') : pe(kind === 'wrong_subsystem' ? 3 : 2);
      if (kind === 'arm') bytes.writeUInt16LE(0xaa64, 68);
      await unlink(join(dir, 'manifest.json'));
      await writeFile(join(dir, 'baton.exe'), bytes);
      await assert.rejects(createManifest(dir, provenance)); return;
    }
    if (['bad_manifest', 'path_escape'].includes(kind)) {
      const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
      if (kind === 'bad_manifest') manifest.status = 'release_approved';
      else manifest.files['../outside'] = manifest.files['baton.exe'];
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
    }
    await assert.rejects(verifyPackage(dir));
  });
}
