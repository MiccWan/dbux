import getOrCreateProgressLog from './dataLib';
import processLogHandler from './dataLib/progressLog';
import caseStudyRegistry from './_projectRegistry';
import ProjectList from './projectLib/ProjectList';
import BugRunner from './projectLib/BugRunner';

class ProjectsManager {
  config;
  externals;
  projects;
  runner;

  constructor(cfg, externals) {
    this.config = cfg;
    this.externals = externals;
    this.editor = externals.editor;
    this.progressLog = getOrCreateProgressLog(externals.storage);
  }

  /**
   * Retrieves all case study objects, 
   * sorted by name (in descending order).
   */
  getOrCreateDefaultProjectList() {
    if (!this.projects) {
      // fix up names
      for (const name in caseStudyRegistry) {
        const Clazz = caseStudyRegistry[name];

        // NOTE: function/class names might get mangled by Webpack (or other bundlers/tools)
        Clazz.constructorName = name;
      }

      // sort all classes by name
      const classes = Object.values(caseStudyRegistry);
      classes.sort((a, b) => {
        const nameA = a.constructorName.toLowerCase();
        const nameB = b.constructorName.toLowerCase();
        return nameB.localeCompare(nameA);
      });

      // build + return ProjectList
      const list = new ProjectList(this);
      list.add(...classes.map(ProjectClazz =>
        new ProjectClazz(this)
      ));

      this.projects = list;
    }

    return this.projects;
  }

  getOrCreateRunner() {
    if (!this.runner) {
      const runner = this.runner = new BugRunner(this, this.progressLog);
      runner.start();
    }
    return this.runner;
  }

  async saveRunningBug(bug) {
    let patchString = await bug.project.getPatchString();
    if (patchString) {
      // TODO: prompt? or something else
      processLogHandler.processUnfinishTestRun(this.progressLog, bug, patchString);
    }
  }

  async applyNewBugPatch(bug) {
    let testRuns = processLogHandler.getTestRunsByBug(this.progressLog, bug);
    let testRun = testRuns.reduce((a, b) => {
      if (!a) {
        return b;
      }
      return a.createAt > b.createAt ? a : b;
    }, undefined);
    let patchString = testRun?.patch;

    if (patchString) {
      try {
        await bug.project.applyPatchString(patchString);
        return true;
      } catch (err) {
        let keepRunning = await this.externals.showMessage.showWarningMessage(`Failed when applying previous progress of this bug.`, {
          'Show diff in new tab and cancel': () => {
            this.externals.editor.showTextInNewFile(`diff.diff`, patchString);
            return false;
          },
          'Ignore and keep running': () => {
            return true;
          },
        }, { modal: true });
        return keepRunning;
      }
    } else {
      return true;
    }
  }

  async installDependencies() {
    const { projectsRoot } = this.config;

    if (process.env.NODE_ENV === 'production') {
      // TODO: install dbux dependencies + their dependencies

      // _dbux_run.js requires socket.io-client -> install in projects/ root
      //    NOTE: this will be taken care of by installing above dependencies automatically (because runtime also depends on `socket.io-client`)
      await this.runner._exec(this, `yarn add socket.io-client@2.3.0`, {
        processOptions: {
          cwd: projectsRoot
        }
      });
    }
  }
}

export default ProjectsManager;