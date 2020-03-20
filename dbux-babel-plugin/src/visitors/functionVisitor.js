import template from '@babel/template';
import * as t from "@babel/types";
import TraceType from 'dbux-common/src/core/constants/TraceType';
import VarOwnerType from 'dbux-common/src/core/constants/VarOwnerType';
import { guessFunctionName, getFunctionDisplayName } from '../helpers/functionHelpers';
import { buildWrapTryFinally, buildSource, buildBlock } from '../helpers/builders';
import { getPreBodyLoc1D } from '../helpers/locHelpers';

// ###########################################################################
// helpers
// ###########################################################################

function addResumeContext(bodyPath, state, staticId) {
  const { loc: bodyLoc } = bodyPath.node;

  // the "resume context" starts with the function (function is in "Resumed" state initially)
  const locStart = bodyLoc.start;
  return state.contexts.addResumeContext(bodyPath, locStart);
}

// ###########################################################################
// builders + templates
// ###########################################################################

function buildPushImmediate(contextId, dbux, staticId, traceId, isInterruptable) {
  // TODO: use @babel/template instead
  return buildSource(`var ${contextId} = ${dbux}.pushImmediate(${staticId}, ${traceId}, ${isInterruptable});`);
}

function buildPopImmediate(contextId, dbux, traceId) {
  // TODO: use @babel/template instead
  return buildSource(`${dbux}.popImmediate(${contextId}, ${traceId});`);
}

const pushResumeTemplate = template(
  /*var %%resumeContextId%% =*/
  `%%dbux%%.pushResume(%%resumeStaticContextId%%, %%traceId%%);`);

const popResumeTemplate = template(
  // `%%dbux%%.popResume(%%resumeContextId%%);`
  `%%dbux%%.popResume();`
);

// ###########################################################################
// modification
// ###########################################################################

/**
 * Instrument all Functions to keep track of all (possibly async) execution stacks.
 */
function wrapFunctionBody(bodyPath, state, staticId, pushTraceId, popTraceId, staticResumeId = null) {
  const { ids: { dbux }, contexts: { genContextIdName } } = state;
  const contextIdVar = genContextIdName(bodyPath);

  let pushes = buildPushImmediate(contextIdVar, dbux, staticId, pushTraceId, !!staticResumeId);
  let pops = buildPopImmediate(contextIdVar, dbux, popTraceId);
  if (staticResumeId) {
    // this is an interruptable function -> push + pop "resume contexts"
    // const resumeContextId = bodyPath.scope.generateUid('resumeContextId');
    pushes = [
      ...pushes,
      pushResumeTemplate({
        dbux,
        // resumeContextId,
        resumeStaticContextId: t.numericLiteral(staticResumeId),
        traceId: t.numericLiteral(pushTraceId)
      })
    ];

    pops = [
      popResumeTemplate({
        dbux,
        // resumeContextId,
        // traceId: t.numericLiteral(popTraceId)
        // contextId: contextIdVar
      }),
      ...pops
    ];
  }

  let body = bodyPath.node;
  if (!Array.isArray(bodyPath.node) && !t.isStatement(bodyPath.node)) {
    // simple lambda expression -> convert to block lambda expression with return statement
    body = t.blockStatement([t.returnStatement(bodyPath.node)]);
  }

  // wrap the function in a try/finally statement
  bodyPath.replaceWith(buildBlock([
    ...pushes,
    buildWrapTryFinally(body, pops)
  ]));
}

// ###########################################################################
// visitor
// ###########################################################################

export default function functionVisitor() {
  return {
    enter(path, state) {
      if (!state.onEnter(path, 'context')) return;
      // console.warn('F', path.toString());

      const name = guessFunctionName(path, state);
      const displayName = getFunctionDisplayName(path, state, name);
      const isGenerator = path.node.generator;
      const isAsync = path.node.async;
      const isInterruptable = isGenerator || isAsync;
      const bodyPath = path.get('body');

      const staticContextData = {
        type: 2, // {StaticContextType}
        name,
        displayName,
        isInterruptable
      };
      const staticId = state.contexts.addStaticContext(path, staticContextData);
      const pushTraceId = state.traces.addTrace(bodyPath, TraceType.PushImmediate);
      const popTraceId = state.traces.addTrace(bodyPath, TraceType.PopImmediate);

      // add varAccess
      const ownerId = staticId;
      
      // TODO: this?
      // state.varAccess.addVarAccess(path, ownerId, VarOwnerType.Context, 'this', false);

      // see: https://github.com/babel/babel/tree/master/packages/babel-traverse/src/path/lib/virtual-types.js
      const params = path.get('params');
      const paramIds = params.map(param => 
        Object.values(param.getBindingIdentifierPaths())
      ).flat();
      paramIds.forEach(paramPath => 
        state.varAccess.addVarAccess(
          paramPath.name, paramPath, ownerId, VarOwnerType.Trace
        )
      );

      let staticResumeId;
      if (isInterruptable) {
        staticResumeId = addResumeContext(bodyPath, state, staticId);
      }

      wrapFunctionBody(bodyPath, state, staticId, pushTraceId, popTraceId, staticResumeId);
    }
  };
}