/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Implement core of custom browser ui, its registration and its startup:
 *  - Update browserui.browserURL to set it to the new browser ui document URL or manifest,
 *  - Open the first top level window,
 *  - Catch browser ui document load to augment it in order to make things to work...
 *  - Automatically add browser permission to the browser ui document in order
 *    to allow usage of <iframe mozbrowser>
 *  - Automatically set necessary preferences
 *
 */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;
const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["BrowserUI"];

// Watch for new browser UI toplevel document load
function observe(subject, topic, data) {
  let window = subject.defaultView;
  if (!window) {
    return;
  }
  if (!subject.location.href.startsWith(BrowserUI.chromeURL)) {
    return;
  }
  // Nothing special to do with browser.xul
  if (BrowserUI.chromeURL.includes("chrome://browser/content/")) {
    return;
  }
  // Add a fake gBrowser object, very minimal and non-working,
  // just to have basic WebExtension feature working:
  // loading install-page.html in an HTML iframe...
  // Otherwise we get random exceptions which prevent exposing chrome.*
  // APIs to it
  window.gBrowser = {
    addTabsProgressListener() {},
    getTabForBrowser() {}
  };

  // Automatically resize the window, otherwise it defaults to 1 x 1 on Linux and Width x 0 on Windows
  if (window.innerWidth < 10 || window.innerHeight < 10) {
    subject.documentElement.setAttribute("width", window.screen.availWidth * 0.9);
    subject.documentElement.setAttribute("height", window.screen.availHeight * 0.9);
  }
}

function installUIManifest(list, uri) {
  dump("Install addons:\n" + list.join("\n") + "\n");
  // Lazy load LightAddons from here, as this JSM is also loaded in child
  // whereas LightAddons only works in parent.
  let LightweightAddons = Cu.import("resource://browserui/LightweightAddons.jsm", {});
  return LightweightAddons.onReady.then(() => {
    LightweightAddons.reset();
    list.forEach((url,i) => {
      // Resolve relative URLs
      if (!url.startsWith("http")) {
        url = uri.resolve(url);
      }

      LightweightAddons.install(url);
    });
  });
}

function setBrowser(uri) {
  uri = Services.io.newURI(uri, null, null);

  // Normalize the url and ignore the call if we are setting the same browser URL
  let browserURL = Services.prefs.getCharPref("browserui.browserURL");
  if (browserURL == uri.spec) {
    return;
  }
  Services.prefs.setCharPref("browserui.browserURL", uri.spec);

  startBrowser(uri, true);
}

let onWindowOpened = null;
function startBrowser(uri, bypassCache) {
  return new Promise(done => {
    // Detect redirect and uses the final URL
    let xhr = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xhr.open("GET", uri.spec, true);
    if (bypassCache) {
      xhr.setRequestHeader("Cache-Control", "no-cache");
    }
    xhr.onreadystatechange = function () {
      if (xhr.readyState != 4) return;

      // Detect addon manifest list which is a JSON for an array of addon manifest urls
      let text = xhr.responseText;
      if (text.match(/^\s*\[/)) {
        let list;
        try {
          list = JSON.parse(text);
        } catch(e) {}
        if (list) {
          installUIManifest(list, uri);
          // A "layout" addon should be in that list
          // and call registerBrowserUI which is going to call setChromeURI
          onWindowOpened = done;
          return;
        }
      } else {
        // Do not translate moz-extension URL as they may resolve to unprivileged http uri
        if (xhr.responseURL != uri.spec && uri.scheme != "moz-extension") {
          uri = Services.io.newURI(xhr.responseURL, null, null);
        }
        setChromeURI(uri);
      }
      done();
    }
    xhr.send(null);
  });
}

function setChromeURI(uri) {
  dump("setChromeURI("+uri.spec+")\n");
  // Reset permissions and prefs if we are switching from a custom UI
  let chromeURL = BrowserUI.chromeURL;
  let wasChrome = !chromeURL;
  if (chromeURL != uri.spec) {
    if (chromeURL) {
      // Ignore the call if we end up setting the same url again
      if (BrowserUI.chromeURL == uri.spec) {
        checkUIForRefresh(wasChrome);
        return;
      }
      Preferences.unset();
      Permissions.unset(chromeURL);
    }

    Preferences.set(uri);
    Permissions.set(uri);
    BrowserUI._chromeURL = uri.spec;
    Services.prefs.setCharPref("browserui.chromeURL", uri.spec);

    // Disable the cache as it may be the first time we load the interface
    const { WebExtensionProtocolHandlerFactory } = Components.utils.import("resource://webextensions/WebExtensionProtocolHandler.jsm", {});
    WebExtensionProtocolHandlerFactory.setCache(false);
  }

  checkUIForRefresh(wasChrome);
}

function checkUIForRefresh(wasChrome) {
  dump("checkUIForRefresh("+wasChrome+")\n");
  // Restart the browser once the top level document pref is set
  // only when the browser was already opened, otherwise just open the top level doc
  let window = Services.wm.getMostRecentWindow(null);
  if (window) {
    // If we are switching from browser.xul to any html interface,
    // we have to reboot to have valid states in web extension code
    if (wasChrome) {
      dump(" >> restart\n");
      restart();
    } else {
      dump(" >> reload\n");
      // Otherwise, we can just reload the top level document
      reloadUI();
    }
  } else {
    dump(" >> start\n");
    if (BrowserUI.chromeURL) {
      Services.ww.openWindow(null, BrowserUI.chromeURL, "_blank", "chrome,dialog=no,resizable=yes", null);
      if (onWindowOpened) {
        onWindowOpened();
        onWindowOpened = null;
      }
    }
  }
}

function resetUI() {
  let currentUri = Services.io.newURI(BrowserUI.chromeURL, null, null);
  Permissions.unset(currentUri);
  Preferences.unset();

  // Also resets addons as the layout addon is going to restore the browserui pref again
  let LightweightAddons = Cu.import("resource://browserui/LightweightAddons.jsm", {});
  LightweightAddons.reset();

  Services.prefs.setCharPref("browserui.browserURL", "");
  Services.prefs.setCharPref("browserui.chromeURL", "");
  BrowserUI._chromeURL = "";

  restart();
}


const Permissions = (function() {
  const kPermissions = [
    "browser",
  ];

  function add(uri, name) {
    Services.perms.add(uri, name, Ci.nsIPermissionManager.ALLOW_ACTION);

    let principal = Services.scriptSecurityManager.createCodebasePrincipal(uri, {});
    Services.perms.addFromPrincipal(principal, name, Ci.nsIPermissionManager.ALLOW_ACTION);
  }

  function remove(uri, name) {
    Services.perms.remove(uri, name);

    let principal = Services.scriptSecurityManager.createCodebasePrincipal(uri, {});
    Services.perms.removeFromPrincipal(principal, name);
  }

  return {
    set: function(uri) {
      kPermissions.forEach(function(name) { add(uri, name); });
    },

    unset: function(uri) {
      // This may throw if the uri didn't got its permissions set
      try {
        kPermissions.forEach(function(name) { remove(uri, name); });
      } catch(e) {}
    }
  }
})();

const Preferences = (function() {
  const kPreferences = [
    //
    // Additional dom apis
    //
    { name: "dom.webcomponents.enabled", value: true },
    { name: "dom.mozBrowserFramesEnabled", value: true },
  ];

  function add(preference) {
    let name = preference.name;
    let value = preference.value;
    switch (typeof value) {
      case "boolean":
        Services.prefs.setBoolPref(name, value);
        break;

      case "number":
        Services.prefs.setIntPref(name, value);
        break;
 
      case "string":
        Services.prefs.setCharPref(name, value);
        break;
    }
  }

  function remove(preference) {
    Services.prefs.clearUserPref(preference.name);
  }

  return {
    set: function(uri) {
      kPreferences.forEach(function(preference) { add(preference); });
    },

    unset: function() {
      kPreferences.forEach(function(preference) { remove(preference); });
    }
  }
})();

// Startup the browser
//
// First look into browserui.browserURL pref for the browser manifest
// which can be a url to an HTML page or a JSON manifest refering to addons.
function start() {
  let browserURL = Services.prefs.getCharPref("browserui.browserURL");
  if (!browserURL) {
    return false;
  }
  let uri = Services.io.newURI(browserURL, null, null);
  // Force keeping the browser alive until 'start()' is called an open a top level window
  Services.startup.enterLastWindowClosingSurvivalArea();
  startBrowser(uri, false).then(() => {
    Services.startup.exitLastWindowClosingSurvivalArea();
  });
  return true;
}

function restart() {
  Services.prefs.savePrefFile(null); 
  Cc["@mozilla.org/toolkit/app-startup;1"]
    .getService(Ci.nsIAppStartup)
    .quit(Ci.nsIAppStartup.eForceQuit | Ci.nsIAppStartup.eRestart);
  /* We could also just open a new top level window, but for now, the web extension hacks
     work better with a full restart...
  let window = Services.wm.getMostRecentWindow(null);
  if (window) {
    // Close and reopen instead of just updating the location
    // As window properties like "tabsintitle" or transparent windows
    // are not updated when just changing the location. It is only computed once
    // on window opening.
    // browser.xul requires args with the default tab to open...
    let args = Cc["@mozilla.org/supports-array;1"].createInstance(Ci.nsISupportsArray);
    let url = Cc["@mozilla.org/supports-string;1"].createInstance(Ci.nsISupportsString);
    url.data = "about:blank";
    args.AppendElement(url);
    Services.ww.openWindow(null, uri.spec, "_blank", "chrome,dialog=no,all", args);
    window.close();
  }
  */
}

let reloading = false;
function reloadUI() {
  if (reloading) {
    return;
  }
  reloading = true;

  // Disable web extension cache on reload in order to load from http,
  // do that for the whole firefox session in order to not only cache things that loads immediately,
  // but also things that are loaded on-demande like the awesomebar
  const { WebExtensionProtocolHandlerFactory } = Components.utils.import("resource://webextensions/WebExtensionProtocolHandler.jsm", {});
  WebExtensionProtocolHandlerFactory.setCache(false);

  // When reloading the UI, we first try to prune Service worker cache.
  // We do not use reload(true) as it completely bypass service workers
  // and prevent them from intercepting requests. So that it would just
  // return outdated cache on the next regular load (next browser startup).
  // Also, we could have only delete each cache instance instead of deleting
  // entries of all caches, but that would mess up with service worker
  // scripts which caches their Cache instances.
  let window = Services.wm.getMostRecentWindow("navigator:browser");
  if (!window) {
    window = Services.wm.getMostRecentWindow(null);
  }
  if (window) {
    /*
    // Clearing the cache just before the reload mess up with web extension cache tricks
    // (it prevents the moz-extension ressources from being stored in cache most likely
    // because clearCaches is asyncronous and doesn't resolve really after it is really
    // finished)
    clearCaches(window).catch(error => {
      Cu.reportError("Error while clearing caches: " + error + " - " +
                     error.stack);
    }).then(() => {
      */
      // We can't use regular DOM "load" listener as they don't work here...
      let cache = Cc["@mozilla.org/netwerk/cache-storage-service;1"]
                    .getService(Ci.nsICacheStorageService);
      cache.clear();
      cache.purgeFromMemory(Ci.nsICacheStorageService.PURGE_EVERYTHING);
      window.setTimeout(() => {
        new ProgressListener(window, () => {
          reloading = false;
        });
        window.location.reload();
      }, 500);
    //});
  }
}

function ProgressListener(window, callback) {
  let docShell = window.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIWebNavigation)
                       .QueryInterface(Ci.nsIDocShell);
  let webProgress = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                            .getInterface(Ci.nsIWebProgress);
  webProgress.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_STATE_WINDOW);

  this.webProgress = webProgress;
	this.callback = callback;
}

ProgressListener.prototype = {
  QueryInterface: XPCOMUtils.generateQI([
    Ci.nsIWebProgressListener,
    Ci.nsISupportsWeakReference
  ]),

  uninstall: function() {
    this.webProgress.removeProgressListener(this);
  },

  onStateChange: function(webProgress, request, stateFlags, status) {
    let {STATE_IS_WINDOW, STATE_STOP, STATE_START} = Ci.nsIWebProgressListener;
    if (!webProgress.isTopLevel || !(stateFlags & STATE_IS_WINDOW)) {
      return;
    }

    if ((stateFlags & STATE_STOP) && this.webProgress == webProgress) {
      this.callback();
    }
  },

  onLocationChange: function() {},
  onProgressChange: function() {},
  onStatusChange: function() {},
  onSecurityChange: function() {},
};

// Clear all caches to force loading new resources
function clearCaches(window) {
  let cache = Cc["@mozilla.org/netwerk/cache-storage-service;1"]
                .getService(Ci.nsICacheStorageService);
  cache.clear();

  let imageCache = Cc["@mozilla.org/image/tools;1"]
                     .getService(Ci.imgITools)
                     .getImgCacheForDocument(null);
  // chrome
  imageCache.clearCache(true);
  // content
  imageCache.clearCache(false);

  return clearServiceWorkerCaches(window);
}

// Clear DOM `caches` API to reload service workers
function clearServiceWorkerCaches(window) {
  let { Promise } = window;
  // Iter over all caches
  return window.caches.keys().then(keys => {
    // Open each cache
    return Promise.all(keys.map(key => window.caches.open(key)));
  }).then(caches => {
    return Promise.all(caches.map(cache => {
      // Now iter over each entry for each cache
      return cache.keys().then(keys => {
        // Delete every single entry
        return Promise.all(keys.map(key => cache.delete(key)));
      });
    }));
  });
}

let uis = {};
function getAllUIs() {
  return uis;
}

function registerBrowserUI(type, url) {
  uis[type] = url;

  // Check for layout addons, if one is available, update the top level window!
  if (type == "layout") {
    // In order for chrome.* to work, we have to load the document into an iframe
    // (all webextension codebase is based on messagemanager...)

    // Also handle transparent windows without native titlebar that needs some specifics CSS to be set.
    // (Most important is background-color: transparent on <html>/documentElement which
    //  is read by platform code to toggle this special window mode)
    let transparent = (Services.appinfo.OS == "WINNT" || Services.appinfo.OS == "Darwin")
      && !uis["vertical-tabs"];
    let newurl = "data:text/html;charset=utf-8," + 
                 "<html windowtype=\"navigator:browser\"";
    if (transparent) {
      newurl += " tabsintitlebar=\"true\" chromemargin=\"0,2,2,2\"";
    }
    newurl += "><style>";
    if (transparent) {
      newurl += "html {";
      newurl += " background-color: transparent;";
      if (Services.appinfo.OS == "WINNT") {
        newurl += " -moz-appearance: -moz-win-borderless-glass;";
      }
      newurl += "}";
    } else {
      newurl += "html {";
      newurl += " background-color: white;";
      newurl += "}";
    }
    newurl += "body {margin: 0} iframe {border: none; width: 100%; height: 100%; ";
    if (transparent) {
      newurl += " background-color: transparent;";
    }
    newurl += "}</style>" +
              "<iframe mozbrowser=\"true\" src=\"" + url + "\" transparent=\"transparent\" />" + 
              "</html>";

    let uri = Services.io.newURI(newurl, null, null);
    setChromeURI(uri);
  }
  Services.obs.notifyObservers(null, "register-browser-ui", type);
};

var BrowserUI = {
  _chromeURL: Services.prefs.getCharPref("browserui.chromeURL"),
  get chromeURL() {
    return this._chromeURL;
  },

  startup() {
    Services.obs.addObserver(observe, "document-element-inserted", false);
  },

  shutdown() {
    Services.obs.removeObserver(observe, "document-element-inserted", false);
  },

  start,

  registerBrowserUI,
  getAllUIs,

  setBrowser,
  startBrowser,

  resetUI,
  reloadUI,
};
