import { once } from 'node:events';

export async function deadline(promise, ms, name) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(name)), ms); })]); }
  finally { clearTimeout(timer); }
}

export function observe(child) {
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  // Keep a handler installed even when failure precedes caller awaiting it.
  closed.catch(() => {});
  return { child, closed };
}

export async function stop(handle) {
  const { child, closed } = handle;
  if (child.exitCode === null && child.signalCode === null) {
    if (child.connected) child.send({ type: 'stop' });
    else child.stdin?.end();
    try { await deadline(closed, 1500, 'cleanup_timeout'); }
    catch { child.kill(); }
  }
  await deadline(closed, 3000, 'child_did_not_exit');
}

export { once };
