process.on('message', message => {
  if (message.type === 'ping') process.send({ type: 'pong' });
  if (message.type === 'stop') process.disconnect();
});
