import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
async function command(file, args) {
  const result = await exec(file, args, { windowsHide: true, timeout: 10000, maxBuffer: 262144 });
  return result.stdout.trim();
}
export async function recoverOwned(kind, manifest) {
  let owned;
  try { owned = JSON.parse(await readFile(manifest, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (kind === 'terminal') {
    await command('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('../../scripts/recover-terminal.ps1', import.meta.url)), '-Manifest', manifest]);
    return owned;
  }
  if (kind !== 'container' || !/^[a-f0-9]{32}$/.test(owned.label) || owned.name !== 'baton-rust-probe-' + owned.label || owned.tag !== 'baton-rust-probe:' + owned.label) throw new Error('invalid_container_identity');
  const found = await command('docker', ['ps', '--all', '--quiet', '--no-trunc', '--filter', 'name=^/' + owned.name + '$']);
  if (found) {
    if (!/^[a-f0-9]{64}$/.test(found) || (owned.id && owned.id !== found)) throw new Error('container_id_mismatch');
    const [actual] = JSON.parse(await command('docker', ['inspect', found]));
    if (actual.Id !== found || actual.Name !== '/' + owned.name || actual.Config.Labels['baton.rust-probe'] !== owned.label) throw new Error('container_identity_mismatch');
    await command('docker', ['rm', '--force', '--volumes', found]);
  }
  if (owned.imageId) {
    const image = await command('docker', ['image', 'ls', '--quiet', '--no-trunc', owned.tag]);
    if (image) {
      if (image !== owned.imageId) throw new Error('image_identity_mismatch');
      await command('docker', ['image', 'rm', owned.tag]);
    }
  }
  const remaining = await command('docker', ['ps', '--all', '--quiet', '--filter', 'label=baton.rust-probe=' + owned.label]);
  if (remaining) throw new Error('container_recovery_failed');
  return owned;
}
