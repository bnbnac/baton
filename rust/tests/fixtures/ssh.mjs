import ssh2 from 'ssh2';
import { createHash } from 'node:crypto';
const { Server, utils } = ssh2;
const caseName = process.argv[2];
const hostKey = utils.generateKeyPairSync('ed25519');
const userKey = caseName?.includes('key') ? utils.generateKeyPairSync('ed25519', { cipher: 'aes256-ctr', passphrase: 'fixture-key-pass' }) : null;
const publicKey = userKey ? utils.parseKey(userKey.private, 'fixture-key-pass') : null;
let releaseAuth;
const parsed = utils.parseKey(hostKey.private);
const fingerprint = 'SHA256:' + createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '');
const clients = new Set();
const emit = (type, data = {}) => process.send?.({ type, ...data });
const server = new Server({ hostKeys: [hostKey.private] }, client => {
  let connectionClosed = false;
  clients.add(client);
  client.on('error', () => {});
  client.on('close', () => { connectionClosed = true; clients.delete(client); emit('closed'); });
  client.on('authentication', ctx => {
    emit('authentication', { method: ctx.method });
    if (ctx.method === 'password' && ctx.username === 'fixture' && ctx.password === 'fixture-only') {
      if (caseName === 'password-then-interactive') ctx.reject(['keyboard-interactive'], true);
      else if (caseName === 'cancel-late-success') {
        releaseAuth = () => { emit('auth-release-attempted', { connectionOpen: !connectionClosed }); ctx.accept(); };
        emit('auth-held');
      }
      else ctx.accept();
    } else if (ctx.method === 'publickey' && publicKey && ctx.key.data.equals(publicKey.getPublicSSH())) {
      if (!ctx.signature || publicKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo)) ctx.accept();
      else ctx.reject();
    } else if (ctx.method === 'keyboard-interactive') {
      emit('auth-round');
      ctx.prompt([{ prompt: 'First fixture OTP:', echo: false }], first => {
        if (first[0] !== '123456') return ctx.reject();
        emit('auth-round');
        ctx.prompt([{ prompt: 'Second fixture OTP:', echo: false }], second => second[0] === '654321' ? ctx.accept() : ctx.reject());
      });
    } else ctx.reject(['password', 'publickey', 'keyboard-interactive']);
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
process.on('message', message => {
  if (message.type === 'stop') stop();
  if (message.type === 'release-auth') { releaseAuth?.(); emit('auth-released'); }
});
process.on('disconnect', () => { for (const c of clients) c.destroy(); server.close(); });
server.listen(0, '127.0.0.1', () => emit('ready', { port: server.address().port, fingerprint, privateKey: userKey?.private }));
