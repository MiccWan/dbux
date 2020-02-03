import {
  Disposable,
  workspace,
  window,
  OverviewRulerLane,
  DecorationOptions,
  Range,
  TextEditor
} from 'vscode';


import { makeDebounce } from 'dbux-common/src/util/scheduling';
import EventHandlerList from 'dbux-common/src/util/EventHandlerList';
import { newLogger } from 'dbux-common/src/log/logger';
import applicationCollection from 'dbux-data/src/applicationCollection';
import { initTraceDecorators, renderTraceDecorations } from './traceDecorators';
// import DataProvider from 'dbux-data/src/DataProvider';
// import StaticContextType from 'dbux-common/src/core/constants/StaticContextType';

const { log, debug, warn, error: logError } = newLogger('code-deco');

let activeEditor: TextEditor;
const appEventHandlers = new EventHandlerList();


// ###########################################################################
// render
// ###########################################################################

const renderDecorations = makeDebounce(function renderDecorations() {
  if (!activeEditor) {
    return;
  }

  const fpath = activeEditor.document.uri.fsPath;

  // render traces
  renderTraceDecorations(activeEditor, fpath);
});


// ###########################################################################
// init
// ###########################################################################

/**
 * Relevant VSCode API (https://code.visualstudio.com/api/references/vscode-api):
 *  DecorationRenderOptions
 *  DocumentHighlight
 *  DocumentLinkProvider
 *  DocumentRangeFormattingEditProvider
 * 
 */
export function initCodeDeco(context) {
  // init traces
  initTraceDecorators();

  // start rendering
  activeEditor = window.activeTextEditor;

  if (applicationCollection.hasSelectedApplications() && activeEditor) {
    // initial render
    renderDecorations();
  }

  // ########################################
  // register event listeners
  // ########################################

  // data changed
  applicationCollection.onSelectionChanged((selectedApps) => {
    appEventHandlers.unsubscribe();
    for (const app of selectedApps) {
      appEventHandlers.subscribe(
        app.dataProvider.onData('traces', renderDecorations),
        app.dataProvider.onData('staticTraces', renderDecorations)
      );
    }
  });

  // active window changed
  window.onDidChangeActiveTextEditor(editor => {
    activeEditor = editor;
    if (editor) {
      renderDecorations();
    }
  }, null, context.subscriptions);

  // text content changed?
  // workspace.onDidChangeTextDocument(event => {
  //   if (activeEditor && event.document === activeEditor.document) {
  //     renderDecorations();
  //   }
  // }, null, context.subscriptions);
}
