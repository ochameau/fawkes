/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Augment <iframe mozbrowser> to better work with existing web extension codebase.
 * Execute that as a webextension script in order to add xraywrapper expando on the same
 * wrappers than the one used in webextension scripts.
 * WebExtension scripts are executed in non-system principal, with a different set of
 * expandos
 */

"use strict";

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

let { GlobalManager } = Cu.import("resource://gre/modules/Extension.jsm", {});
let { ExtensionManagement } = Cu.import("resource://gre/modules/ExtensionManagement.jsm", {});
Cu.import("resource://gre/modules/Services.jsm");

let EXPORTED_SYMBOLS = [];

function onNewIframe(subject, topic, data) {
  let frameLoader = subject;
  frameLoader.QueryInterface(Ci.nsIFrameLoader);
  let frame = frameLoader.ownerElement;
  // Only take care of HTML iframes
  if (frame.tagName != "IFRAME" || !frame.mozbrowser) {
    return;
  }
  let { messageManager } = frame.QueryInterface(Ci.nsIFrameLoaderOwner).frameLoader;
  if (!messageManager) {
    return;
  }

  // Add messageManager attribute to mozbrowser iframes for webextensions
  frame.messageManager = messageManager;

  // ExtensionParent.jsm expect this xul:browser attribute
  frame.remoteType = null;

  frame.innerWindowID = -1 * Math.floor((Math.random()*100));
  frame.contentPrincipal = {subsumes() {return true;}};

  // Automatically register the frame to webextension codebase
  try {
    GlobalManager._onExtensionBrowser(null, frame);
  } catch(e) {}

  // Add innerWindowID attribute to mozbrowser iframes for webextensions
  messageManager.addMessageListener("browserui:innerWindowID", function listener({ data }) {
    frame.innerWindowID = data.innerWindowID;
    frame.linkedBrowser = { innerWindowID: data.innerWindowID };
    let p = Services.scriptSecurityManager.createCodebasePrincipal(
      Services.io.newURI(data.uri, null, null) , data.originAttributes);
    // For very obscure wrapper reasons, this throws if we do `contentPrincipal = p`
    frame.contentPrincipal = { subsumes: p.subsumes.bind(p) };
  });
  messageManager.loadFrameScript("data:,(" + function () {
    function update() {
      if (!content.document.nodePrincipal.URI) {
        return;
      }
      let innerWindowID = content.QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIDOMWindowUtils)
                                 .currentInnerWindowID;
      let outerWindowID = content.QueryInterface(Ci.nsIInterfaceRequestor)
                                 .getInterface(Ci.nsIDOMWindowUtils)
                                 .outerWindowID;
      sendAsyncMessage("browserui:innerWindowID", { innerWindowID, outerWindowID,
        uri: content.document.nodePrincipal.URI.spec,
        originAttributes: content.document.nodePrincipal.originAttributes });
      /* Automatically add the "browser" permission in order to allow using <iframe mozbrowser> */
      if (content.location.href.startsWith("moz-extension:")) {
        Services.perms.addFromPrincipal(content.document.nodePrincipal, "browser", Ci.nsIPermissionManager.ALLOW_ACTION);
      }
    }
    let listener = {
      onLocationChange(webProgress, request, locationURI, flags) {
        if (webProgress.DOMWindow == content) {
          update();
        }
      },
      onProgressChange() {},
      onProgressChange64() {},
      onRefreshAttempted() { return true; },
      onSecurityChange() {},
      onStateChange() {},
      onStatusChange() {},
      QueryInterface: function QueryInterface(iid) {
        if (iid.equals(Ci.nsIWebProgressListener) ||
            iid.equals(Ci.nsISupportsWeakReference) ||
            iid.equals(Ci.nsISupports)) {
          return this;
        }
      }
    };
    let webProgress = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                              .getInterface(Ci.nsIWebProgress);
    webProgress.addProgressListener(listener, Ci.nsIWebProgress.NOTIFY_ALL);
    addEventListener("unload", function () {
      let webProgress = docShell.QueryInterface(Ci.nsIInterfaceRequestor)
                                .getInterface(Ci.nsIWebProgress);
      webProgress.removeProgressListener(listener);
    });
    update();
  } + ").call(this)", true);
}

function startup() {
  Services.obs.addObserver(onNewIframe, "remote-browser-shown", false);
  Services.obs.addObserver(onNewIframe, "inprocess-browser-shown", false);
}

function shutdown() {
  Services.obs.removeObserver(onNewIframe, "remote-browser-shown", false);
  Services.obs.removeObserver(onNewIframe, "inprocess-browser-shown", false);
}

startup();
