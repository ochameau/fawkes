/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * This module do very creepy hacks to disable/unload many features
 * that aren't working with html browser.
 *
 * In order to work correctly, this script has to be loaded ASAP!
 * In an addon, ideally the addon would be to first to be loaded,
 * and we could call this module during it's bootstrap.js evaluation.
 */

"use strict";

const {classes: Cc, interfaces: Ci, utils: Cu, results: Cr} = Components;
const Cm = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
const catman = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);

var EXPORTED_SYMBOLS = [];

// Prevent loading broken form modules
//catman.deleteCategoryEntry("profile-after-change", "formHistoryStartup", false);
//catman.deleteCategoryEntry("idle-daily", "formHistoryStartup", false);
//catman.deleteCategoryEntry("profile-after-change", "FormAutofillStartup", false);

// Prevent loading tons of dependencies by disabling nsBrowserGlue
// (prevent it from receiving final-ui-startup)
var glue = Cc["@mozilla.org/browser/browserglue;1"].getService(Ci.nsIObserver);
glue.observe(null, "profile-before-change", null);

// Prevent loading Session store modules by preventing it from receiving final-ui-start.
var ss = Cc["@mozilla.org/browser/sessionstartup;1"].getService(Ci.nsIObserver);
ss.observe(null, "quit-application", null);

// Replace AppService to prevent loading WebApps.jsm and various useless app files
var contractID = "@mozilla.org/AppsService;1";
if (contractID in Cc) {
  var oldCID = Cm.contractIDToCID(contractID);
  var oldFactory = Cm.getClassObject(Cc[contractID], Ci.nsIFactory);
  Cm.unregisterFactory(oldCID, oldFactory);
  var newFactory = {
    createInstance: function(outer, iid) {
      if (outer != null) {
        throw Cr.NS_ERROR_NO_AGGREGATION;
      }
      return {};
    }
  };
  var newCID = Components.ID("{24f3d0cf-e417-4b85-9017-c9ecf8bb1290}");
  Cm.registerFactory(newCID,
                     "Hack the apps",
                     contractID, newFactory);
}

// Hack Telemetry to disable it and prevent loading various deps
Cu.import("resource://gre/modules/TelemetryController.jsm").Impl.observe = function () {};

// Disable a bunch of addons
const { AddonManager } = Cu.import("resource://gre/modules/AddonManager.jsm", {});
AddonManager.addManagerListener({
  onStartup: function () {
    ["webcompat@mozilla.org", "e10srollout@mozilla.org", "firefox@getpocket.com", "flyweb@mozilla.org", "formautofill@mozilla.org", "ubufox@ubuntu.com", "shield-recipe-client@mozilla.org"].forEach(id => {
      AddonManager.getAddonByID(id, function (addon) {
        if (addon) {
          addon.softDisabled = true;
        }
      });
    });
  }
});
