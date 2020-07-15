import { newLogger } from '@dbux/common/src/log/logger';
import RuntimeClient from './RuntimeClient';
import { makeListenSocket } from './serverUtil';

const DefaultPort = 3374;

// eslint-disable-next-line no-unused-vars
const { log, debug, warn, error: logError } = newLogger('RuntimeServer');

/**
 * Server for `dbux-runtime` to connect to.
 * 
 * NOTE: This server's URL is at ws://localhost:<DefaultPort>/socket.io/?transport=websocket
 */
export default class SocketServer {
  _listenSocket;
  _clients = [];

  constructor(ClientClass) {
    this.ClientClass = ClientClass;
  }

  start(port) {
    this._listenSocket = makeListenSocket(port);
    this._listenSocket.on('connect', this._handleAccept.bind(this));
  }

  /**
   * New socket connected
   */
  _handleAccept(socket) {
    const client = new this.ClientClass(this, socket);
    this._clients.push(client);

    // handle disconnects
    socket.on('disconnect', () => {
      this._clients = this._clients.filter(c => c !== client);
      client._handleDisconnect?.();
    });

    return client;
  }

  dispose() {
    this._listenSocket?.close();
    this._listenSocket = null;
  }
}


let server;

export function initRuntimeServer(context) {
  server = new SocketServer(RuntimeClient);
  server.start(DefaultPort);
  context.subscriptions.push(server);

  return server;
}