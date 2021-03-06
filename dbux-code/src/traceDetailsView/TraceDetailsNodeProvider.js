import traceSelection from '@dbux/data/src/traceSelection';
import EmptyObject from '@dbux/common/src/util/EmptyObject';
import { DetailNodeClasses } from './nodes/traceDetailNodes';
import SelectedTraceNode from './nodes/SelectedTraceNode';
import TraceNode from './nodes/TraceNode';
import EmptyNode from './nodes/EmptyNode';
import BaseTreeViewNodeProvider from '../codeUtil/BaseTreeViewNodeProvider';
import NavigationNode from './nodes/NavigationNode';

export default class TraceDetailsDataProvider extends BaseTreeViewNodeProvider {
  constructor() {
    super('dbuxTraceDetailsView');
  }

  // ###########################################################################
  // tree building
  // ###########################################################################

  buildRoots() {
    const roots = [];

    if (traceSelection.selected) {
      const trace = traceSelection.selected;
      
      roots.push(
        this.buildSelectedTraceNode(trace),
        ...this.buildTraceDetailNodes(trace, null)
      );
    }
    else {
      // add empty node
      roots.push(EmptyNode.instance);
    }

    return roots;
  }

  buildTraceDetailNodes(trace, parent) {
    const nodes = [
      // navigation node
      this.buildNavigationNode(trace, parent),

      // other detail nodes
      ...this.buildDetailNodes(trace, parent, DetailNodeClasses)
    ].filter(node => !!node);

    return nodes;
  }

  // ###########################################################################
  // Detail nodes
  // ###########################################################################

  buildDetailNodes(trace, parent, NodeClasses) {
    return NodeClasses
      .map(NodeClass => this.maybeBuildTraceDetailNode(NodeClass, trace, parent))
      .filter(node => !!node);
  }

  maybeBuildTraceDetailNode(NodeClass, trace, parent) {
    const detail = NodeClass.makeTraceDetail(trace, parent);
    const props = NodeClass.makeProperties?.(trace, parent, detail) || EmptyObject;
    if (!detail) {
      return null;
    }
    const treeItemProps = {
      trace,
      ...props
    };
    return this.buildNode(NodeClass, detail, parent, treeItemProps);
  }
  
  // ###########################################################################
  // Util
  // ###########################################################################
  
  buildSelectedTraceNode(trace) {
    return this.buildNode(SelectedTraceNode, trace);
  }

  buildNavigationNode(trace, parent) {
    return this.buildNode(NavigationNode, trace, parent);
  }

  buildTraceNode(trace, parent) {
    return this.buildNode(TraceNode, trace, parent);
  }
}