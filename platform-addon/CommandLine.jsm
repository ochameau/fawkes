"use strict";

/**
 * Implement a command line handler which take precedance over nsBrowserGlue
 * in order to prevent loading many browser.xul deps.
 */

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cm = Components.manager;
const Cu = Components.utils;
const Cr = Components.results;

Cm.QueryInterface(Ci.nsIComponentRegistrar);

Cu.import('resource://gre/modules/XPCOMUtils.jsm');
Cu.import('resource://gre/modules/Services.jsm');

var EXPORTED_SYMBOLS = ["startup", "shutdown"];

function Remote() {}

Remote.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsICommandLineHandler]),
  classDescription: 'remote',
  classID: Components.ID('{1280e159-cac2-4188-af5a-e6089527b7b8}'),
  contractID: '@mozilla.org/commandlinehandler/general-startup;1?type=browserui',

  handle: function(cmdLine)
  {
    let testPath = cmdLine.handleFlagWithParam("test", true);
    if (testPath) {
      try {
        this.executeTest(cmdLine.resolveFile(testPath));
      } catch(e) {
        dump(`Exception while trying to execute test at '${testPath}':\n${e}\n${e.filename}: ${e.lineNumber}\n`);
      }
      cmdLine.preventDefault = true;
      return;
    }

    let rootPath = cmdLine.handleFlagWithParam("browserui-root", true);
    let manifestPath = cmdLine.handleFlagWithParam("browserui-manifest", true);
    if (rootPath && manifestPath) {
      try {
        this.installUI(cmdLine.resolveFile(rootPath), manifestPath);
      } catch(e) {
        dump(`Exception while trying to install ui from '${rootPath}:${manifestPath}':\n${e}\n${e.filename}: ${e.lineNumber}\n"`);
      }
      cmdLine.preventDefault = true;
      return;
    }

    /*
    let args = Cc["@mozilla.org/supports-array;1"].createInstance(Ci.nsISupportsArray);
    let url = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
    url.data = "about:blank";
    args.AppendElement(url);
    */

    // Hand over to this JSM the startup of browserui top level document
    const { BrowserUI } = Components.utils.import("resource://browserui/BrowserUI.jsm", {});
    // Do not do anything if we are using original firefox UI
    if (!BrowserUI.start()) {
      return;
    }

    // Prevent default command line handler to prevent browser/ resources from loading,
    // like nsBrowserGlue, nsBrowserContentHandler, ...
    // Mostly to prevent tons of jsm and frame script from loading.
    cmdLine.preventDefault = true;
  },

  executeTest(file) {
    if (!file.exists()) {
      throw new Error("Test file doesn't exists.");
    }
    let principal = Services.scriptSecurityManager.getSystemPrincipal();
    let sandbox = Cu.Sandbox(principal);
    let url = Services.io.newFileURI(file).QueryInterface(Ci.nsIFileURL);

    let ConsoleAPI = Cu.import("resource://gre/modules/Console.jsm", {}).ConsoleAPI;
    let consoleOptions = {
      maxLogLevelPref: "All",
      prefix: "Test"
    };
    sandbox.console = new ConsoleAPI(consoleOptions);

    let log = sandbox.console.log;
    sandbox.console.log = function () {
      let args = Array.from(arguments);
      let fmt = args.shift() || "";
      let str = fmt.replace(/(%[ds])/g, function (match, offset, string, d) {
        return args.shift();
      });
      str += args.join(" ");
      log.call(sandbox.console, str);
    };
    sandbox.global = sandbox;
    sandbox.location = { search: "", href: file.leafName };
    sandbox.setTimeout = Cu.import("resource://gre/modules/Timer.jsm", {}).setTimeout;
    sandbox.clearTimeout = Cu.import("resource://gre/modules/Timer.jsm", {}).clearTimeout;

    Services.scriptloader.loadSubScriptWithOptions(url.resolve("./chai.js"), {
      target: sandbox,
      ignoreCache: true
    });
    Services.scriptloader.loadSubScriptWithOptions(url.resolve("./mocha.js"), {
      target: sandbox,
      ignoreCache: true
    });

    Services.scriptloader.loadSubScriptWithOptions(url.spec, {
      target: sandbox,
      ignoreCache: true
    });

    // Wait for all async event to be processed before closing
    // This typically waits for Task/Promises to be completed before quitting!
    let thread = Services.tm.currentThread;
    while (thread.hasPendingEvents()) {
      thread.processNextEvent(true);
    }
  },

  installUI(root, manifestPath) {
    if (!root.exists() || !root.isDirectory()) {
      throw new Error("root directory doesn't exists.");
    }
    let manifest = root.clone();
    manifest.appendRelativePath(manifestPath);
    if (!manifest.exists()) {
      throw new Error(`manifest file doesn't exists at ${manifest.path}.`);
    }

    let rootUrl = Services.io.newFileURI(root);
    let protocolHandler = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
    protocolHandler.setSubstitution("local-browser", rootUrl);

    let resRootUrl = Services.io.newURI("resource://local-browser/", null, null);
    let manifestUrl = Services.io.newURI(manifestPath, null, resRootUrl);
    dump("root: "+rootUrl.spec+" manifest:"+manifestUrl.spec+"\n");
    const { BrowserUI } = Components.utils.import("resource://browserui/BrowserUI.jsm", {});
    let list = readJSONFile(manifest);

    BrowserUI.startBrowser(manifestUrl, true);

    let thread = Services.tm.currentThread;
    while (thread.hasPendingEvents()) {
      thread.processNextEvent(true);
    }
  }
};

function parseJsonFromStream(aInputStream) {
  const json = Cc["@mozilla.org/dom/json;1"].createInstance(Components.interfaces.nsIJSON);
  const data = json.decodeFromStream(aInputStream, aInputStream.available());
  return data;
}

/**
 * Read a JSON file and return the JS object
 */
Cu.import("resource://gre/modules/FileUtils.jsm");
function readJSONFile(aFile) {
  let stream = Cc["@mozilla.org/network/file-input-stream;1"].
               createInstance(Ci.nsIFileInputStream);
  try {
    stream.init(aFile, FileUtils.MODE_RDONLY, FileUtils.PERMS_FILE, 0);
    return parseJsonFromStream(stream, stream.available());
  } catch (ex) {
    dump("readJSONFile: Error reading JSON file: " + ex);
  } finally {
    stream.close();
  }
  return false;
}

const RemoteFactory = XPCOMUtils.generateNSGetFactory([Remote])(Remote.prototype.classID);

function startup(aData, aReason) {
  Cm.registerFactory(Remote.prototype.classID,
                     Remote.prototype.classDescription,
                     Remote.prototype.contractID,
                     RemoteFactory);
  var catman = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
  catman.addCategoryEntry('command-line-handler', 'l-remote', Remote.prototype.contractID, false, true);
}

function shutdown(aData, aReason) {
  var catman = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
  catman.deleteCategoryEntry('command-line-handler', 'l-remote', false);
  Cm.unregisterFactory(Remote.prototype.classID, RemoteFactory);
}
