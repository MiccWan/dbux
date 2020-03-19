import Trace from 'dbux-common/src/core/data/Trace';
import CollectionIndex from '../../indexes/CollectionIndex';
import DataProvider from '../../DataProvider';

function makeKey(dp: DataProvider, trace: Trace) {
  const {
    parentContextId = 0
  } = dp.collections.executionContexts.getById(trace.contextId);

  return parentContextId;
}


export default class TracesByParentContextIndex extends CollectionIndex<Trace> {
  constructor() {
    super('traces', 'byParentContext');
  }

  makeKey = makeKey
}