/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Expose privileged API to moz-extension documents to allow implementing browser features
 */

"use strict";

let EXPORTED_SYMBOLS = [];

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

let { GlobalManager } = Cu.import("resource://gre/modules/Extension.jsm", {});
let { ExtensionManagement } = Cu.import("resource://gre/modules/ExtensionManagement.jsm", {});
let AddonPathService = Cc["@mozilla.org/addon-path-service;1"].getService(Ci.amIAddonPathService);
Cu.import("resource://gre/modules/Services.jsm");

function onNewIframe(subject, topic, data) {
  let frameLoader = subject;
  frameLoader.QueryInterface(Ci.nsIFrameLoader);
  let frame = frameLoader.ownerElement;
  // Only take care of HTML iframes
  if (frame.tagName.toUpperCase() != "IFRAME" || !frame.getAttribute("mozbrowser")) {
    return;
  }
  // Adds the browser API permission to web extension documents in order to allow usign <iframe mozbrowser>
  if (frame.src.includes("moz-extension:")) {
    let uri = Services.io.newURI(frame.src, null, null);
    let perms = [
      "browser",
    ];
    perms.forEach(name => {
      Services.perms.add(uri, name, Ci.nsIPermissionManager.ALLOW_ACTION);
      let { originAttributes } = frameLoader.loadContext;
      // Keep the same originAttributes and only add the addonId
      // (we want to keep all other origin attributes as-is)
      let addonId = AddonPathService.mapURIToAddonId(uri);
      originAttributes.addonId = addonId;
      let principal = Services.scriptSecurityManager.createCodebasePrincipal(uri, originAttributes); 
      Services.perms.addFromPrincipal(principal, name, Ci.nsIPermissionManager.ALLOW_ACTION);
    });
  }
}

function onDocumentReady(document) {
  let window = document.defaultView;
  if (!window) {
    return;
  }
  let id = ExtensionManagement.getAddonIdForWindow(window);
  if (!id) {
    return;
  }

  let extension = GlobalManager.getExtension(id);
  if (!extension) {
    return;
  }

  // Please ContentSearch.jsm for about:home
  window.whereToOpenLink = () => { return "current" };
  window.BrowserSearch = { recordSearchInTelemetry: () => {} };

  let xpc = window;
  if (window.wrappedJSObject) {
    window = window.wrappedJSObject;
  }
  if (window.__webExtHooked) {
    return;
  }
  window.__webExtHooked = true;
  // Hack to workaround focus issues. When an iframe request the focus
  // it gets prevented because of this code:
  // https://dxr.mozilla.org/mozilla-central/source/dom/base/nsFocusManager.cpp#1305
  // sendFocusEvent = nsContentUtils::CanCallerAccess(domNode);
  let oldFocus = window.focus;
  window.focus = function () {
    Services.focus.clearFocus(Services.wm.getMostRecentWindow(null));
    oldFocus.call(this);
  };

  // Do not allow popup opened via chrome.popup API to control toplevel window
  // which happen to be the top level html document...
  // Instead forward some JS APIs to the panel API
  let frameElement = document.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
    .getInterface(Ci.nsIDOMWindowUtils)
    .containerElement;
  if (frameElement.parentNode.tagName.toLowerCase() == "panel") {
    let panel = frameElement.parentNode;
    window.close = function () {
      // Let a chance to all postMessage to work if called before window.close()
      // by cleaning up the panel only on the next event loop
      document.defaultView.setTimeout(function () {
        panel.hidePopup();
      });
    }
    window.resizeTo = function (w, h) {
      panel.sizeTo(w, h);
    }
    return;
  }

  // Allows web extensions document to call window.close()
  let webNav = document.defaultView.QueryInterface(Ci.nsIInterfaceRequestor)
                       .getInterface(Ci.nsIWebNavigation)
  let top = webNav.QueryInterface(Ci.nsIDocShellTreeItem)
             .rootTreeItem
             .QueryInterface(Ci.nsIInterfaceRequestor)
             .getInterface(Ci.nsIDOMWindow);
  window.close = function () {
    top.close();
  }
  // As well as resizing the top level window
  window.resizeTo = function (w, h) {
    top.resizeTo(w, h);
  }
  Object.defineProperty(window, "windowState", {
    get() {
      return top.windowState;
    }
  });
  window.maximize = function () {
    top.maximize();
  }
  window.minimize = function () {
    top.minimize();
  }
  // Allow -moz-window-dragging: drag;
  webNav.QueryInterface(Ci.nsIDocShell);
  webNav.windowDraggingAllowed = true;

  if (extension.hasPermission("browser")) {
    // Hack to workaround bug 1281440:
    // mozbrowser documents are not allowed to open frames for about: pages,
    // nor moz-extension://
    let originalSetAttribute = window.HTMLIFrameElement.prototype.setAttribute;
    window.HTMLIFrameElement.prototype.setAttribute = function setattr(name, val) {
      // Only hook `src` attribute and some special about/chrome/moz-extension URLs
      // we ignore remote as most of these ressources are only working in parent process
      if (name == "src" && !this.getAttribute("remote") && val.match(/(about|chrome|moz-extension):/)) {
        if (!this.contentWindow) {
          window.setTimeout(() => {
            setattr.call(this, name, val);
          }, 0);
          return;
        }
        // Set the location via window.location according to this comment:
        // https://dxr.mozilla.org/mozilla-central/source/dom/base/nsFrameLoader.cpp#506-519
        this.contentWindow.location = val;
      } else {
        originalSetAttribute.call(this, name, val);
      }
      if (name == "mozbrowser") {
        // Another hack to allow calling setVisible even if the document isn't chrome...
        // MozIframe API is now restricted to chrome principal and not to the browser permission.
        this.wrappedJSObject.setVisible = function (val) {
          this.setVisible(val);
        };
        this.wrappedJSObject.findAll = function (a, b) {
          this.findAll(a, b);
        };
        this.wrappedJSObject.findNext = function (a) {
          this.findNext(a);
        };
        this.wrappedJSObject.clearMatch = function () {
          this.clearMatch();
        };
        this.wrappedJSObject.goBack = function () {
          this.goBack();
        };
        this.wrappedJSObject.goForward = function () {
          this.goForward();
        };
        this.wrappedJSObject.reload = function (force) {
          this.reload(force);
        };
        this.wrappedJSObject.stop = function () {
          this.stop();
        };
        this.QueryInterface(Ci.nsIMozBrowserFrame);
        this.mozbrowser = true;
      }
    };
  }
}

function startup() {
  Services.obs.addObserver(onNewIframe, "remote-browser-shown", false);
  Services.obs.addObserver(onNewIframe, "inprocess-browser-shown", false);
  Services.obs.addObserver(onDocumentReady, "document-element-inserted", false);
}

function shutdown() {
  Services.obs.removeObserver(onNewIframe, "remote-browser-shown", false);
  Services.obs.removeObserver(onNewIframe, "inprocess-browser-shown", false);
  Services.obs.removeObserver(onDocumentReady, "document-element-inserted", false);
}

startup();
