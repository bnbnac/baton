import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const payload = ['README.txt', 'baton-adapter.exe', 'baton.exe'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function check(value, message) { if (!value) throw Error(message); }
function keys(object, expected) {
  check(object && typeof object === 'object' && !Array.isArray(object), 'invalid_object');
  check(JSON.stringify(Object.keys(object).sort()) === JSON.stringify([...expected].sort()), 'unexpected_fields');
}
function pe(bytes, subsystem) {
  check(bytes.length >= 64 && bytes.toString('ascii', 0, 2) === 'MZ', 'invalid_pe');
  const offset = bytes.readUInt32LE(60);
  check(offset >= 64 && offset + 24 <= bytes.length && bytes.toString('ascii', offset, offset + 4) === 'PE\0\0', 'invalid_pe');
  const size = bytes.readUInt16LE(offset + 20), flags = bytes.readUInt16LE(offset + 22);
  check(size >= 70 && offset + 24 + size <= bytes.length, 'invalid_optional_header');
  check(bytes.readUInt16LE(offset + 4) === 0x8664 && bytes.readUInt16LE(offset + 24) === 0x20b, 'not_windows_x64');
  check((flags & 2) !== 0 && (flags & 0x2000) === 0, 'not_executable');
  check(bytes.readUInt16LE(offset + 24 + 68) === subsystem, 'wrong_subsystem');
  return { machine: 0x8664, subsystem };
}
async function inventory(directory, manifestExists) {
  const root = await lstat(directory);
  check(root.isDirectory() && !root.isSymbolicLink(), 'invalid_package_directory');
  const names = (await readdir(directory)).sort();
  check(JSON.stringify(names) === JSON.stringify([...payload, ...(manifestExists ? ['manifest.json'] : [])].sort()), 'unexpected_package_files');
  const files = {};
  for (const name of names) {
    const path = join(directory, name), stat = await lstat(path);
    check(stat.isFile() && !stat.isSymbolicLink(), 'non_regular_package_file');
    if (name === 'manifest.json') continue;
    const bytes = await readFile(path);
    files[name] = { bytes: bytes.length, sha256: hash(bytes) };
    if (name.endsWith('.exe')) files[name].pe = pe(bytes, name === 'baton.exe' ? 2 : 3);
  }
  return files;
}
function validateProvenance(provenance) {
  keys(provenance, ['commit', 'sourceSha256']);
  check(/^[a-f0-9]{40}$/.test(provenance.commit) && /^[a-f0-9]{64}$/.test(provenance.sourceSha256), 'invalid_provenance');
}
export async function createManifest(directory, provenance) {
  validateProvenance(provenance);
  const files = await inventory(directory, false);
  const manifest = { schemaVersion: 1, status: 'candidate_unaccepted', platform: 'windows-x86_64', provenance, files };
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}
export async function verifyPackage(directory) {
  const files = await inventory(directory, true);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  keys(manifest, ['schemaVersion', 'status', 'platform', 'provenance', 'files']);
  check(manifest.schemaVersion === 1 && manifest.status === 'candidate_unaccepted' && manifest.platform === 'windows-x86_64', 'invalid_manifest');
  validateProvenance(manifest.provenance);
  keys(manifest.files, payload);
  for (const name of payload) {
    keys(manifest.files[name], Object.keys(files[name]));
    check(manifest.files[name].bytes === files[name].bytes && manifest.files[name].sha256 === files[name].sha256, 'payload_hash_mismatch');
    if (files[name].pe) {
      keys(manifest.files[name].pe, ['machine', 'subsystem']);
      check(manifest.files[name].pe.machine === files[name].pe.machine && manifest.files[name].pe.subsystem === files[name].pe.subsystem, 'pe_manifest_mismatch');
    }
  }
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, directory, provenancePath] = process.argv.slice(2);
  if (command === 'create') await createManifest(directory, JSON.parse((await readFile(provenancePath, 'utf8')).replace(/^\uFEFF/, '')));
  else if (command === 'verify') await verifyPackage(directory);
  else throw Error('usage: package.mjs create <directory> <provenance.json> | verify <directory>');
  console.log('PACKAGE_VERIFIED');
}
