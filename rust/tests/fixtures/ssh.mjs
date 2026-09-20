import ssh2 from 'ssh2';
import { createHash } from 'node:crypto';
const { Server, utils } = ssh2;
const hostKey = utils.generateKeyPairSync('ed25519');
const parsed = utils.parseKey(hostKey.private);
const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
const clients = new Set();
const emit = (type, data = {}) => process.send?.({ type, ...data });
const server = new Server({ hostKeys: [hostKey.private] }, client => {
  clients.add(client);
  client.on('error', () => {});
  client.on('close', () => { clients.delete(client); emit('closed'); });
  client.on('authentication', ctx => {
    emit('authentication', { method: ctx.method });
    if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'fixture-only') ctx.accept();
    else ctx.reject(['password']);
  });
  client.on('ready', () => client.on('session', accept => {
    const session = accept();
    session.on('pty', (accept, reject, info) => {
      emit('pty', { columns: info.cols, rows: info.rows }); accept();
    });
    session.on('window-change', (accept, reject, info) => {
      emit('resize', { columns: info.cols, rows: info.rows }); accept?.();
    });
    session.on('shell', accept => {
      emit('shell');
      const stream = accept();
      stream.write('READY\r\n');
      stream.on('data', data => { emit('received', { hex: data.toString('hex') }); stream.write(data); });
    });
  }));
});
function stop() {
  for (const c of clients) c.destroy();
  server.close(() => { process.disconnect?.(); });
}
process.on('message', message => { if (message.type === 'stop') stop(); });
process.on('disconnect', () => { for (const c of clients) c.destroy(); server.close(); });
server.listen(0, '127.0.0.1', () => emit('ready', { port: server.address().port, fingerprint }));
