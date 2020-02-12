import path from 'path';
import pull from 'lodash/pull';
import { newLogger } from 'dbux-common/src/log/logger';
import ExecutionContext from 'dbux-common/src/core/data/ExecutionContext';
import Trace from 'dbux-common/src/core/data/Trace';
import ValueRef from 'dbux-common/src/core/data/ValueRef';
import StaticProgramContext from 'dbux-common/src/core/data/StaticProgramContext';
import StaticContext from 'dbux-common/src/core/data/StaticContext';
import StaticTrace from 'dbux-common/src/core/data/StaticTrace';
import deserialize from 'dbux-common/src/serialization/deserialize';
import { EmptyObject } from '../../dbux-common/src/util/arrayUtil';

import Collection from './Collection';
import Queries from './queries/Queries';
import Indexes from './indexes/Indexes';

const { log, debug, warn, error: logError } = newLogger('DataProvider');

class StaticProgramContextCollection extends Collection<StaticProgramContext> {
  constructor(dp) {
    super('staticProgramContexts', dp);
  }

  add(entries) {
    for (const entry of entries) {
      if (!entry.filePath || !path.isAbsolute(entry.filePath)) {
        logError('invalid `staticProgramContext.filePath` is not absolute - don\'t know how to resolve', entry.fileName);
      }

      // set applicationId, so we can trace any data point back to it's application
      entry.applicationId = this.dp.application.applicationId;
    }
    super.add(entries);
  }
}

class StaticContextCollection extends Collection<StaticContext> {
  constructor(dp) {
    super('staticContexts', dp);
  }
}

class StaticTraceCollection extends Collection<StaticTrace> {
  constructor(dp) {
    super('staticTraceContexts', dp);
  }
}

class ExecutionContextCollection extends Collection<ExecutionContext> {
  constructor(dp) {
    super('executionContexts', dp);
  }
  
  add(entries) {
    for (const entry of entries) {
      if (!entry.parentContextId) {
        // set applicationId, so we can trace any data point back to it's application
        entry.applicationId = this.dp.application.applicationId;
      }
    }
    super.add(entries);
  }
}


class TraceCollection extends Collection<Trace> {
  constructor(dp) {
    super('traces', dp);
  }

  add(entries) {
    for (const entry of entries) {
      entry.applicationId = this.dp.application.applicationId;
    }
    super.add(entries);
  }
}

class ValueCollection extends Collection<ValueRef> {
  constructor(dp) {
    super('values', dp);
  }

  add(entries) {
    for (const entry of entries) {
      entry.value = deserialize(entry.serialized);
      entry.serialized = null; // don't need this, so don't keep it around
    }
    super.add(entries);
  }
}


export default class DataProvider {
  // /**
  //  * Usage example: `dataProvider.collections.staticContexts.getById(id)`
  //  * 
  //  * @public
  //  */
  // collections;

  /**
   * Internal event listeners.
   * 
   * @private
   */
  _dataEventListeners0 = {};

  /**
   * Outside event listeners.
   * 
   * @private
   */
  _dataEventListeners = {};

  versions: number[] = [];
  application: StaticProgramContext;
  util: any;

  constructor(application) {
    this.application = application;

    this.collections = {
      staticProgramContexts: new StaticProgramContextCollection(this),
      staticContexts: new StaticContextCollection(this),
      staticTraces: new StaticTraceCollection(this),

      executionContexts: new ExecutionContextCollection(this),
      traces: new TraceCollection(this),
      values: new ValueCollection(this)
    };

    this.queries = new Queries();
    this.indexes = new Indexes();
  }

  // ###########################################################################
  // Public methods
  // ###########################################################################

  /**
   * Add a data event listener to given collection.
   * @deprecated
   */
  onData(collectionName: string, cb: ([]) => void) {
    const listeners = this._dataEventListeners[collectionName] = 
      (this._dataEventListeners[collectionName] || []);
    listeners.push(cb);

    const unsubscribe = (() => {
      pull(this._dataEventListeners[collectionName], cb);
    });
    return unsubscribe;
  }

  /**
   * Bundled data listener.
   * 
   * @returns {function} Unsubscribe function. Execute to cancel this listener.
   */
  onDataAll(cfg) {
    for (const collectionName in cfg.collections) {
      const cb = cfg.collections[collectionName];
      const listeners = this._dataEventListeners[collectionName] = (this._dataEventListeners[collectionName] || []);
      listeners.push(cb);
    }

    const unsubscribe = ((cfg) => {
      for (const collectionName in cfg.collections) {
        const cb = cfg.collections[collectionName];
        pull(this._dataEventListeners[collectionName], cb);
      }
    }).bind(this, cfg);
    return unsubscribe;
  }

  /**
   * Deletes all previously stored data.
   */
  clear() {
    throw new Error('NYI - we are not properly reseting (i) indexes and (ii) queries yet');
  }

  /**
   * Add given data (of different collections) to this `DataProvier`
   */
  addData(allData): { [string]: any[] } {
    // sanity checks
    if (!allData || allData.constructor.name !== 'Object') {
      logError('invalid data must be (but is not) object -', allData);
    }

    // debug('received', allData);

    this._addData(allData);
    this._postAdd(allData);
  }

  addQuery(newQuery) {
    this.queries._addQuery(this, newQuery);
  }

  addIndex(newIndex) {
    this.indexes._addIndex(newIndex);
    newIndex._init(this);

    // add event listeners
    const collectionListeners = newIndex.dependencies?.collections;
    if (collectionListeners) {
      for (const collectionName in collectionListeners) {
        const listeners = this._dataEventListeners0[collectionName] = (this._dataEventListeners0[collectionName] || []);
        const cb = collectionListeners[collectionName].added;
        if (cb) {
          listeners.push(cb);
        }
      }
    }
  }


  // ###########################################################################
  // Private methods
  // ###########################################################################

  _addData(allData) {
    for (const collectionName in allData) {
      const collection = this.collections[collectionName];
      if (!collection) {
        // should never happen
        logError('received data referencing invalid collection -', collectionName);
        delete this.collections[collectionName];
        continue;
      }

      const data = allData[collectionName];
      ++this.versions[collection._id]; // update version
      collection.add(data);
    }
  }

  _postAdd(allData) {
    // process new data (most importantly: indexes)
    for (const collectionName in allData) {
      const indexes = this.indexes[collectionName];
      if (indexes) {
        const data = allData[collectionName];
        for (const name in indexes) {
          indexes[name].addEntries(data);
        }
      }
    }

    // fire internal event listeners
    for (const collectionName in allData) {
      // const collection = this.collections[collectionName];
      const data = allData[collectionName];
      this._notifyData(collectionName, data, this._dataEventListeners0);
    }


    // fire event listeners
    for (const collectionName in allData) {
      // const collection = this.collections[collectionName];
      const data = allData[collectionName];
      this._notifyData(collectionName, data, this._dataEventListeners);
    }
  }

  _notifyData(collectionName: string, data: [], allListeners) {
    const listeners = allListeners[collectionName];
    if (listeners) {
      listeners.forEach((cb) => cb(data));
    }
  }
}