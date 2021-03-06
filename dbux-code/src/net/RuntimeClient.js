import { newLogger } from '@dbux/common/src/log/logger';
import allApplications from '@dbux/data/src/applications/allApplications';
// eslint-disable-next-line no-unused-vars
import Application from '@dbux/data/src/applications/Application';
import SocketClient from './SocketClient';

const Verbose = false;
// const Verbose = true;

// eslint-disable-next-line no-unused-vars
const { log, debug, warn, error: logError } = newLogger('RuntimeClient');

export default class RuntimeClient extends SocketClient {
  /**
   * @type {Application}
   */
  application;

  constructor(server, socket) {
    super(server, socket);

    Verbose && debug('connected');

    this.on('init', this._handleInit);
    this.on('data', this._handleData);
  }

  isReady() {
    return !!this.application;
  }

  /**
   * @return {Application}
   */
  _getOrCreateApplication(initialData) {
    const { applicationId } = initialData;
    let application;
    const firstTime = !applicationId;
    if (firstTime) {
      // first time
      application = allApplications.addApplication(
        initialData
      );
    }
    else {
      // reconnect
      application = allApplications.getById(applicationId);
    }

    log('init', firstTime ? '(new)' : '(reconnect)', application?.entryPointPath);
    return application;
  }

  _handleInit = (initialData) => {
    if (this.isReady()) {
      logError(`${initialData?.entryPointPath} - received init from client twice. Please restart application.`);
    }
    else {
      this.application = this._getOrCreateApplication(initialData);
      if (!this.application) {
        logError(`${initialData?.entryPointPath} - application claims to have reconnected but we don't have any of its previous information. Please restart application.`);
        return;
      }
    }

    debug('init');
    this.socket.emit('init_ack', this.application.applicationId);
  }

  _handleData = (data) => {
    debug('data received; trying to addData...');
    this.application.addData(data);
  }
}