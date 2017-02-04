/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Fix about:home and about:newtab when loading them in an <html:iframe mozbrowser />
 *
 * - Inject copy of the existing framescript from browser-content.js
 * - Hook chrome code running in parent to open URLs via web extension API
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

Cu.import("resource:///modules/ContentSearch.jsm");
ContentSearch.init();

Cu.import("resource:///modules/AboutHome.jsm");
AboutHome.init();
AboutHome.receiveMessage = function(aMessage) {
	let window = aMessage.target.ownerGlobal;

	switch (aMessage.name) {
		case "AboutHome:RestorePreviousSession":
      // TODO
			break;

		case "AboutHome:Downloads":
			Services.obs.notifyObservers(null, "open-url", "about:downloads");
			break;

		case "AboutHome:Bookmarks":
			Services.obs.notifyObservers(null, "open-url", "chrome://browser/content/places/places.xul");
			break;

		case "AboutHome:History":
			Services.obs.notifyObservers(null, "open-url", "chrome://browser/content/places/places.xul");
			break;

		case "AboutHome:Addons":
			Services.obs.notifyObservers(null, "open-url", "about:addons");
			break;

		case "AboutHome:Sync":
			//window.openPreferences("paneSync", { urlParams: { entrypoint: "abouthome" } });
			break;

		case "AboutHome:Settings":
			Services.obs.notifyObservers(null, "open-url", "about:preferences");
			break;

		case "AboutHome:RequestUpdate":
			this.sendAboutHomeData(aMessage.target);
			break;
	}
};

function onNewIframe(subject, topic, data) {
  let frameLoader = subject;
  frameLoader.QueryInterface(Ci.nsIFrameLoader);
  let frame = frameLoader.ownerElement;
  // Only take care of HTML iframes
  if (frame.tagName != "IFRAME" || !frame.getAttribute("mozbrowser")) {
    return;
  }
  let { messageManager } = frame.QueryInterface(Ci.nsIFrameLoaderOwner).frameLoader;
  if (!messageManager) {
    return;
  }

  // Allows ContentSearch.jsm to open url...
  frame.loadURIWithFlags = (url, flags) => {
    // Communicate directly with WebExtension chrome.tabs implementation to open a url
    Services.obs.notifyObservers(null, "open-url", url);
  };

  messageManager.loadFrameScript("resource://webextensions/frame-scripts/AboutHomeListener.js", true);
  messageManager.loadFrameScript("resource://webextensions/frame-scripts/AutocompletePopup.js", true);
  messageManager.loadFrameScript("resource://webextensions/frame-scripts/ContentSearchMediator.js", true);
  messageManager.loadFrameScript("resource://webextensions/frame-scripts/LoginManager.js", true);
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
