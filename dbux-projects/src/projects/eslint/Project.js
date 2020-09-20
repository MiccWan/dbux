import sh from 'shelljs';
import Project from '../../projectLib/Project';
import { buildMochaRunCommand } from '../../util/mochaUtil';


export default class EslintProject extends Project {
  gitRemote = 'BugsJS/eslint.git';

  packageManager = 'npm';

  nodeVersion = '7';

  async installDependencies() {
    const webpackJs = this.getWebpackJs();
    if (!sh.test('-f', webpackJs)) {
      await this.execInTerminal(`npm i -D webpack@4.41.5 webpack-cli@3.3.10 webpack-node-externals@2.5.0 string-replace-loader@2.3.0`);
    }

    // add "dist" folder to gitignore
    await this.exec('bash -c "echo ""dist"" >> .gitignore"');
  }

  loadBugs() {
    // TODO: load automatically from BugsJs bug database
    // NOTE: some bugs have multiple test files, or no test file at all
    // see: https://github.com/BugsJS/express/releases?after=Bug-4-test
    const bugs = [
      // see https://github.com/BugsJS/eslint/commit/e7839668c859752e5237c829ee2a1745625b7347
      {
        id: 1,
        testRe: '',
        testFilePaths: ['tests/lib/rules/no-obj-calls.js']
      }
    ];

    return bugs.
      map((bug) => {
        if (!bug.testFilePaths) {
          // bug not fully configured yet
          return null;
        }

        return {
          // id: i + 1,
          name: `bug #${bug.id}`,
          description: bug.testRe,
          runArgs: [
            '--grep',
            `"${bug.testRe}"`,
            '--',
            ...bug.testFilePaths,
            // eslint-disable-next-line max-len
            // 'tests/lib/rules/**/*.js tests/lib/*.js tests/templates/*.js tests/bin/**/*.js tests/lib/code-path-analysis/**/*.js tests/lib/config/**/*.js tests/lib/formatters/**/*.js tests/lib/internal-rules/**/*.js tests/lib/testers/**/*.js tests/lib/util/**/*.js'
          ],
          // require: ['test/support/env'],
          ...bug,
          // testFilePaths: bug.testFilePaths.map(p => `./${p}`)
        };
      }).
      filter(bug => !!bug);
  }

  getBugGitTag(bugId, tagCategory) {
    return `Bug-${bugId}-${tagCategory}`;
  }

  async selectBug(bug) {
    const {
      id, name
    } = bug;
    const tagCategory = "test"; // "test", "fix" or "full"
    const tag = this.getBugGitTag(id, tagCategory);

    if ((await this.getTagName()).startsWith(tag)) {
      // do not checkout bug, if we already on the right tag
      return;
    }

    // checkout the bug branch
    sh.cd(this.projectPath);
    this.log(`Checking out bug ${name || id}...`);

    // see: https://git-scm.com/docs/git-checkout#Documentation/git-checkout.txt-emgitcheckoutem-b-Bltnewbranchgtltstartpointgt
    await this.exec(`git checkout -B ${tag} tags/${tag}`);

    // `npm install` again (NOTE: the newly checked out tag might have different dependencies)
    await this.npmInstall();

    // Copy assets again in this branch
    await this.installAssets();

    // Auto commit again
    await this.autoCommit();
  }


  // ###########################################################################
  // run
  // ###########################################################################

  getWebpackJs() {
    return `${this.dependencyRoot}/node_modules/webpack/bin/webpack.js`;
  }

  async startWatchMode() {
    // start webpack using latest node (long-time support)
    return this.execBackground(`volta run --node lts node ${this.getWebpackJs()} --config ./webpack.config.dbux.js`);
  }

  async testBugCommand(bug, cfg) {
    const { projectPath } = this;
    const bugArgs = this.getMochaArgs(bug, [
      '-t 10000' // timeout
    ]);

    const mochaCfg = {
      cwd: projectPath,
      mochaArgs: bugArgs,
      require: bug.require,
      ...cfg
    };

    // TODO: fix watch mode
    // TODO: actual location - `dist/tests/lib/rules/no-obj-calls.js`
    // delete mochaCfg.dbuxJs; // no dbux -> run the test as-is


    return `cp ../../dbux-projects/assets/_shared_assets_/webpack.config.dbux.base.js webpack.config.dbux.base.js && \
    volta run --node lts node ../../node_modules/webpack/bin/webpack.js --config webpack.config.dbux.js && \
    node --stack-trace-limit=100  node_modules/mocha/bin/_mocha --no-exit -c -t 10000 --grep "" -- dist/tests/lib/rules/no-obj-calls.js`;

    // return await buildMochaRunCommand(mochaCfg);
  }
}