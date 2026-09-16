// Controlled SSH protocol fixture, NOT a Linux/OpenSSH integration test.
// Host key is generated in memory; no terminal transcript or credential is written.
import { generateKeyPairSync } from 'node:crypto';
import ssh2 from 'ssh2';
const { Server } = ssh2;
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({type:'pkcs1',format:'pem'});
const server = new Server({hostKeys:[key]}, client => {
  client.on('error', () => {});
  client.on('authentication', ctx => {
    if (ctx.method === 'password' && ctx.password === 'fixture-only') {
      if (ctx.username === 'fixture-mfa') ctx.reject(['keyboard-interactive'], true);
      else if (ctx.username === 'fixture') ctx.accept();
      else ctx.reject();
    }
    else if (ctx.method === 'publickey' && ctx.username === 'fixture') {
      const parsed = ssh2.utils.parseKey(ctx.key.data);
      if (!ctx.signature || (!(parsed instanceof Error) && parsed.verify(ctx.blob,ctx.signature,ctx.hashAlgo))) ctx.accept();
      else ctx.reject();
    }
    else if (ctx.method === 'keyboard-interactive') ctx.prompt([{prompt:'Fixture OTP:',echo:false}], answers => answers[0] === '123456' ? ctx.accept() : ctx.reject());
    else ctx.reject(['password','publickey','keyboard-interactive']);
  });
  client.on('ready', () => client.on('session', accept => {
    const session = accept();
    session.on('pty', accept => accept());
    session.on('shell', accept => {
      const stream = accept();
      stream.write('PRE_HANDOFF_SECRET\r\nfixture$ ');
      stream.on('data', data => {
        if (data.includes(3)) stream.write('INTERRUPTED\r\n');
        else if (data.toString() === 'disconnect\r') client.end();
        else stream.write(data);
      });
    });
  }));
});
server.listen(0,'127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
process.stdin.resume();
process.stdin.on('end', () => {server.close(); process.exit(0);});
