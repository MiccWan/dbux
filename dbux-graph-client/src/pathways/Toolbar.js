import ThemeMode from '@dbux/graph-common/src/shared/ThemeMode';
import { compileHtmlElement, decorateClasses, decorateAttr } from '../util/domUtil';
import ClientComponentEndpoint from '../componentLib/ClientComponentEndpoint';

let documentClickHandler;

class Toolbar extends ClientComponentEndpoint {
  // ###########################################################################
  // createEl
  // ###########################################################################
  createEl() {
    // return compileHtmlElement(/*html*/`<div></div>`);
    return compileHtmlElement(/*html*/`
      <nav class="navbar navbar-expand-lg no-padding" id="toolbar">
        <div class="btn-group btn-group-toggle" data-toggle="buttons">
          <button title="" data-el="hideNewRunBtn" class="btn btn-info" href="#">
            hi
          </button>
        </div>
        <div data-el="moreMenu" class="dropdown">
          <button data-el="moreMenuBtn" class="btn btn-secondary dropdown-toggle" type="button" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
            ☰
          </button>
          <div data-el="moreMenuBody" class="dropdown-menu" 
          style="left: inherit; right: 0; min-width: 0;"
          aria-labelledby="dropdownMenuButton">
            <!--button data-el="showIdsBtn" class="btn btn-info full-width" href="#">ids</button-->
            <div class="dropdown-divider"></div>
            <button title="Restart the Webview (can eliviate some bugs)" data-el="restartBtn" class="btn btn-danger full-width" href="#">Restart</button>
          </div>
        </div>
      </nav>
    `);
  }

  setupEl() {
    
  }

  toggleMenu() {
    this.dropDownOpen = !this.dropDownOpen;
    if (this.dropDownOpen) {
      this.els.moreMenuBody.style.display = 'inherit';
    }
    else {
      this.els.moreMenuBody.style.display = 'none';
    }
  }

  // ###########################################################################
  // update
  // ###########################################################################

  update = () => {
    
  }

  // ###########################################################################
  // event listeners
  // ###########################################################################

  on = {
    restartBtn: {
      async click(evt) {
        evt.preventDefault();

        if (await this.app.confirm('Do you really want to restart?')) {
          this.componentManager.restart();
        }
      },

      focus(evt) { evt.target.blur(); }
    },

    moreMenuBtn: {
      click(/* evt */) {
        this.toggleMenu();
      },
      focus(evt) { evt.target.blur(); }
    }
  }
}

export default Toolbar;