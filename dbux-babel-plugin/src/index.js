import programVisitor, { allOtherVisitors } from './programVisitor';
import '../../dbux-common/src/util/prettyLogs';
import errorWrapVisitor from './helpers/errorWrapVisitor';
// import { logInternalError } from './log/logger';

export default function dbuxBabelPlugin() {
  return {
    visitor: errorWrapVisitor({
      Program: programVisitor(),

      // ...allOtherVisitors()
    })
  };
}