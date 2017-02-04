"use strict";

/**
 * Lightweight implementation of an addon manager supporting only web extensions.
 */

const Cu = Components.utils;
const Cc = Components.classes;
const Ci = Components.interfaces;

Cu.import("resource://gre/modules/Services.jsm");
let {Extension} = Components.utils.import("resource://gre/modules/Extension.jsm", {});

let EXPORTED_SYMBOLS = ["startup", "shutdown", "install", "reset", "onReady"];

let Addons = [];
let AddonInstances = new Map();

let LightAddons = {
  install(id, url) {
    if (AddonInstances.has(id)) {
      return;
    }
    let data = { id, url };
    let promise = installAddon(data);
    Addons.push(data);
    saveAddonList();
    return promise;
  },
  uninstall(id) {
    Addons = Addons.filter(a => a.id != id);
    let addon = AddonInstances.get(id);
    if (addon) {
      addon.shutdown();
      AddonInstances.delete(id);
    }
    saveAddonList();
  },
  isInstalled(id) {
    return AddonInstances.has(data.id);
  }
};

function saveAddonList() {
  Services.prefs.setCharPref("webextensions.list", JSON.stringify(Addons));
  Services.prefs.savePrefFile(null)
}

function installAddon(addon) {
  //dump("addon.url="+addon.url+"\n");
  let data = {
    id: addon.id,
    resourceURI: Services.io.newURI(addon.url, null, null)
  };
  let extension = new Extension(data);
  let promise = extension.startup();
  AddonInstances.set(addon.id, extension);
  return promise;
}

let resolveReady;
var onReady = new Promise(done => {
  resolveReady = done;
});

function startup() {
  try {
    Addons = JSON.parse(Services.prefs.getCharPref("webextensions.list"));
    if (!Addons || !Array.isArray(Addons)) {
      Addons = [];
    }
    Promise.all(Addons.map(installAddon)).then(resolveReady, resolveReady);
  } catch(e) {
    resolveReady();
  }
}

function shutdown() {
  AddonInstances.forEach(addon => addon.shutdown());
}

function reset() {
  try {
    shutdown();
  } catch(e) {}
  AddonInstances.clear();
  Addons = [];
  saveAddonList();
}

function install(id, url) {
  LightAddons.install(id, url);
}
