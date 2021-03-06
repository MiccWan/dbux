import { TreeItemCollapsibleState } from 'vscode';
import Enum from '@dbux/common/src/util/Enum';
import { makeContextLabel } from '@dbux/data/src/helpers/contextLabels';
import traceSelection from '@dbux/data/src/traceSelection';
import { makeRootTraceLabel, makeTraceLabel, makeTraceValueLabel, makeCallValueLabel } from '@dbux/data/src/helpers/traceLabels';
import allApplications from '@dbux/data/src/applications/allApplications';
import UserActionType from '@dbux/data/src/pathways/UserActionType';
import TraceType, { isCallbackRelatedTrace } from '@dbux/common/src/core/constants/TraceType';
import GroupNode from './GroupNode';
import BaseTreeViewNode from '../../codeUtil/BaseTreeViewNode';
import TraceByStaticTraceNode from './TraceByStaticTraceNode';

// ###########################################################################
// grouping modes
// ###########################################################################

// eslint-disable-next-line import/no-mutable-exports
let GroupingMode = {
  Ungrouped: 1,
  ByRunId: 2,
  ByContextId: 3,
  ByCallerTraceId: 4,
  ByParentContextId: 5,
  ByCallback: 6
};
GroupingMode = new Enum(GroupingMode);

const GroupingModeLabel = new Map();
GroupingModeLabel.set(GroupingMode.ByRunId, 'by Run');
GroupingModeLabel.set(GroupingMode.ByContextId, 'by Context');
GroupingModeLabel.set(GroupingMode.ByCallerTraceId, 'by Caller Trace');
GroupingModeLabel.set(GroupingMode.ByParentContextId, 'by Parent Context');
GroupingModeLabel.set(GroupingMode.ByCallback, 'by Callback');

// Default mode
let groupingMode = GroupingMode.Ungrouped;

const groupByMode = {
  [GroupingMode.ByRunId](app, traces) {
    const tracesByRunId = [];
    for (const trace of traces) {
      const { runId } = trace;
      if (!tracesByRunId[runId]) tracesByRunId[runId] = [];
      tracesByRunId[runId].push(trace);
    }
    const groups = tracesByRunId
      .map((children, runId) => {
        const firstTraceOfRun = app.dataProvider.util.getFirstTraceOfRun(runId);
        const label = makeRootTraceLabel(firstTraceOfRun);
        const description = `Run: ${runId}`;
        return { label, children, description };
      });
    return groups.filter(group => !!group);
  },
  [GroupingMode.ByContextId](app, traces) {
    const tracesByContextId = [];
    for (const trace of traces) {
      const { contextId } = trace;
      if (!tracesByContextId[contextId]) tracesByContextId[contextId] = [];
      tracesByContextId[contextId].push(trace);
    }
    const groups = tracesByContextId
      .map((children, contextId) => {
        const context = app.dataProvider.collections.executionContexts.getById(contextId);
        const label = makeContextLabel(context, app);
        const description = `ContextId: ${contextId}`;
        return { label, children, description };
      });
    return groups.filter(group => !!group);
  },
  [GroupingMode.ByCallerTraceId](app, traces) {
    const tracesByCaller = [];
    const dp = app.dataProvider;
    for (const trace of traces) {
      const { contextId } = trace;
      const callerTraceId = dp.util.getCallerTraceOfContext(contextId)?.traceId || 0;
      if (!tracesByCaller[callerTraceId]) tracesByCaller[callerTraceId] = [];
      tracesByCaller[callerTraceId].push(trace);
    }
    const groups = tracesByCaller
      .map((children, callerTraceId) => {
        const trace = dp.collections.traces.getById(callerTraceId);
        const label = trace ? makeTraceLabel(trace) : '(No Caller Trace)';
        const description = `TraceId: ${callerTraceId}`;
        return { label, children, description };
      });
    return groups.filter(group => !!group);
  },
  [GroupingMode.ByParentContextId](app, traces) {
    const tracesByParent = [];
    const dp = app.dataProvider;
    for (const trace of traces) {
      const { contextId } = trace;
      const { parentContextId = 0 } = dp.collections.executionContexts.getById(contextId);
      if (!tracesByParent[parentContextId]) tracesByParent[parentContextId] = [];
      tracesByParent[parentContextId].push(trace);
    }
    const groups = tracesByParent
      .map((children, parentContextId) => {
        const context = dp.collections.executionContexts.getById(parentContextId);
        const label = context ? makeContextLabel(context, app) : '(No Parent Context)';
        const description = `ContextId: ${parentContextId}`;
        return { label, children, description };
      });
    return groups.filter(group => !!group);
  },
  [GroupingMode.ByCallback](app, traces) {
    const dp = app.dataProvider;
    const tracesByCall = [];
    for (const trace of traces) {
      const { contextId } = trace;
      const context = dp.collections.executionContexts.getById(contextId);
      const { schedulerTraceId } = context;
      const { callId = 0 } = dp.collections.traces.getById(schedulerTraceId) || trace;
      if (!tracesByCall[callId]) tracesByCall[callId] = [];
      tracesByCall[callId].push(trace);
    }
    const groups = tracesByCall
      .map((children, callId) => {
        const trace = dp.collections.traces.getById(callId);
        const label = trace ? makeCallValueLabel(trace) : '(No Caller)';
        const description = `Call: ${callId}`;
        children = children.filter(({ traceId }) => dp.util.getTraceType(traceId) === TraceType.PushCallback);
        return { label, children, description };
      });
    return groups.filter(group => !!group);
  }
};

function isTraceCallbackRelated(trace) {
  const { applicationId, traceId } = trace;
  const dp = allApplications.getById(applicationId).dataProvider;
  const type = dp.util.getTraceType(traceId);
  return isCallbackRelatedTrace(type);
}

function getGroupingMode() {
  return groupingMode;
}

export { GroupingMode, getGroupingMode };

export function switchMode(mode) {
  if (mode) {
    groupingMode = mode;
  }
  else {
    groupingMode = GroupingMode.nextValue(groupingMode);
    if (groupingMode === GroupingMode.ByCallback && !isTraceCallbackRelated(traceSelection.selected)) {
      groupingMode = GroupingMode.nextValue(groupingMode);
    }
  }
  return groupingMode;
}

export default class ExecutionsTDNode extends BaseTreeViewNode {
  static makeTraceDetail(trace/* , parent */) {
    return trace;
  }

  static makeProperties(trace/* , parent, detail */) {
    // build children here since label depends on children
    const { applicationId, staticTraceId } = trace;
    const app = allApplications.getById(applicationId);
    const dp = app.dataProvider;
    const traces = dp.indexes.traces.byStaticTrace.get(staticTraceId);
    if (groupingMode === GroupingMode.ByCallback && !isTraceCallbackRelated(trace)) switchMode();


    let groupedTraces, label;
    if (groupingMode === GroupingMode.Ungrouped) {
      groupedTraces = traces;
      label = `Executions: ${traces.length}x`;
    }
    else {
      groupedTraces = groupByMode[groupingMode](app, traces);
      let modeLabel = GroupingModeLabel.get(groupingMode);
      label = `Executions: ${traces.length}x (${groupedTraces.length} groups ${modeLabel})`;
    }

    return {
      groupedTraces,
      label
    };
  }

  static makeLabel(trace, parent, props) {
    return props.label;
  }

  get collapseChangeUserActionType() {
    return UserActionType.TDExecutionsUse;
  }

  get defaultCollapsibleState() {
    return TreeItemCollapsibleState.Collapsed;
  }

  init() {
    this.contextValue = 'dbuxTraceDetailsView.node.staticTraceTDNodeRoot';
  }

  buildChildren() {
    // use children built in `makeProperties`
    const { treeNodeProvider, groupedTraces } = this;
    let nodes;

    if (groupingMode === GroupingMode.Ungrouped) {
      nodes = groupedTraces.map((trace) => {
        const childLabel = makeTraceValueLabel(trace);
        const childNode = new TraceByStaticTraceNode(treeNodeProvider, childLabel, trace, this);
        childNode.collapsibleState = TreeItemCollapsibleState.None;
        return childNode;
      });
    }
    else {
      nodes = groupedTraces.map((groupData) => {
        const { label, children, description } = groupData;
        const node = new GroupNode(treeNodeProvider, label, null, this);
        if (children.length) {
          node.children = children.map((trace) => {
            const childLabel = makeTraceValueLabel(trace);
            const childNode = new TraceByStaticTraceNode(treeNodeProvider, childLabel, trace, node);
            childNode.collapsibleState = TreeItemCollapsibleState.Expanded;
            return childNode;
          });
        }
        else {
          node.children = null;
        }
        node.description = description;
        return node;
      });
    }


    return nodes;
  }
}