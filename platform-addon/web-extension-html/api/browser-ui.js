/*
 * Implements chrome.browserui API
 * 
 * Allows to list all the URIs that some browserui addon exposes
 * to implement parts of the browser.
 */

const { BrowserUI } = Components.utils.import("resource://browserui/BrowserUI.jsm", {});

let onManifestUI = (type, directive, extension, manifest) => {
  let { browser_ui } = manifest;
  for (let ui in browser_ui) {
    let url = browser_ui[ui];
    if (url) {
      BrowserUI.registerBrowserUI(ui, url);
    }
  }
};
extensions.on("manifest_browser_ui", onManifestUI);

extensions.registerSchemaAPI("browserui", "addon_parent", context => {
  let {extension} = context;
  return {
    browserui: {
      getAll() {
        return Promise.resolve(BrowserUI.getAllUIs());
      },
    },
  };
});
