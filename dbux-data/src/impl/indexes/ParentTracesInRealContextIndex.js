import ExecutionContext from '@dbux/common/src/core/data/ExecutionContext';
import { isVirtualContextType } from '@dbux/common/src/core/constants/ExecutionContextType';
import Trace from '@dbux/common/src/core/data/Trace';
import CollectionIndex from '../../indexes/CollectionIndex';
import RuntimeDataProvider from '../../RuntimeDataProvider';


/** @extends {CollectionIndex<Trace>} */
export default class ParentTracesInRealContextIndex extends CollectionIndex {
  constructor() {
    super('traces', 'parentsByRealContext', { addOnNewData: false });
    this.addedTraces = new Set();
  }

  dependencies = {

    // NOTE: we are currently solving index dependencies by simply adding depdendents after dependees
    // indexes: [
    //   ['traces', 'byStaticTrace'],
    //   ['staticTraces', 'byFile']
    // ],

    /**
     * Find parent trace when a context is added
     */
    collections: {
      executionContexts: {
        /**
         * @param {ExecutionContext[]} contexts
         */
        added: (contexts) => {
          for (const context of contexts) {
            const { parentTraceId, contextType } = context;
            // skip parent trace of virtualContext
            if (isVirtualContextType(contextType)) {
              continue;
            }
            if (parentTraceId && !this.addedTraces.has(parentTraceId)) {
              this.addEntryById(parentTraceId);
              this.addedTraces.add(parentTraceId);
            }
          }
        }
      }
    }
  }

  /** 
   * @param {RuntimeDataProvider} dp
   * @param {Trace} { traceId }
   */
  makeKey(dp, { traceId }) {
    return dp.util.getRealContextId(traceId);
  }
}