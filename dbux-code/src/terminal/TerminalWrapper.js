import fs from 'fs';
import os from 'os';
import path from 'path';
import { window } from 'vscode';
import { newLogger } from '@dbux/common/src/log/logger';
import Process from '@dbux/projects/src/util/Process';
import which from '@dbux/projects/src/util/which';
import { execCommand } from '../codeUtil/terminalUtil';
import { getResourcePath } from '../resources';
import sleep from '@dbux/common/src/util/sleep';

const Verbose = true;
// const Verbose = false;

// eslint-disable-next-line no-unused-vars
const { log, debug, warn, error: logError } = newLogger('terminalWrapper');

// ###########################################################################
// utilities
// ###########################################################################

/**
 * TODO: clean this up and move it to a more suitable place
 */
async function getPathToNode() {
  const volta = (await which('volta'));
  if (volta) {
    // get the actual Node binary location that is not inside the target directory (i.e. the globally installed version)
    return Process.execCaptureOut(`volta which node`, { processOptions: { cmd: __dirname } });
  }
  return 'node';
}

// ###########################################################################
// TerminalWrapper
// ###########################################################################

function fixPathForSerialization(p) {
  return p.replace(/\\/g, '/');
}

export default class TerminalWrapper {
  _disposable;

  start(cwd, command, args) {
    this._disposable = window.onDidCloseTerminal(terminal => {
      if (terminal === this._terminal) {
        this.dispose();
      }
    });
    this._promise = this._run(cwd, command, args);
  }

  async waitForResult() {
    return this._promise;
  }

  async _run(cwd, command, args) {
    // NOTE: fix paths on Windows
    let tmpFolder = fixPathForSerialization(fs.mkdtempSync(path.join(os.tmpdir(), 'dbux-')));
    const pathToNode = fixPathForSerialization(await getPathToNode());
    const pathToDbuxRun = fixPathForSerialization(getResourcePath('../dist/_dbux_run.js'));

    // serialize everything
    const runJsargs = { cwd, command, args, tmpFolder };
    const serializedRunJsArgs = Buffer.from(JSON.stringify(runJsargs)).toString('base64');
    // const runJsCommand = `pwd && node -v && which node && echo %PATH% && node ${pathToDbuxRun} ${serializedRunJsArgs}`;
    const runJsCommand = `${pathToNode} ${pathToDbuxRun} ${serializedRunJsArgs}`;

    debug('wrapping terminal command: ', JSON.stringify(runJsargs), `pathToDbuxRun: ${pathToDbuxRun}`);

    // execute command
    this._terminal = await execCommand(cwd, runJsCommand);
    
    const commandCall = `${cwd}$ ${command}`;

    try {
      return await new Promise((resolve, reject) => {
        let resolved = false;
        const watcher = fs.watch(tmpFolder);
        watcher.on('change', (eventType, filename) => {
          watcher.close();

          let result;
          if (filename === 'error') {
            result = { error: fs.readFileSync(path.join(tmpFolder, filename), { encoding: 'utf8' }) };
          } else {
            result = { code: parseInt(filename, 10) };
          }

          Verbose && debug('Terminal command finished. Result:', JSON.stringify(result));
          fs.unlinkSync(path.join(tmpFolder, filename));
          resolve(result);
          resolved = true;
        });

        watcher.on('error', (err) => {
          let newErr = new Error(`FSWatcher error: ${err.message}`);
          if (resolved) {
            warn(newErr);
          }
          else {
            reject(newErr);
          }
        });

        window.onDidCloseTerminal((terminal) => {
          if (terminal === this._terminal) {
            watcher.close();

            const msg = `Terminal closed (${commandCall})`;
            if (resolved) {
              debug(msg);
            }
            else {
              let newErr = new Error(msg);
              reject(newErr);
            }
          }
        });
      });
    }
    catch (err) {
      // await sleep(5);
      // this.dispose();
      err.message = `Terminal command (${commandCall}) failed - ${err.message}`;
      throw err;
    } 
    finally {
      fs.rmdirSync(tmpFolder);
    }
  }

  dispose() {
    const {
      _disposable
    } = this;

    this._disposable = null;
    this._promise = null;
    this.terminal = null;

    _disposable?.dispose();
  }

  cancel() {
    this.dispose();
  }


  // ###########################################################################
  // static functions
  // ###########################################################################

  /**
   * Execute `command` in `cwd` in terminal.
   * @param {string} cwd Set working directory to run `command`.
   * @param {string} command The command will be executed.
   * @param {object} args 
   */
  static execInTerminal(cwd, command, args) {
    // TODO: register wrapper with context

    const wrapper = new TerminalWrapper();
    wrapper.start(cwd, command, args);
    return wrapper;
  }
}