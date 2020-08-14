import NanoEvents from 'nanoevents';
import { makeDebounce } from '@dbux/common/src/util/scheduling';
import HostComponentEndpoint from '../../componentLib/HostComponentEndpoint';

export default class HighlightManager extends HostComponentEndpoint {
  init() {
    this.state.highlightAmount = 0;
    this.allHighlighter = new Set();
    this._emitter = new NanoEvents();
  }

  registHighlight(highlighter, newState) {
    if (newState === 1) this.allHighlighter.add(highlighter);
    else this.allHighlighter.delete(highlighter);

    this._highlighterUpdated(newState);
  }

  clear() {
    this.allHighlighter.forEach((highlighter) => highlighter.clear());
    this._emitter.emit('clear', this.allHighlighter);
  }

  on(eventName, cb) {
    this._emitter.on(eventName, cb);
  }

  _highlighterUpdated = makeDebounce((newState) => {
    this.setState({
      highlightAmount: this.state.highlightAmount + newState
    });
  }, 50);
}