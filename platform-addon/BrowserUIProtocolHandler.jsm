/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Implements the browserui:// protocol handler which redirects all requests
 * made to URL with this schema to the install page html document.
 * The install page document is a web extension page and lives here:
 *   /ui-install-page/install-page.html
 *
 */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;
const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["BrowserUIHandlerFactory"];

// URL string to redirect to. Passed to BrowserUIHandlerFactory.register()
let installPageURL;
let addonId;

/*
 * BrowserUIHandler
 */
function BrowserUIHandler() {
}

BrowserUIHandler.prototype = {
  scheme: "browserui",
  defaultPort: -1,
  protocolFlags: Ci.nsIProtocolHandler.URI_STD |
                 Ci.nsIProtocolHandler.URI_FETCHABLE_BY_ANYONE |
                 Ci.nsIProtocolHandler.URI_LOADABLE_BY_ANYONE,
  allowPort: () => false,

  mapping: new Map(),

  newURI: function Proto_newURI(aSpec, aOriginCharset, aBaseURI) {
    // Relative urls:
    if (!aSpec.startsWith("browserui:")) {
      let redirect = Services.io.newURI(aBaseURI.spec + aSpec, null, null);
      this.mapping.set(redirect.spec, aSpec);
      return redirect;
    }
    // Absolute urls:
    var uri = Cc["@mozilla.org/network/standard-url;1"].createInstance(Ci.nsIURI);
    uri.spec = aSpec;
    return uri;
  },

  newChannel2: function Proto_newChannel(aURI, aLoadInfo) {
    let url;
    if (this.mapping.has(aURI.spec)) {
      // For relative urls, resolve against the install page URL
      url = Services.io.newURI(this.mapping.get(aURI.spec), null, Services.io.newURI(installPageURL, null, null)).spec;
    } else {
      // Otherwise, map any absolute URL to the install page directly.
      url = installPageURL;
    }

    let redirect = Services.io.newURI(url, null, null);
    // Required to get access to WebExtension chrome.* APIs
    let originAttributes = aLoadInfo.originAttributes;
    originAttributes.addonId = addonId;
    let ch = Services.io.newChannelFromURIWithLoadInfo(redirect, aLoadInfo);
    ch.owner = Services.scriptSecurityManager.createCodebasePrincipal(redirect, originAttributes);
    ch.loadFlags = ch.loadFlags & ~Ci.nsIChannel.LOAD_REPLACE;
    ch.originalURI = aURI;

    return ch;
  },

  newChannel: function Proto_newChannel(aURI) {
    return this.newChannel2(aURI, null);
  },

  createInstance: function(aOuter, aIID) {
    if (aOuter)
      throw Components.results.NS_ERROR_NO_AGGREGATION;
    return this.QueryInterface(aIID);
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIProtocolHandler])
};

var BrowserUIHandlerFactory = {
  classID: Components.ID("ae18af0e-296f-11e6-9275-ebb75fefb05b"),
  contractID: "@mozilla.org/network/protocol;1?name=browserui",
  classDescription: "browserui: protocol handler",

  createInstance: function(aOuter, aIID) {
    if (aOuter)
      throw Components.results.NS_ERROR_NO_AGGREGATION;
    let handler = new BrowserUIHandler();
    return handler.QueryInterface(aIID);
  },
  lockFactory: function(aLock) {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory]),

  register: function(pageURL, id) {
    installPageURL = pageURL;
    addonId = id;
    if (!registrar.isCIDRegistered(BrowserUIHandlerFactory.classID)) {
      registrar.registerFactory(BrowserUIHandlerFactory.classID,
                                BrowserUIHandlerFactory.classDescription,
                                BrowserUIHandlerFactory.contractID,
                                BrowserUIHandlerFactory);
      // Only register the protocol from the parent process!
      // There is no need to listen for install page event from the child process
      // as broadcastchannel works across processes.
      if (Services.appinfo.processType != Ci.nsIXULRuntime.PROCESS_TYPE_DEFAULT) {
        return;
      }

      // Start listening for broadcast channel messages sent from the addon
      let onMessage = function({ data }) {
        let { BrowserUI } = Cu.import("resource://browserui/BrowserUI.jsm", {});
        let uri = Services.io.newURI(data.uri, null, null);
        uri.scheme = "http";
        if (uri.host) {
          BrowserUI.setBrowser(uri.spec);
        } else { // host is null for browserui://
          BrowserUI.resetUI();
        }
      }
      // Listen for message from page loaded in browser.xul without mozbrowser iframes
      let channel = BroadcastChannelFor(installPageURL, "confirm", {addonId});
      channel.addEventListener("message", onMessage);
      // and also from mozbrowser iframes used in html browsers
      channel = BroadcastChannelFor(installPageURL, "confirm", {addonId, inIsolatedMozBrowser: true});
      channel.addEventListener("message", onMessage);
    }
  },

  unregister: function () {
    if (registrar.isCIDRegistered(BrowserUIHandlerFactory.classID)) {
      registrar.unregisterFactory(BrowserUIHandlerFactory.classID, BrowserUIHandlerFactory);
    }
    // Releasing the windows should collect them and the broadcastchannels with them.
    windows = [];
  },
};

let windows = [];
function BroadcastChannelFor(uri, name, originAttributes) {
  let baseURI = Services.io.newURI(uri, null, null);
  let principal = Services.scriptSecurityManager.createCodebasePrincipal(baseURI, originAttributes);

  let chromeWebNav = Services.appShell.createWindowlessBrowser(true);
  // XXX: Keep a ref to the window otherwise it is garbaged and BroadcastChannel stops working.
  windows.push(chromeWebNav);
  let interfaceRequestor = chromeWebNav.QueryInterface(Ci.nsIInterfaceRequestor);
  let docShell = interfaceRequestor.getInterface(Ci.nsIDocShell);
  docShell.createAboutBlankContentViewer(principal);
  let window = docShell.contentViewer.DOMDocument.defaultView;
  return new window.BroadcastChannel(name);
}
