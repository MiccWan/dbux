/**
 * @file
 * 
 * NOTE: This file was originally designed to handle traces only.
 *  Later on we encountered some real issues from trying to separate trace and context instrumentation, and did not 
 *  have the time yet to properly separate them again. That is why there is also some context instrumentation in this file
 */

import Enum from 'dbux-common/src/util/Enum';
import TraceType from 'dbux-common/src/core/constants/TraceType';
import { newLogger } from 'dbux-common/src/log/logger';
import { traceWrapExpression, traceBeforeExpression, buildTraceNoValue, traceCallExpression, traceSuper } from '../helpers/traceHelpers';
import { loopVisitor } from './loopVisitors';
import { getPathTraceId } from '../data/StaticTraceCollection';
import { isCallPath } from '../helpers/functionHelpers';
import { functionVisitEnter } from './functionVisitor';
import { awaitVisitEnter } from './awaitVisitor';
import { getNodeNames } from './nameVisitors';


const { log, debug, warn, error: logError } = newLogger('traceVisitors');

const Verbose = false;

const TraceInstrumentationType = new Enum({
  NoTrace: 0,
  CallExpression: 1,
  /**
   * Result of a computation
   */
  ExpressionResult: 2,
  /**
   * Only keeping track of data
   */
  ExpressionValue: 3,
  // ExpressionNoValue: 3,
  Statement: 4,
  Block: 5,
  Loop: 6,

  // Special attention required for these
  MemberExpression: 8,
  Super: 9,
  ReturnArgument: 10,
  ThrowArgument: 11,

  Function: 12,
  Await: 13
});

const InstrumentationDirection = {
  Enter: 1,
  Exit: 2
};

const traceCfg = (() => {
  const {
    NoTrace,
    CallExpression,
    ExpressionResult,
    ExpressionValue,
    // ExpressionNoValue,
    Statement,
    Block,
    Loop,

    MemberExpression,
    Super,
    ReturnArgument,
    ThrowArgument,

    Function: F,
    Await
  } = TraceInstrumentationType;

  return {
    // ########################################
    // assignments
    // ########################################
    AssignmentExpression: [
      // ExpressionResult,
      NoTrace,
      [['right', ExpressionResult, null, { originalIsParent: true }]]
    ],
    ClassPrivateProperty: [
      NoTrace,
      [['value', ExpressionResult]]
    ],
    ClassProperty: [
      NoTrace,
      [['value', ExpressionResult]]
    ],
    VariableDeclaration: [
      NoTrace,
      null,
      {
        // filter(path, state) {
        //   // ignore variable declarations in for loops inits
        //   return !path.parentPath.isFor();
        // }
      }
    ],
    VariableDeclarator: [
      NoTrace,
      [['init', ExpressionResult, null, { originalIsParent: true }]]
    ],


    // ########################################
    // expressions
    // ########################################
    CallExpression: [
      CallExpression
    ],
    OptionalCallExpression: [
      CallExpression
    ],
    NewExpression: [
      // TODO: fix this
      ExpressionResult
    ],
    /**
     * Ternary operator
     */
    ConditionalExpression: [
      ExpressionResult,
      [['test', ExpressionResult], ['consequent', ExpressionResult], ['alternate', ExpressionResult]]
    ],
    UpdateExpression: ExpressionResult,
    YieldExpression: [
      NoTrace,
      [['argument', ExpressionResult]]
    ],


    // ########################################
    // Data read expressions
    // ########################################

    BinaryExpression: [
      NoTrace,
      [['left', ExpressionValue], ['right', ExpressionValue]]
    ],

    LogicalExpression: [
      NoTrace,
      [['left', ExpressionValue], ['right', ExpressionValue]]
    ],

    MemberExpression: [
      MemberExpression
    ],

    OptionalMemberExpression: [
      MemberExpression
    ],

    SequenceExpression: [
      NoTrace,
      [['expressions', ExpressionValue]]
    ],

    TemplateLiteral: [
      NoTrace,
      [['expressions', ExpressionValue]]
    ],

    UnaryExpression: [
      NoTrace,
      [['argument', ExpressionValue]]
    ],

    Super: [
      Super
    ],


    // ########################################
    // statements
    // ########################################
    BreakStatement: Statement,
    ContinueStatement: Statement,
    Decorator: [
      NoTrace,
      // [['expression', ExpressionNoValue]]
    ],
    // Declaration: [
    //   Statement,
    //   null, // no children
    //   {
    //     ignore: ['ImportDeclaration'] // ignore: cannot mess with imports
    //   }
    // ],

    ReturnStatement: [
      NoTrace,
      [['argument', ReturnArgument]]
    ],
    ThrowStatement: [
      NoTrace,
      [['argument', ThrowArgument]]
    ],


    // ########################################
    // loops
    // ########################################
    ForStatement: [
      Loop
    ],
    ForInStatement: [
      Loop
    ],
    ForOfStatement: [
      Loop
    ],
    DoWhileLoop: [
      // TODO: currently disabled because babel doesn't like it; probably a babel bug?
      Loop
    ],
    WhileStatement: [
      Loop
    ],

    // ########################################
    // if, else, switch, case
    // ########################################
    IfStatement: [
      NoTrace,
      [['test', ExpressionResult], ['consequent', Block], ['alternate', Block]],
    ],
    SwitchStatement: [
      NoTrace,
      [['discriminant', ExpressionResult]]
    ],
    // SwitchCase: [
    // TODO: insert trace call into `consequent` array.
    //    NOTE: we cannot just wrap the `consequent` statement array into a new block, as that will change the semantics (specifically: local variables would not be able to spill into subsequent cases)
    //   NoTrace,
    //   [['consequent', Block]]
    // ],


    // ########################################
    // try + catch
    // ########################################
    TryStatement: [
      NoTrace,
      // [['block', Block], ['finalizer', Block]]
    ],
    CatchClause: [
      NoTrace,
      [['body', Block]]
    ],

    // ExpressionStatement: [['expression', true]], // already taken care of by everything else

    // ########################################
    // functions
    // ########################################
    Function: [
      F
    ],

    // ########################################
    // await
    // ########################################
    AwaitExpression: [
      Await
    ],

    // TODO: ParenthesizedExpression - https://github.com/babel/babel/blob/master/packages/babel-generator/src/generators/expressions.js#L27
    // TODO: BindExpression - https://github.com/babel/babel/blob/master/packages/babel-generator/src/generators/expressions.js#L224
    // TODO: TypeCastExpression
    // TODO: TupleExpression - https://github.com/babel/babel/blob/f6c7bf36cec81baaba8c37e572985bb59ca334b1/packages/babel-generator/src/generators/types.js#L139
  };
})();


// ###########################################################################
// config
// ###########################################################################

function validateCfgNode(name, node) {
  const { visitorName, instrumentationType, children, nodeCfg } = node;

  if (!visitorName || instrumentationType === undefined) {
    throw new Error(`invalid traceType in cfgNode: ${name} - ${JSON.stringify(node)}`);
  }

  // make sure, it has a valid type
  TraceInstrumentationType.nameFromForce(instrumentationType);
}

function validateCfg(cfg) {
  for (const name in cfg) {
    const nodeCfg = cfg[name];
    validateCfgNode(name, nodeCfg);
    // const {traceType, children, extraCfg} = nodeCfg;
    // for (const child of children) {
    //   ...
    // }
  }
}

function normalizeConfigNode(parentCfg, visitorName, cfgNode) {
  if (!Array.isArray(cfgNode)) {
    // no children
    cfgNode = [cfgNode];
  }

  let [instrumentationType, children, extraCfg] = cfgNode;
  if (extraCfg?.include) {
    // convert to set
    extraCfg.include = new Set(extraCfg.include);
  }

  cfgNode = {
    visitorName,
    instrumentationType,
    children,
    extraCfg,
    parentCfg
  };

  if (children) {
    cfgNode.children = children.map(([childName, ...childCfg]) => {
      return normalizeConfigNode(cfgNode, childName, childCfg);
    });
  }
  return cfgNode;
}

function normalizeConfig(cfg) {
  for (const visitorName in cfg) {
    const cfgNode = cfg[visitorName];
    cfg[visitorName] = normalizeConfigNode(null, visitorName, cfgNode);
  }

  validateCfg(cfg);

  return cfg;
}

// ###########################################################################
// ENTER instrumentors
// ###########################################################################

function beforeExpression(traceType, path, state, cfg) {
  if (isCallPath(path)) {
    // some of the ExpressionResult + ExpressionValue nodes we are interested in, might also be CallExpressions
    return beforeCallExpression(traceType, path, state, cfg);
  }
  return null;
}

function beforeCallExpression(callResultType, path, state, cfg) {
  // CallExpression

  // special treatment for `super`
  const calleePath = path.get('callee');
  if (calleePath.isSuper()) {
    traceSuper(calleePath, state);
  }

  // `BeforeCallExpression` (returns `originalPath`)
  path = traceBeforeExpression(TraceType.BeforeCallExpression, path, state, null);

  // trace CallResult (on exit)
  path.setData('callResultType', callResultType);
  return path;
}

const enterInstrumentors = {
  CallExpression(path, state, cfg) {
    return beforeCallExpression(TraceType.CallExpressionResult, path, state, cfg);
  },
  ExpressionResult(path, state, cfg) {
    return beforeExpression(TraceType.ExpressionResult, path, state, cfg);
  },
  ExpressionValue(pathOrPaths, state, cfg) {
    if (Array.isArray(pathOrPaths)) {
      // e.g. `SequenceExpression`
      for (const path of pathOrPaths) {
        beforeExpression(TraceType.ExpressionValue, path, state, cfg);
      }
      return null;  // returning originalPaths is currently meanignless since `path.get` would not work on it
    }
    else {
      return beforeExpression(TraceType.ExpressionValue, pathOrPaths, state, cfg);
    }
  },
  // ExpressionNoValue(path, state) {
  //   traceBeforeExpression(path, state);
  // },
  Statement(path, state) {
    const traceStart = buildTraceNoValue(path, state, TraceType.Statement);
    path.insertBefore(traceStart);
  },
  Block(path, state) {
    // NOTE: don't change order of statements here. We first MUST build all new nodes
    //    before instrumenting the path (because instrumentation causes the path to lose information)
    const trace = buildTraceNoValue(path, state, TraceType.BlockStart);
    const traceEnd = buildTraceNoValue(path, state, TraceType.BlockEnd);

    path.insertBefore(trace);
    path.insertAfter(traceEnd);
    // if (!t.isBlockStatement(path)) {
    //   // make a new block

    // }
    // else {
    //   // insert at the top of existing block
    // }
  },
  Loop(path, state) {
    loopVisitor(path, state);
  },
  MemberExpression(path, state) {
    // trace object of method call
    if (path.node.computed) {
      // if `computed`, also trace property independently
      const propertyPath = path.get('property');
      wrapExpression(TraceType.ExpressionValue, propertyPath, state);
    }

    const objPath = path.get('object');
    if (objPath.isSuper()) {
      // super needs special treatment
      // TODO: replace `traceSuper` with:
      //    1. `traceBeforeExpression` on Enter
      return traceSuper(objPath, state);
    }
    else {
      // trace object (e.g. `x` in `x.y`) as-is
      wrapExpression(TraceType.ExpressionValue, objPath, state, null, false);

      // NOTE: the `originalPath` is not maintained
      return undefined;
    }
  },
  // Super(path, state) {
  //   // NOTE: for some reason, `Super` visitor does not get picked up by Babel
  // },

  ReturnArgument(path, state, cfg) {
    if (path.node) {
      // trace `arg` in `return arg;`
      return wrapExpression(TraceType.ReturnArgument, path, state, cfg);
    }
    else {
      // insert trace before `return;` statement
      return traceBeforeExpression(TraceType.ReturnNoArgument, path.parentPath, state, cfg);
    }
  },

  ThrowArgument(path, state, cfg) {
    return wrapExpression(TraceType.ThrowArgument, path, state, cfg);
  },

  Function: functionVisitEnter,
  Await: awaitVisitEnter
};


// ###########################################################################
// EXIT instrumentors
// ###########################################################################

// function wrapExpressionExit(path, state, traceType) {
//   if (isCallPath(path)) {
//     return exitCallExpression(path, state, traceType);
//   }  
// }

function wrapExpression(traceType, path, state, cfg) {
  // any other expression with a result
  const originalIsParent = cfg?.originalIsParent;
  let tracePath;
  if (originalIsParent) {
    // we want to highlight the parentPath, instead of just the value path
    tracePath = path.parentPath;
  }

  return traceWrapExpression(traceType, path, state, tracePath);
}

function wrapCallExpression(path, state) {
  // CallExpression
  // instrument args after everything else has already been done

  // const calleePath = path.get('callee');
  // const beforeCallTraceId = getPathTraceId(calleePath);
  // traceCallExpression(path, state, beforeCallTraceId);
  const beforeCallTraceId = getPathTraceId(path);
  const callResultType = path.getData('callResultType') || TraceType.CallExpressionResult;
  return traceCallExpression(path, state, callResultType, beforeCallTraceId);
}

/**
 * NOTE: we have these specifically for expressions that
 * potentially can be `CallExpression`.
 */
const exitInstrumentors = {
  CallExpression(path, state) {
    return wrapCallExpression(path, state);
  },
  ExpressionResult(path, state, cfg) {
    return wrapExpression(TraceType.ExpressionResult, path, state, cfg);
  },
  ExpressionValue(pathOrPaths, state, cfg) {
    if (Array.isArray(pathOrPaths)) {
      // e.g. `SequenceExpression`
      for (const path of pathOrPaths) {
        wrapExpression(TraceType.ExpressionValue, path, state, cfg);
      }
      return null;  // returning originalPaths is currently meanignless since `path.get` would not work on it
    }
    else {
      return wrapExpression(TraceType.ExpressionValue, pathOrPaths, state, cfg);
    }
  },
};

// ###########################################################################
// children
// ###########################################################################

// const PendingVisitorsTag = '_pendingVisitors';

// function pushChildVisitors(path, children) {
//   if (!children) {
//     return;
//   }

//   for (const child of children) {
//     // const {childName, ...childCfg} = child;
//     const childPath = path.get(childName);

//     if (childPath.node) {
//       let pendingVisitors = childPath.getData(PendingVisitorsTag);
//       if (!pendingVisitors) {
//         childPath.setData(PendingVisitorsTag, pendingVisitors = []);
//       }
//       pendingVisitors.push(child);
//     }
//   }
// }

// function popVisitors(path, state) {
//   const children = path.getData(PendingVisitorsTag);
//   if (!children) {
//     return;
//   }

//   visitEnterAll(children);
// }

function visitChildren(visitFn, childCfgs, path, state) {
  for (const childCfg of childCfgs) {
    const { visitorName } = childCfg;
    if (path.node?.[visitorName]) {
      const childPath = path.get(visitorName);
      visitFn(childPath, state, childCfg);
    }
  }
}


function visitEnterAll(cfgNodes, path, state) {
  return visitChildren(visitEnter, cfgNodes, path, state);
}

function visitExitAll(cfgNodes, path, state) {
  return visitChildren(visitExit, cfgNodes, path, state);
}

// ###########################################################################
// visitors
// ###########################################################################

function visit(direction, onTrace, instrumentors, path, state, cfg) {
  const { instrumentationType, children, extraCfg } = cfg;
  if (extraCfg?.ignore?.includes(path.node.type)) {
    // ignore (array of type name)
    return;
  }
  if (extraCfg?.filter && !extraCfg.filter(path, state, cfg)) {
    // filter (custom function)
    return;
  }

  if (!instrumentationType && !children) {
    return;
  }

  // mark as visited;
  const visitedBefore = !onTrace(path);

  // log
  logInst('V', cfg, path, direction, '--', visitedBefore);

  if (visitedBefore) return;

  if (direction === InstrumentationDirection.Enter) {
    // 1. instrument self
    instrumentPath(direction, instrumentationType, instrumentors, path, state, cfg);

    // 2. visit children
    children && visitEnterAll(children, path, state);
  }
  else {
    // 1. visit children
    children && visitExitAll(children, path, state);

    // 2. instrument self
    instrumentPath(direction, instrumentationType, instrumentors, path, state, cfg);
  }
}

function instrumentPath(direction, instrumentationType, instrumentors, path, state, cfg) {
  if (instrumentationType) {
    const instrumentationTypeName = TraceInstrumentationType.nameFromForce(instrumentationType);
    // if (!instrumentors[traceTypeName]) {
    //   err('instrumentors are missing TraceType:', traceTypeName);
    // }
    const instrumentor = instrumentors[instrumentationTypeName];
    if (instrumentor) {
      // NOTE: a TraceType might not have an instrumentor both on `Enter` as well as `Exit`

      // log
      logInst('I', cfg, path, direction);

      if (!(instrumentor instanceof Function)) {
        logError('instrumentor is not a function:', instrumentationTypeName, '-', instrumentor);
        return;
      }
      const originalPath = instrumentor(path, state, cfg.extraCfg);
      if (originalPath) {
        path = originalPath;
      }
    }
  }
}

function visitEnter(path, state, visitorCfg) {
  return visit(InstrumentationDirection.Enter, state.onTrace.bind(state), enterInstrumentors, path, state, visitorCfg);
}
function visitExit(path, state, visitorCfg) {
  return visit(InstrumentationDirection.Exit, state.onTraceExit.bind(state), exitInstrumentors, path, state, visitorCfg);
}


// ###########################################################################
// utilities
// ###########################################################################

// function err(message, obj) {
//   throw new Error(message + (obj && (' - ' + JSON.stringify(obj)) || ''));
// }

function _getFullName(cfg) {
  const { parentCfg,
    // instrumentationType,
    visitorName
  } = cfg;
  // const baseInstrumentationType = parentCfg?.instrumentationType || instrumentationType;
  // const baseName = TraceInstrumentationType.nameFromForce(baseInstrumentationType);
  if (parentCfg) {
    return `${_getFullName(parentCfg)}.${visitorName}`;
  }
  return visitorName;
}

function logInst(tag, cfg, path, direction = null, ...other) {
  if (!Verbose) {
    return;
  }
  const nodeName = getNodeNames(path.node)?.name;
  const cfgName = _getFullName(cfg);
  const dirIndicator = direction && direction === InstrumentationDirection.Enter ? ' ->' : ' <-';
  console.debug(
    `[${tag}]${dirIndicator || ''}`,
    nodeName && `${path.node.type} ${nodeName}` || path.toString(),
    ':',
    cfgName,
    // TraceInstrumentationType.nameFromForce(instrumentationType),
    ...other
  );
}

// ###########################################################################
// buildTraceVisitors
// ###########################################################################

let _cfg;
export function buildTraceVisitors() {
  const visitors = {};
  if (!_cfg) {
    _cfg = normalizeConfig(traceCfg);
  }

  for (const visitorName in _cfg) {
    const visitorCfg = _cfg[visitorName];
    visitors[visitorName] = {
      enter(path, state) {
        // if (path.getData()) {
        //   visit(state.onTrace.bind(state), enterInstrumentors, path, state, visitorCfg)
        // }
        visitEnter(path, state, visitorCfg);
      },

      exit(path, state) {
        visitExit(path, state, visitorCfg);
      }
    };
  }
  return visitors;
}