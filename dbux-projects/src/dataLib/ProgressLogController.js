import last from 'lodash/last';
import { newLogger } from '@dbux/common/src/log/logger';
import allApplications from '@dbux/data/src/applications/allApplications';
import Collection from '@dbux/data/src/Collection';
import Indexes from '@dbux/data/src/indexes/Indexes';
import ProgressLogUtil from './progressLogUtil';
import BugProgressByBugIdIndex from './indexes/BugProgressByBugIdIndex';
import TestRunsByBugIdIndex from './indexes/TestRunsByBugIdIndex';
import TestRun from './TestRun';
import BugProgress from './BugProgress';
import { emitBugProgressChanged, emitNewBugProgress, emitNewTestRun } from '../userEvents';

// eslint-disable-next-line no-unused-vars
const { log, debug, warn, error: logError } = newLogger('ProgressLogController');

const storageKey = 'dbux-projects.progressLog';

/** @typedef {import('../ProjectsManager').default} ProjectsManager */
/** @typedef {import('./TestRun').default} TestRun */

/**
 * @extends {Collection<TestRun>}
 */
class TestRunCollection extends Collection {
  constructor(plc) {
    super('testRuns', plc);
  }
}

/**
 * @extends {Collection<BugProgress>}
 */
class BugProgressCollection extends Collection {
  constructor(plc) {
    super('bugProgresses', plc);
  }
}

export default class ProgressLogController {
  /**
   * Used for serialization
   */
  version = 1;

  /**
   * @type {number[]}
   */
  versions = [];

  /**
   * @type {ProjectsManager}
   */
  manager;

  /**
   * @type {ProgressLogUtil}
   */
  util;

  constructor(manager) {
    this.manager = manager;
    this.storage = manager.externals.storage;

    this.util = Object.fromEntries(
      Object.keys(ProgressLogUtil).map(name => [name, ProgressLogUtil[name].bind(null, this)])
    );

    this.load();
  }

  // ###########################################################################
  // Public add/edit data
  // ###########################################################################

  /**
   * @param {Bug} bug 
   * @param {number} nFailedTests
   * @param {string} patchString 
   * @return {TestRun}
   */
  addTestRun(bug, nFailedTests, patchString) {
    const testRun = new TestRun(bug, nFailedTests, patchString);
    this.addData({ testRuns: [testRun] });
    const application = last(allApplications.selection.getAll());
    emitNewTestRun(testRun, application);

    return testRun;
  }

  /**
   * @param {Bug} bug
   * @param {number} status
   * @param {boolean} stopwatchEnabled
   * @return {BugProgress}
   */
  addBugProgress(bug, status, stopwatchEnabled) {
    const bugProgress = new BugProgress(bug, status, stopwatchEnabled);
    this.addData({ bugProgresses: [bugProgress] });
    emitNewBugProgress(bugProgress);
    return bugProgress;
  }

  /**
   * NOTE: This may break indexes' keys
   * @param {Bug} bug 
   * @param {Object} update
   */
  updateBugProgress(bug, update) {
    const bugProgress = this.util.getBugProgressByBug(bug);
    for (const key of Object.keys(update)) {
      bugProgress[key] = update[key];
    }
    bugProgress.updatedAt = Date.now();
    emitBugProgressChanged(bugProgress);
  }

  // ###########################################################################
  // Private data flow
  // ###########################################################################

  /**
   * Add given data (of different collections) to this `DataProvier`
   * @param {{ [string]: any[] }} allData
   */
  addData(allData) {
    this._addData(allData);
    this._postAdd(allData);
  }

  addIndex(newIndex) {
    this.indexes._addIndex(newIndex);
    newIndex._init(this);
  }

  _addData(allData) {
    for (const collectionName in allData) {
      const collection = this.collections[collectionName];
      if (!collection) {
        // should never happen
        logError('received data referencing invalid collection -', collectionName);
        delete this.collections[collectionName];
        continue;
      }

      const entries = allData[collectionName];
      ++this.versions[collection._id]; // update version
      collection.add(entries);
    }
  }

  _postAdd(allData) {
    // indexes
    for (const collectionName in allData) {
      const indexes = this.indexes[collectionName];
      if (indexes) {
        const data = allData[collectionName];
        for (const name in indexes) {
          const index = indexes[name];
          if (index.addOnNewData) {
            indexes[name].addEntries(data);
          }
        }
      }
    }
  }

  // ###########################################################################
  // Data saving
  // ###########################################################################

  /**
   * Implementation, add indexes here
   * Note: Also resets all collections
   */
  init() {
    this.collections = {
      testRuns: new TestRunCollection(this),
      bugProgresses: new BugProgressCollection(this)
    };

    this.indexes = new Indexes();
    this.addIndex(new BugProgressByBugIdIndex());
    this.addIndex(new TestRunsByBugIdIndex());
  }


  /**
   * Save serialized data to external storage
   */
  async save() {
    try {
      const logString = this._serialize();
      await this.storage.set(storageKey, logString);
    }
    catch (err) {
      logError('Failed to save progress log:', err);
    }
  }

  /**
   * Load serialized data from external storage
   */
  load() {
    this.init();
    try {
      const logString = this.storage.get(storageKey);
      if (logString !== undefined) {
        this._deserialize(logString);
      }
    }
    catch (err) {
      logError('Failed to load progress log:', err);
    }
  }

  async reset() {
    this.init();
    await this.save();
  }

  /**
   * Serialize all raw data into JSON format.
   */
  _serialize() {
    const collections = Object.values(this.collections);
    const obj = {
      version: this.version,
      collections: Object.fromEntries(collections.map(collection => {
        let {
          name,
          _all: entries
        } = collection;

        return [
          name,
          entries.slice(1)
        ];
      }))
    };
    return JSON.stringify(obj, null, 2);
  }

  /**
   * Deserialize and recover the data that serialized by `this._serialize()`
   */
  _deserialize(dataString) {
    const data = JSON.parse(dataString);
    const { version, collections } = data;
    if (version !== this.version) {
      throw new Error(`could not serialize DataProvider - incompatible version: ${version} !== ${this.version}`);
    }
    this.addData(collections);
  }
}