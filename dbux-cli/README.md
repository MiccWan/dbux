`@dbux/cli` is a command line interface for DBUX instrumentation.
`@dbux/cli` to DBUX is like [`nyc`](https://github.com/istanbuljs/nyc) to `istanbul` (albeit not as mature in development quite yet).

The cli injects `@dbux/runtime` upon `import` of any `js` file. As it executs, the runtime records all kinds of execution data, and automatically connects and sends the data to a server at a hardcoded port. Currently, the receiving server is hosted by the `dbux-code` VSCode extension. Without that extension, `@dbux/cli` (as of now) probably won't be of much use to you.

# Installation

* `npm i -D @dbux/cli` or:
* `yarn add --dev @dbux/cli`


# Usage
The CLI currently supports two commands: [`run`](#run) and [`instrument`](#instrument) ([code here](src/commands)).

They share [these command options](src/util/commandCommons.js).

## Run

* Usage: `npx dbux run app.js`
* Alias: `npx dbux r ...`

Run some JavaScript application with DBUX enabled.

* `npx dbux r someFile.js`

You can enable babel to add all kinds `esnext` syntax proposals enabled with the `--esnext` flag.

Examples:

* Run a `mocha` test `myTest.js`: `node --stack-trace-limit=100 --enable-source-maps "node_modules/@dbux/cli/bin/dbux.js" run --verbose=1 --esnext node_modules/mocha/bin/_mocha -- --no-exit -- myTest.js`
   * Custom `node` options (`--stack-trace-limit=100 --enable-source-maps`)
   * Custom `dbux` options (`--verbose=1 --esnext`)
   * Custom `mocha` options (`--no-exit`; between the two `--`'s)

## Instrument (i)

* Usage: `npx dbux instrument app.js`
* Alias: `npx dbux i ...`

This is more for internal development purposes. It allows you to look at the effective code after instrumentation.

Examples:

* Show instrumented code result in VSCode: `npx dbux i someFile.js | code -`



# Files

In addition to the `src` and `dist` folders, it contains a `lib` folder which contains some scripts that are used in several command line utilitiies throughout the project structure (mostly in `webpack.config`s and `publish.js`) and do not require babel'ing.


# Caveats

* `@dbux/cli` is slow
   * [Read more about performance considerations here](https://github.com/Domiii/dbux/tree/master/#performance).
* When using `@dbux/cli` with `--esnext`, it sometimes cannot find Babel plugins.
   * To make things easier to use it uses `module-alias` to alias all it's own dependencies (see [`linkOwnDependencies.js`](src/linkOwnDependencies.js))
   * Internally, `module-alias` [overwrites ` Module._resolveFilename`](https://github.com/ilearnio/ module-alias/blob/dev/index.js#L29)
   * However, Babel's own plugin resolution ignores that (because it uses [browserify/resolve](https://github.com/browserify/resolve/blob/master/lib/sync.js#L95) which apparently does not care about aliases)
   * Meaning that when using `--esnext`, babel plugins cannot be found and, must either be installed or linked to a local `node_modules` folder in `cwd` or any of its parent directories.