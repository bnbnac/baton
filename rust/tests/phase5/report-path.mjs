import { open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
export async function reserveReport(directory, path) {
  const root = await realpath(directory), absolute = resolve(path);
  const parent = await realpath(dirname(absolute));
  const relation = relative(root, parent);
  if (relation === '' || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith('..\\') && !relation.startsWith('../'))) {
    throw Error('report_must_be_outside_package');
  }
  return open(join(parent, basename(absolute)), 'wx');
}
