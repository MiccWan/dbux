import { v4 as uuidv4 } from 'uuid';
import { pathGetParent } from '@dbux/common/src/util/pathUtil';
import RuntimeDataProvider from '../RuntimeDataProvider';
import { newDataProvider } from '../dataProviderImpl';
import { getFileName } from '../util/nodeUtil';


/**
 * A user-run application, consisting of many `Program`s.
 * The first executed `Program` of an `Application` is its `entryPoint`
 */
export default class Application {
  /**
   * @type {number}
   * @readonly
   */
  applicationId;
  /**
   * @type {string}
   * @readonly
   */
  entryPointPath;
  /**
   * @readonly
   */
  allApplications;
  /**
   * @type {RuntimeDataProvider}
   * @readonly
   */
  dataProvider;
  /**
   * time of creation in milliseconds since vscode started
   * @type {number}
   */
  createdAt;
  /**
   * time of last update in milliseconds since vscode started
   * @type {number}
   */
  updatedAt;

  constructor(applicationId, entryPointPath, createdAt, allApplications, uuid = uuidv4()) {
    this.uuid = uuid;
    this.applicationId = applicationId;
    this.entryPointPath = entryPointPath;
    // this.relativeEntryPointPath = path.relative(entryPointPath, process.cwd()); // path relative to cwd
    this.allApplications = allApplications;
    this.dataProvider = newDataProvider(this);
    this.createdAt = this.updatedAt = createdAt || Date.now();
  }

  addData(allData) {
    this.dataProvider.addData(allData);
    this.updatedAt = Date.now();

    // if (this.allApplications.getSelectedApplication() === this) {
    //   this.allApplications._emitter.emit('selectedApplicationData', this);
    // }
  }

  getRelativeFolder() {
    // Needs external help to do it; e.g. in VSCode, can use workspace-relative path.
    return pathGetParent(this.entryPointPath);
  }

  /**
   * TODO: make this cross-platform (might run this where we don't have Node)
   */
  getPreferredName() {
    const { staticProgramContexts } = this.dataProvider.collections;
    const fileCount = staticProgramContexts.size;
    if (fileCount !== 1) {
      // return `getRelativeFolder` instead
      // return '(unknown)';
      return this.getRelativeFolder();
    }

    const file = staticProgramContexts.getById(1)?.filePath;
    // if (fileCount > 1) {
    //  NOTE: Cannot really do this, since the files might not be available at all.
    //   // multiple files -> look for package.json
    //   return getClosestPackageJsonNameOrPath(file);
    // }

    // just a single file -> return file name
    return getFileName(file);
  }

  getSafeFileName() {
    return (this.getPreferredName())?.replace(/[:\\/]/, '-');
  }
}