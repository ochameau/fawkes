"use strict";

/**
 * Main entrypoint to setup and hacks things to make a browser made of web extension addons
 *
 */

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import("resource://gre/modules/Services.jsm");
let {Management, ExtensionData} = Components.utils.import("resource://gre/modules/Extension.jsm", {});

let catman = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);

var EXPORTED_SYMBOLS = ["main"];

function loadManifest() {
  let manifest = Services.io.newURI("resource://browserui/web-extension-html/", null, null).QueryInterface(Ci.nsIFileURL).file;
  Components.manager.addBootstrappedManifestLocation(manifest);
}

function registerHttpCompatibleMozExtensionProtocol() {
  Services.ppmm.loadProcessScript("data:,new " + function () {
    const { WebExtensionProtocolHandlerFactory } = Components.utils.import("resource://webextensions/WebExtensionProtocolHandler.jsm", {});
    WebExtensionProtocolHandlerFactory.register();
  }, true);
}

function registerApiAndSchemas() {
  catman.addCategoryEntry("webextension-scripts", "utils-overload", "resource://webextensions/api/utils.js", false, true);
  catman.addCategoryEntry("webextension-scripts", "browser-action-management", "resource://webextensions/api/browser-action-management.js", false, true);
  catman.addCategoryEntry("webextension-scripts", "browser-ui", "resource://webextensions/api/browser-ui.js", false, true);
  catman.addCategoryEntry("webextension-scripts", "popup", "resource://webextensions/api/popup.js", false, true);

  catman.addCategoryEntry("webextension-schemas", "manifest-tweaks", "resource://webextensions/schemas/manifest-tweaks.json", false, true);
  catman.addCategoryEntry("webextension-schemas", "browser-action-management", "resource://webextensions/schemas/browser-action-management.json", false, true);
  catman.addCategoryEntry("webextension-schemas", "browser-ui", "resource://webextensions/schemas/browser-ui.json", false, true);
  catman.addCategoryEntry("webextension-schemas", "popup", "resource://webextensions/schemas/popup.json", false, true);
}

function hijackWebExtensionCodebase() {
  // Read directory assumes the addon are on the filesystem and can iterate over addon directory
  // which is not true with addon experiments hosted on http
  ExtensionData.prototype.readDirectory = function () {
    return Promise.resolve([]);
  };

  // BrowserUI addons like tabs, urlbar, ...
  // are within <iframe mozbrowser> created by the layout addon,
  // which is itself also living in such iframe.
  // PseudoChildAPIManger query docShell.chromeEventHandler
  // which for these iframes refer to the layout iframe.
  // Instead we want to target their iframe.
  Cu.import("resource://gre/modules/ExtensionCommon.jsm");
  Object.defineProperty(ExtensionCommon.BaseContext.prototype, "docShell", {
    get() {
      let caller = Components.stack.caller;
      if (caller.name == "PseudoChildAPIManager") {
        let window = this._docShell.QueryInterface(Ci.nsIInterfaceRequestor)
          .getInterface(Ci.nsIDOMWindow);
        let frameElement = window.QueryInterface(Ci.nsIInterfaceRequestor)
          .getInterface(Ci.nsIDOMWindowUtils)
          .containerElement;
        return {
          chromeEventHandler: frameElement
        };
      }
      return this._docShell;
    },
    set(d) {
      this._docShell = d;
    }
  });
}

function main() {
  // Register the manifest early, so the override in chrome.manifest
  // takes effect before web extensions scripts are inserted into the
  // addon scope.
  loadManifest();

  // Register moz-extension:// on every process and the new one to come
  // We register a special moz-extension protocol that is able to load addons from http://
  registerHttpCompatibleMozExtensionProtocol();

  // Register new API/Schemas but also override existing ones from /browser/
  registerApiAndSchemas();

  // Tweak mozbrowser iframe to work with WebExtension codebase
  catman.addCategoryEntry("webextension-scripts", "mozbrowser-iframes",
                          "resource://webextensions/api/tweakMozbrowserIframes.js", false, true);
  // Also tweak them in the chrome scope for expandos used from Extension.jsm
  Cu.import("resource://webextensions/api/tweakMozbrowserIframes.js", {});

  hijackWebExtensionCodebase();

  // Once Webextension API and schemas are hacked,
  // we reset its schemas and scripts in order to ensure reloading them with hacked versions
  Management.initialized = null;

  // Expose some more powerful method to web extension documents that needs some more powers to implement a browser!
  Cu.import("resource://webextensions/WebExtDocAddPrivileges.jsm", {});

  // Fix about:home and about:newtab support when loaded within <html:iframe mozbrowser/>
  Cu.import("resource://webextensions/FixAboutHome.jsm", {});

  // Disable private browsing. It throws because it expect browser.xul as top level
  Cu.import("resource://gre/modules/PrivateBrowsingUtils.jsm");
  PrivateBrowsingUtils.isBrowserPrivate = () => false;

  // Ensure that <select> show a dropdown
  Cu.import("resource://webextensions/FixSelect.jsm", {});

  // Ensure starting login manager to restore login and passwords
  let { LoginManagerParent } = Cu.import("resource://gre/modules/LoginManagerParent.jsm", {});
  LoginManagerParent.init();
  Cu.import("resource://webextensions/LoginManagerPrompter.js", {});

  // Enables PDF.js addon
  let { PdfJs } = Cu.import("resource://pdf.js/PdfJs.jsm", {});
  PdfJs.init(true);
  Services.ppmm.loadProcessScript("resource://pdf.js/pdfjschildbootstrap.js", true);
}
main();
