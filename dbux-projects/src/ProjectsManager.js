import path from 'path';
import fs from 'fs';
import sh from 'shelljs';
import { newLogger } from '@dbux/common/src/log/logger';
import caseStudyRegistry from './_projectRegistry';
import ProjectList from './projectLib/ProjectList';
import BugRunner from './projectLib/BugRunner';
import ProgressLogController from './dataLib/ProgressLogController';
import PracticeSession from './practiceSession/PracticeSession';
import PracticeSessionState from './practiceSession/PracticeSessionState';
import RunStatus from './projectLib/RunStatus';
import BugStatus, { isPracticingTypes } from './dataLib/BugStatus';
import BackendController from './backend/BackendController';


const logger = newLogger('PracticeManager');
const { debug, log } = logger;

const activatedBugKeyName = 'dbux.dbux-projects.activatedBug';

/** @typedef {import('./projectLib/Project').default} Project */
/** @typedef {import('./projectLib/Bug').default} Bug */
/** @typedef {import('./externals/Storage').default} ExternalStorage */

export default class ProjectsManager {
  /**
   * @type {PracticeSession}
   */
  practiceSession
  /**
   * @type {ProjectList}
   */
  projects;
  /**
   * @type {BugRunner}
   */
  runner;
  _backend;

  /**
   * @param {Object} externals 
   * @param {ExternalStorage} externals.storage
   */
  constructor(cfg, externals) {
    this.config = cfg;
    this.externals = externals;
    this.editor = externals.editor;
    this.practiceSession = null;
    this.runner = new BugRunner(this);
    this.runner.start();

    this.progressLogController = new ProgressLogController(externals.storage);
  }

  async getOrInitBackend() {
    // lazy initialize
    if (!this._backend) {
      this._backend = new BackendController(this);
      await this._backend.init();
    }
    return this._backend;
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

  // ###########################################################################
  // practice flow management
  // ###########################################################################

  /**
   * Currently the only public function to user
   * NOTE: should handle practice flow carefully
   * @param {Bug} bug 
   * @param {boolean} debugMode 
   */
  async activateBug(bug, debugMode = false) {
    if (this.practiceSession) {
      if (this.practiceSession.bug === bug) {
        // re-active same bug
        const result = await this._activateBug(bug, debugMode);
        await this.progressLogController.util.processBugRunResult(bug, result);
        if (result === 0) {
          // user passed all test
          this.practiceSession.setState(PracticeSessionState.Solved);
          this._saveAndClearPracticeSession();
          this.askForSubmit();
        }
        else {
          // some test failed
          this.externals.alert(`[Dbux] ${result} test(s) failed. Try again!`);
          await bug.openInEditor();
        }
      }
      else {
        // already a practice session, ask to stop first
        const projectName = this.practiceSession.project.name;
        const bugId = this.practiceSession.bug.id;
        const confirmMsg = `You are currently practicing ${projectName}#${bugId}, save and quit?`;
        const confirmResult = await this.externals.confirm(confirmMsg, true);
        if (confirmResult) {
          await this.stopPracticeSession();
          this.externals.showMessage.info('Practice session quitted');
        }
        else {
          return;
        }
      }
    }

    const bugProgress = this.progressLogController.util.getBugProgressByBug(bug);
    if (!bugProgress || BugStatus.is.None(bugProgress.status)) {
      // first time start it, ask to start timer
      const confirmMsg = `This is your first time activate this bug, do you want to start a timer?\n`
        + `Warning: You will not be able to time this bug once you activate it.`;
      const confirmResult = await this.externals.confirm(confirmMsg, false);
      if (confirmResult) {
        this._createPracticeSession(bug, debugMode);
      }
      else if (!bugProgress) {
        this.progressLogController.util.addNewBugProgress(bug, BugStatus.ActivatedWithoutTimer);
      }
      else {
        this._activateBug(bug, debugMode);
        const update = { status: BugStatus.ActivatedWithoutTimer };
        this.progressLogController.util.updateBugProgress(bug, update);
      }
    }
    else {
      const { status } = bugProgress;
      if (isPracticingTypes(status)) {
        // already practicing, keep going on
        this.practiceSession = await this._createPracticeSession(bug, debugMode);
      }
      else {
        // no need to start timer
        this._activateBug(bug, debugMode);
      }
    }
  }

  async stopPracticeSession() {
    await this.runner.cancel();
    this._saveAndClearPracticeSession();
  }

  /**
   * Starts a practice session and activate the bug once, promise resolve after all is done
   * @param {Bug} bug 
   */
  async _createPracticeSession(bug, debugMode) {
    // load existing bugProgress
    let bugProgress = this.progressLogController.util.getBugProgressByBug(bug);
    if (!bugProgress) {
      bugProgress = this.progressLogController.util.addNewBugProgress(bug, BugStatus.Solving);
    }
    else if (BugStatus.is.ActivatedWithoutTimer(bugProgress.status)) {
      throw new Error('Trying to create practiceSession without timer enabled');
    }

    const { project } = bug;
    const practiceSession = new PracticeSession(project, bug);
    practiceSession.setState(PracticeSessionState.Activating);

    // activate once to show user the bug, don't care about the result
    await this._activateBug(bug, debugMode);

    practiceSession.setState(PracticeSessionState.Solving);

    practiceSession.setStopwatch(bugProgress.timePassed);
    this.practiceSession.startStopwatch();

    return practiceSession;
  }

  /**
   * Save timer time to BugProgress and clear practice session
   */
  async _saveAndClearPracticeSession() {
    if (!this.practiceSession) {
      return;
    }

    const timePassed = this.practiceSession.stopStopwatch();

    const { bug } = this.practiceSession;
    const update = { timePassed };
    this.progressLogController.util.updateBugProgress(bug, update);
    await this.progressLogController.save();

    this.practiceSession = null;
  }

  /**
   * Install and run a bug, then save testRun after result
   * NOTE: Only used internally to manage practice flow
   * @param {Bug} bug 
   */
  async _activateBug(bug, debugMode) {
    const previousBug = this.getPreviousBug();

    // if some bug are already activated, save the changes
    if (bug !== previousBug) {
      if (previousBug) {
        await this.saveFileChanges(previousBug);
        await previousBug.project.gitResetHard();
      }

      await this.updateActivatingBug(bug);
    }

    // install things
    await this.runner.activateBug(bug);

    // apply stored patch
    if (bug !== previousBug) {
      try {
        await this.applyNewBugPatch(bug);
      } catch (err) {
        const keepRunning = await this.externals.showMessage.warning(`Failed when applying previous progress of this bug.`, {
          'Show diff in new tab and cancel': () => {
            this.externals.editor.showTextInNewFile(`diff.diff`, err.patchString);
            return false;
          },
          'Ignore and keep running': () => {
            return true;
          },
        }, { modal: true });

        if (!keepRunning) {
          throw err;
        }
      }
    }

    // NOTE: --enable-source-maps gets very slow in nolazy mode
    // NOTE2: nolazy is required for proper breakpoints in debug mode
    const nodeArgs = `--stack-trace-limit=100 ${debugMode ? '--nolazy' : '--enable-source-maps'}`;
    const cfg = {
      debugMode,
      nodeArgs,
      dbuxArgs: '--verbose=1'
    };

    const result = await this.runner.testBug(bug, cfg);

    return result;
  }

  async askForSubmit() {
    const confirmString = 'Congratulations!! You have passed all test 🎉🎉🎉\nWould you like to submit the result?';
    const shouldSubmit = await this.externals.confirm(confirmString);

    if (shouldSubmit) {
      this.submit();
    }
  }

  /**
   * Record the practice session data after user passed all tests.
   */
  submit() {
    // TODO: maybe a new data type? or submit remotely?
  }

  /**
   * Saves any changes in current active project as patch of bug
   * @param {Bug} bug 
   */
  async saveFileChanges(bug) {
    const patchString = await bug.project.getPatchString();
    if (patchString) {
      await this.progressLogController.util.addUnfinishedTestRun(bug, patchString);
      await this.progressLogController.save();
    }
  }

  /**
   * @param {Bug} bug 
   */
  async resetBug(bug) {
    await bug.project.gitResetHard(true, 'This will discard all your changes on this bug.');
    await this.progressLogController.util.addUnfinishedTestRun(bug, '');
    await this.progressLogController.save();
  }

  /**
   * Apply the newest patch in testRuns
   * @param {Bug} bug
   */
  async applyNewBugPatch(bug) {
    let testRuns = this.progressLogController.util.getTestRunsByBug(bug);
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
      }
      catch (err) {
        err.patchString = patchString;
        throw err;
      }
    }
  }

  // ###########################################################################
  // BugRunner interface
  // ###########################################################################

  async stopRunner() {
    await this.runner.cancel();
  }

  // ###########################################################################
  // Project/Bug run status getter
  // ###########################################################################

  /**
   * @param {Project} project 
   */
  getProjectRunStatus(project) {
    if (this.runner.isProjectActive(project)) {
      return this.runner.status;
    }
    else {
      return RunStatus.None;
    }
  }

  /**
   * @param {Bug} bug 
   */
  getBugRunStatus(bug) {
    if (this.runner.isBugActive(bug)) {
      return this.runner.status;
    }
    else {
      return RunStatus.None;
    }
  }

  onRunStatusChanged(cb) {
    return this.runner.onStatusChanged(cb);
  }

  getDevPackageRoot() {
    // NOTE: __dirname is actually "..../dbux-code/dist", because of webpack
    return fs.realpathSync(path.join(__dirname, '..', '..'));
  }

  // _convertPkgToLocalIfNecessary(pkgName, version = null) {
  //   // NOTE: only dbux packages are available locally
  //   const packageRoot = this.getDevPackageRoot();

  //   if (process.env.NODE_ENV === 'development') {
  //     const match = pkgName.match(/@dbux\/(.+)/);
  //     if (match) {
  //       // available locally
  //       return `file://${packageRoot}/dbux-${match[1]}`;
  //     }
  //   }
  //   if (!version) {
  //     throw new Error('no version given for package: ' + pkgName);
  //   }
  //   return `${pkgName}@${version}`;
  // }

  // _readLocalPkgDeps(pkgFolder, ...depNames) {
  //   const pkg = readPackageJson(pkgFolder);
  //   let deps;
  //   if (depNames.length) {
  //     deps = pick(pkg.dependencies, depNames);
  //     if (size(deps) !== depNames.length) {
  //       throw new Error(`Could not read (some subset of the following) local package dependencies: ${depNames.join(', ')}`);
  //     }
  //   }
  //   else {
  //     deps = pkg.dependencies;
  //   }
  //   return Object.
  //     entries(deps).
  //     map(([pkgName, version]) => `${this._convertPkgToLocalIfNecessary(pkgName, version)}`);
  // }

  getDbuxCliBinPath() {
    const { dependencyRoot } = this.config;
    return path.join(dependencyRoot, 'node_modules/@dbux/cli/bin/dbux.js');
  }

  // ###########################################################################
  // Activating Bug saves
  // ###########################################################################

  /**
   * @return {Bug}
   */
  getPreviousBug() {
    const previousBugInformation = this.externals.storage.get(activatedBugKeyName);

    if (previousBugInformation) {
      const { projectName, bugId } = previousBugInformation;
      const previousProject = this.getOrCreateDefaultProjectList().getByName(projectName);

      if (previousProject.isProjectFolderExists()) {
        return previousProject.getOrLoadBugs().getById(bugId);
      }
    }
    return null;
  }

  /**
   * @param {Bug} bug 
   */
  async updateActivatingBug(bug) {
    await this.externals.storage.set(activatedBugKeyName, {
      projectName: bug.project.name,
      bugId: bug.id,
    });
  }


  // ###########################################################################
  // Dependency Management
  // ###########################################################################

  _sharedDependencyNames = [
    // NOTE: npm flattens dependency tree by default, and other important dependencies are dependencies of @dbux/cli
    '@dbux/cli'
  ];

  async installDependencies() {
    await this.installDbuxDependencies();
  }

  isInstallingSharedDependencies() {
    return !!this._installPromise;
  }

  hasInstalledSharedDependencies() {
    return this.areDependenciesInstalled(this._sharedDependencyNames);
  }

  areDependenciesInstalled(deps) {
    return deps.every(this.isDependencyInstalled);
  }

  isDependencyInstalled = (qualifiedDependencyName) => {
    // TODO: check correct version?
    //    should not be necessary for the VSCode extension because it will create a new extension folder for every version update anyway

    // get name without version
    const name = qualifiedDependencyName.match('(@?[^@]+)(?:@.*)?')[1];
    if (process.env.NODE_ENV === 'development') {
      if (name.startsWith('@dbux/')) {
        // NOTE: in development mode, we have @dbux dependencies (and their dependencies) all linked up to the monoroot folder anyway
        // NOTE: we need to short-circuit this for when we run the packaged extension in dev mode
        return true;
      }
    }
    const { dependencyRoot } = this.config;
    return sh.test('-d', path.join(dependencyRoot, 'node_modules', name));
  }

  async installDbuxDependencies() {
    // set correct version
    if (!process.env.DBUX_VERSION) {
      throw new Error('installDbuxDependencies() failed. DBUX_VERSION was not set.');
    }

    const deps = this._sharedDependencyNames.map(dep => `${dep}@${process.env.DBUX_VERSION}`);
    await this.installModules(deps);
  }

  async installModules(deps) {
    await this._installPromise;
    return (this._installPromise = this._doInstallModules(deps));
  }

  async _doInstallModules(deps) {
    try {
      const { dependencyRoot } = this.config;
      const execOptions = {
        processOptions: {
          cwd: dependencyRoot
        }
      };
      const rootPackageJson = path.join(dependencyRoot, 'package.json');
      if (!sh.test('-f', rootPackageJson)) {
        // make sure, we have a local `package.json`
        await this.runner._exec('npm init -y', logger, execOptions);
      }
      else if (this.areDependenciesInstalled(deps)) {
        // already done!
        return;
      }

      // delete previously installed node_modules
      // NOTE: if we don't do it, we (sometimes randomly) bump against https://github.com/npm/npm/issues/13528#issuecomment-380201967
      // await sh.rm('-rf', path.join(projectsRoot, 'node_modules'));

      // debug(`Verifying NPM cache. This might (or might not) take a while...`);
      // await this.runner._exec('npm cache verify', logger, execOptions);

      this.externals.showMessage.info(`Installing dependencies: "${deps.join(', ')}" This might (or might not) take a while...`);

      const command = `npm install --only=prod && npm i ${deps.join(' ')}`;
      // await this.runner._exec(command, logger, execOptions);
      await this.execInTerminal(dependencyRoot, command);

      // else {
      //   // we need socket.io for TerminalWrapper. Its version should match dbux-runtime's.
      //   // const pkgPath = path.join(__dirname, '..', '..', '..', 'dbux-runtime');

      //   const packageRoot = process.env.DBUX_ROOT;
      //   const cliPath = path.join(packageRoot, 'dbux-cli');
      //   const cliDeps = this._readLocalPkgDeps(cliPath);

      //   const runtimePath = path.join(packageRoot, 'dbux-runtime');
      //   const socketIoDeps = this._readLocalPkgDeps(runtimePath, 'socket.io-client');
      //   // const socketIoVersion = pkg?.dependencies?.[socketIoName]; // ?.match(/\d+\.\d+.\d+/)?.[0];

      //   // if (!socketIoVersion) {
      //   //   throw new Error(`'Could not retrieve version of ${socketIoName} in "${runtimePath}"`);
      //   // }

      //   allDeps = [
      //     // NOTE: installing local refs actually *copies* them. We don't want that.
      //     // we will use `module-alias` in `_dbux_inject.js` instead
      //     // this._convertPkgToLocalIfNecessary('@dbux/cli'),
      //     ...cliDeps.filter(dep => !dep.includes('dbux-')),
      //     ...socketIoDeps
      //   ];

      //   // NOTE: `link-module-alias` can cause problems. See: https://github.com/Rush/link-module-alias/issues/3
      //   // // add dbux deps via `link-module-alias`
      //   // const dbuxDeps = [
      //   //   'common',
      //   //   'cli',
      //   //   'babel-plugin',
      //   //   'runtime'
      //   // ];
      //   // let pkg = readPackageJson(projectsRoot);
      //   // pkg = {
      //   //   ...pkg,
      //   //   script: {
      //   //     postinstall: "npx link-module-alias"
      //   //   },
      //   //   _moduleAliases: Object.fromEntries(
      //   //     dbuxDeps.map(name => [`@dbux/${name}`, `../dbux/dbux-${name}`])
      //   //   )
      //   // };

      //   // await this.runner._exec(`npm i --save link-module-alias`, logger, execOptions);
      //   // writePackageJson(projectsRoot, pkg);
      //   await this.runner._exec(`npm i --save ${allDeps.join(' ')}`, logger, execOptions);
      // }
    }
    finally {
      this._installPromise = null;
    }
  }

  // ###########################################################################
  // utilities
  // ###########################################################################

  async execInTerminal(cwd, command, args) {
    try {
      this._terminalWrapper = this.externals.TerminalWrapper.execInTerminal(cwd, command, args);
      return await this._terminalWrapper.waitForResult();
    }
    finally {
      this._terminalWrapper?.cancel();
      this._terminalWrapper = null;
    }
  }
}