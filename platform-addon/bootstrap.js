const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;
const Cm = Components.manager;

Cu.import("resource://gre/modules/Services.jsm");

// Unregister that framescript which breaks <select> (at least)
// and does various useless/broken stuff in the html browser
Services.mm.removeDelayedFrameScript("chrome://global/content/browser-content.js");

// Register the manifest early, so that resource://browserui works immediately
(function loadManifest() {
  let manifest = Services.io.newURI(__SCRIPT_URI_SPEC__, null, null).QueryInterface(Ci.nsIFileURL).file.parent;
  Components.manager.addBootstrappedManifestLocation(manifest);
})();
// Setup web extension support for HTML top level document ASAP!
Cu.import("resource://browserui/web-extension-html/main.jsm", {});

// Do various very hacky things to disable stuff we dont use/support yet.
let chromeURL = Services.prefs.getCharPref("browser.chromeURL");
if (!chromeURL.includes("chrome://browser/content/")) {
  Cu.import("resource://browserui/MakeFirefoxLight.jsm", {});
}

let extension;
let listener;
let isDevAddon = false;

function startup(data) {
  // a "dev-addon" is one that we use locally, in a special profile where install the addon via a symlink
  // to a source folder. the installPath then refers to the source folder directly,
  // which is unlikely to be within an "extensions" folder.
  isDevAddon = data.installPath.parent.leafName != "extensions";

  Cu.import("resource://gre/modules/Extension.jsm");
  // Start the web-extension from the sub folder
  let addonData = Object.create(data);
  addonData.resourceURI = Services.io.newURI("ui-install-page/", null, data.resourceURI);
  extension = new Extension(addonData);
  extension.startup()

  let installPageURL = extension.baseURI.resolve("install-page.html");
  let addonId = extension.id;

  // Register browserui:// on every process and the new one to come
  Services.ppmm.loadProcessScript("data:,(" + function (pageURL, addonId) {
    const { BrowserUIHandlerFactory } = Components.utils.import("resource://browserui/BrowserUIProtocolHandler.jsm", {});
    BrowserUIHandlerFactory.register(pageURL, addonId);
  } + ")(\"" + installPageURL + "\", \"" + addonId + "\")", true);

  const { BrowserUI } = Components.utils.import("resource://browserui/BrowserUI.jsm", {});
  BrowserUI.startup();

  // Register two key shortcuts to reload the browser ui and reset back to browser.xul
  // These shortcuts work from all windows
  const { MultiWindowKeyListener } = Components.utils.import("resource://browserui/MultiWindowKeyListener.jsm", {});
  const { BrowserUIHandlerFactory } = Components.utils.import("resource://browserui/BrowserUIProtocolHandler.jsm", {});
  listenerReload = new MultiWindowKeyListener({
    keyCode: Ci.nsIDOMKeyEvent.DOM_VK_R, altKey: true,
    callback: reloadBrowser
  });
  listenerReload.start();

  listenerReset = new MultiWindowKeyListener({
    keyCode: Ci.nsIDOMKeyEvent.DOM_VK_R, ctrlKey: true, altKey: true,
    callback: () => BrowserUI.resetUI()
  });
  listenerReset.start();

  const ServiceWorkers = Components.utils.import("resource://browserui/HttpServiceWorkers.jsm", {});
  ServiceWorkers.startup();

  const CommandLine = Components.utils.import("resource://browserui/CommandLine.jsm", {});
  CommandLine.startup();

  const LightweightThemes = Components.utils.import("resource://browserui/LightweightThemes.jsm", {});
  LightweightThemes.startup();

  const LightweightAddons = Components.utils.import("resource://browserui/LightweightAddons.jsm", {});
  LightweightAddons.startup();
}

function install(data) {
  // Save the addon etag on install in order to know if it gets updated
  getAddonEtag().then(etag => {
    Services.prefs.setCharPref("browserui.etag", etag);
  });
}

function shutdown(data, reason) {
  if (reason == ADDON_UNINSTALL) {
    // First reset to the browser.xul if the addon is removed
    //const { BrowserUI} = Components.utils.import("resource://browserui/BrowserUI.jsm", {});
    //BrowserUI.resetUI();
  }

  // Unregister browserui:// on all active processes.
  Services.ppmm.loadProcessScript("data:,new " + function () {
    const { BrowserUIHandlerFactory } = Components.utils.import("resource://browserui/BrowserUIProtocolHandler.jsm", {});
    BrowserUIHandlerFactory.unregister();
  }, false);

  const { BrowserUI } = Components.utils.import("resource://browserui/BrowserUI.jsm", {});
  BrowserUI.shutdown();

  // Cleanup the web-extension
  extension.shutdown();

  // Unregister the key shortcuts
  listenerReload.stop();
  listenerReset.stop();

  const ServiceWorkers = Components.utils.import("resource://browserui/HttpServiceWorkers.jsm", {});
  ServiceWorkers.shutdown();

  const CommandLine = Components.utils.import("resource://browserui/CommandLine.jsm", {});
  CommandLine.shutdown();

  const LightweightThemes = Components.utils.import("resource://browserui/LightweightThemes.jsm", {});
  LightweightThemes.shutdown();

  const LightweightAddons = Components.utils.import("resource://browserui/LightweightAddons.jsm", {});
  LightweightAddons.shutdown();
}

function uninstall() {
}

let reloading = false;
function reloadBrowser() {
  // Prevent reloading multiple times if the keydown listener call us multiple times in a row
  if (reloading) {
    return;
  }
  reloading = true;
  getAddonEtag().then(etag => {
    let previousEtag = Services.prefs.getCharPref("browserui.etag");
    // If the etag changed, we have to update the addon and restart firefox
    if (previousEtag != etag && !isDevAddon) {

      let doUpdate = Services.prompt.confirm(null,
        "System update available",
        "A system update is available (browser ui addon), do you want to download and install it?");
      if (!doUpdate) {
        return;
      }

      // Close the browser window
      let window = Services.wm.getMostRecentWindow(null);
      if (window) window.close();
      // But prevent exiting firefox process (the process automatically shuts down when there is no more toplevel window)
      Services.startup.enterLastWindowClosingSurvivalArea();

      updateAddon().then(() => {
        // The addon doesn't clean itself up properly and requires a firefox reboot
        dump("Restarting firefox...\n");
        Services.prefs.savePrefFile(null); 
        Cc["@mozilla.org/toolkit/app-startup;1"]
          .getService(Ci.nsIAppStartup)
          .quit(Ci.nsIAppStartup.eForceQuit | Ci.nsIAppStartup.eRestart);
      });
    } else {
      // Otherwise we can just reload the HTML from http
      const { BrowserUI } = Components.utils.import("resource://browserui/BrowserUI.jsm", {});
      BrowserUI.reloadUI();
    }
    Services.prefs.setCharPref("browserui.etag", etag);
  }).then(() => {
    reloading = false;
  });
}
let ADDON_URL = "http://techno-barje.fr/fawkes/browserui.xpi";
function getAddonEtag() {
  return new Promise(done => {
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.open("HEAD", ADDON_URL, true);
    xhr.setRequestHeader("Cache-Control", "no-cache");
    xhr.onreadystatechange = () => {
      if (xhr.readyState != 4) return;
      let etag = xhr.getResponseHeader("Etag");
      done(etag);
    };
    xhr.send(null);
  });
}

function updateAddon() {
  return new Promise(done => {
    const {AddonManager} = Cu.import("resource://gre/modules/AddonManager.jsm", {});
    AddonManager.getInstallForURL(ADDON_URL, install => {
      if (!install) {
        dump("Can't create browserui addon install: "+ADDON_URL+"\n");
        return;
      }
      function reject(event) {
        dump("failed updating browserui addon: "+event+"\n");
      }
      install.addListener({
        onDownloadFailed: reject,
        onDownloadCancelled: reject,
        onInstallFailed: reject,
        onInstallCancelled: reject,
        onInstallEnded() {
          dump("browserui addon updated!\n");
          done();
        } 
      });
      dump("Install the browserui addon\n");
      install.install();
    }, "application/x-xpinstall");
  });
}
