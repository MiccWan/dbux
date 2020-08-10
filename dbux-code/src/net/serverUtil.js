import http from 'http';
import * as SocketIOServer from 'socket.io';
import { newLogger } from '@dbux/common/src/log/logger';

// eslint-disable-next-line no-unused-vars
const { log, debug, warn, error: logError } = newLogger('net/servers');


/**
 * @param {number} port 
 * @return {Promise<httpServer>}
 */
export function makeHttpServer(port) {
  const httpServer = http.createServer();
  // const address = '0.0.0.0';
  const address = '';

  let _resolve, _reject;
  let _promise = new Promise((resolve, reject) => {
    _resolve = resolve;
    _reject = reject;
  });

  httpServer.listen(port, () => {
    debug(`server listening on port ${address}:${port}...`);

    let resolve = _resolve;
    _resolve = _reject = null;
    resolve?.(httpServer);
  });
  httpServer.on('error', err => {
    logError('dbux http server failed', err);

    let reject = _reject;
    _resolve = _reject = null;
    reject?.();
  });

  return _promise;
}


export async function makeListenSocket(port) {
  const httpServer = await makeHttpServer(port);

  // see: https://socket.io/docs/server-api/
  const listenSocket = SocketIOServer(httpServer, {
    // const server = require('socket.io')(httpServer, {
    serveClient: false,

    // see: https://github.com/socketio/engine.io/blob/6a16ea119280a02029618544d44eb515f7f2d076/lib/server.js#L107
    wsEngine: 'ws' // in case uws is not supported
  });

  listenSocket.on('error', err => {
    logError('dbux listen server failed', err);
  });

  return listenSocket;
}