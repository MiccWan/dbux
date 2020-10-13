import CollectionIndex from '@dbux/data/src/indexes/CollectionIndex';

/** @typedef {import('../ProgressLogController').default} ProgressLogController */

/** @extends {CollectionIndex<TestRun>} */
export default class TestRunByBugIdIndex extends CollectionIndex {
  constructor() {
    super('testRuns', 'byBugId', { stringKey: true });
  }

  /** 
   * @param {ProgressLogController} plc
   * @param {TestRun} testRun
   */
  makeKey(plc, testRun) {
    return testRun.bugId;
  }
}