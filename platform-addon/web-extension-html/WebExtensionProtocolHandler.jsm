/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * WebExtensionProtocolProtocolHandler.js
 *
 * This module reimplements moz-extension:// in JS in order to allow loading it from http://
 */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;
const registrar = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

const aps = Cc["@mozilla.org/addons/policy-service;1"].getService(Ci.nsIAddonPolicyService);

var EXPORTED_SYMBOLS = ["WebExtensionProtocolHandlerFactory"];

function WebExtensionProtocolHandler() {
  this.mapping = new Map();
}

WebExtensionProtocolHandler.prototype = {
  scheme: "moz-extension",
  defaultPort: -1,
  protocolFlags: Ci.nsIProtocolHandler.URI_STD |
                 Ci.nsIProtocolHandler.URI_IS_LOCAL_RESOURCE |
                 Ci.nsIProtocolHandler.URI_LOADABLE_BY_ANYONE |
                 Ci.nsIProtocolHandler.URI_FETCHABLE_BY_ANYONE,
  allowPort: () => false,

  newURI: function Proto_newURI(aSpec, aOriginCharset, aBaseURI) {
    //dump("newURI("+aSpec+" base:"+(aBaseURI?aBaseURI.spec:null)+")\n");
    // Relative urls:
    if (!aSpec.startsWith("moz-extension:")) {
      // Manually resolve this url in order to not loop back to this function
      // (strip eventual file name with replace)
      let uri = aBaseURI.spec.replace(/\/[^\/]*$/, "/");
      if (!aSpec.startsWith("/") && !uri.endsWith("/")) {
        uri += "/";
      }
      uri += aSpec;
      return Services.io.newURI(uri, null, null);
    }
    // Absolute urls:
    var uri = Cc["@mozilla.org/network/standard-url;1"].createInstance(Ci.nsIURI);
    uri.spec = aSpec;
    return uri;
  },

  newChannel2: function Proto_newChannel(aURI, aLoadInfo) {
    //dump("newChannel2("+aURI.spec+" -- domain:"+aURI.host+")\n");
    let url;
    let targetURL = this.mapping.get(aURI.host);
    if (aURI.path == "/_generated_background_page.html") {
      url = aps.getGeneratedBackgroundPageUrl(aURI.host);
    } else if (aURI.path == "/_blank.html") {
      url = "about:blank";
    } else if (targetURL) {
      // For relative urls, resolve against the install page URL
      url = Services.io.newURI("." + aURI.path, null, Services.io.newURI(targetURL, null, null)).spec;
    } else {
      let msg = "moz-extension: Unable to redirect: "+aURI.spec;
      dump(msg + "\n");
      throw new Error(msg);
    }

    let redirect = Services.io.newURI(url, null, null);
    let originAttributes;
    if (aLoadInfo) {
      // Required to get access to WebExtension chrome.* APIs
      originAttributes = aLoadInfo.originAttributes;
      let addonId = aps.extensionURIToAddonId(aURI);
      //dump("AddonID > "+aURI.spec+" > "+addonId+"\n");
      originAttributes.addonId = addonId;
      if (!addonId) {
        dump("moz-extension: Unable to find addonId\n");
      }
      aLoadInfo.originAttributes = originAttributes;
    }

    let ch = Services.io.newChannelFromURIWithLoadInfo(redirect, aLoadInfo);
    ch.owner = Services.scriptSecurityManager.createCodebasePrincipal(aURI, originAttributes);
    //ch.loadFlags = ch.loadFlags & ~Ci.nsIChannel.LOAD_REPLACE;
    ch.originalURI = aURI;

    if (WebExtensionProtocolHandlerFactory.cache) {
      ch.loadFlags |= Ci.nsIRequest.LOAD_FROM_CACHE;
      // This flag will ensure never ever try to load from network,
      // but if we happen to not load all resources on first startup or Alt+R
      // it will introduce missing resources
      //ch.loadFlags |= Ci.nsICachingChannel.LOAD_ONLY_FROM_CACHE;
    } else {
      ch.loadFlags |= Ci.nsIRequest.VALIDATE_ALWAYS;
    }

    return ch;
  },

  newChannel: function Proto_newChannel(aURI) {
    return this.newChannel2(aURI, null);
  },

  setSubstitution: function (uuid, uri) {
    if (!uri) {
      this.mapping.delete(uuid);
    } else {
      this.mapping.set(uuid, uri.spec);
    }
  },

  QueryInterface: XPCOMUtils.generateQI([Ci.nsIProtocolHandler, Ci.nsISubstitutingProtocolHandler])
};

var WebExtensionProtocolHandlerFactory = {
  classID: Components.ID("ae18af0e-296f-11e6-9275-ebb75fefb16c"),
  contractID: "@mozilla.org/network/protocol;1?name=moz-extension",
  classDescription: "moz-extension: protocol handler",

  // Disable web extension cache after browserui addon update, where we force a restart of firefox
  cache: !Services.startup.wasRestarted,

  createInstance: function(aOuter, aIID) {
    if (aOuter)
      throw Components.results.NS_ERROR_NO_AGGREGATION;
    let handler = new WebExtensionProtocolHandler();
    return handler.QueryInterface(aIID);
  },
  lockFactory: function(aLock) {
    throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIFactory]),

  register: function(pageURL, id) {
    if (!registrar.isCIDRegistered(WebExtensionProtocolHandlerFactory.classID)) {
      registrar.registerFactory(WebExtensionProtocolHandlerFactory.classID,
                                WebExtensionProtocolHandlerFactory.classDescription,
                                WebExtensionProtocolHandlerFactory.contractID,
                                WebExtensionProtocolHandlerFactory);
    }
  },

  unregister: function () {
    if (registrar.isCIDRegistered(WebExtensionProtocolHandlerFactory.classID)) {
      registrar.unregisterFactory(WebExtensionProtocolHandlerFactory.classID, WebExtensionProtocolHandlerFactory);
    }
  },
   
  setCache: function (state) {
    this.cache = state;
  }
};

