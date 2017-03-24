/*
 * Override some symbols from ext-utils.js that depends on browser.xul
 *
 * Mostly handle Window and Tabs management. Various of these functions
 * are called by WebExtension codebase to implement toolkit APIs.
 *
 * Also includes "TabsState" implementation.
 * i.e. state object describing all tabs.
 */

let DEBUG = false;
if (!DEBUG) {
  dump = () => {};
}

let { generateUUID } = Cc["@mozilla.org/uuid-generator;1"].getService(Ci.nsIUUIDGenerator);

global.TabsState = {
  listeners: new Set(),
  addListener(listener) {
    TabsState.listeners.add(listener);
  },
  removeListener(listener) {
    TabsState.listeners.delete(listener);
  },

  nextId: 1,

  fields: [
    "index",
    "windowId",
    "openerTabId",
    "selected",
    "highlighted",
    "active",
    "pinned",
    "audible",
    "discarded",
    "autoDiscardable",
    "mutedInfo",
    "url",
    "title",
    "favIconUrl",
    "status",
    "incognito",
    "width",
    "height",
    "sessionId",
    "visible",
  ],

  tabs: new Map(),

  onEvent(event, data) {
    let id = Number(data.id ? data.id : TabsState.nextId++);
    dump("TabsState.onEvent("+event+" #" + id + " " + Object.keys(data) + ")\n");
    let changed = [];
    let notify = false;
    let tab = this.tabs.get(id);
    if (event == "remove") {
      if (tab) {
        this.tabs.delete(id);
        notify = true;
        if (tab.active) {
          changed.push("active");
        }
      }
    } else {
      if (!tab) {
        tab = { id };
        tab.sessionId = data.sessionId || generateUUID().toString();
        // Automatically set visible to true when undefined, otherwise just ensure it is a boolean
        tab.visible = typeof(tab.visible) == "undefined" || !!tab.visible;
        this.tabs.set(id, tab);
        event = "create";
        notify = true;
      }

      // Only care about `data` attributes that are in `fields` whitelist
      for(let name of this.fields) {
        // Ignore attribute that are not in the whitelist
        // but also attributes with null/undefined value, which is set by default by webext APIs
        // We assume that null/undefined is never really used explicitely?
        if ((!(name in data)) || data[name] === null || data[name] === undefined) {
          continue;
        }
        if (data[name] != tab[name]) {
          notify = true;
          changed.push(name);
        }
        tab[name] = data[name];
      }
      // Discarded tabs are by default considered as loaded
      if (tab.discarded) {
        tab.status = "complete";
      }
      // Automatically toggles discarded off when the tab becomes active
      if (tab.active && tab.discarded) {
        tab.discarded = false;
        notify = true;
        changed.push("discarded");
      }
    }

    if (!notify) {
      return;
    }

    // If we happen to change the active state,
    // ensure toggling first the active state to all other tabs
    // as there can be only one active tab.
    if (changed.includes("active") && tab.active) {
      for (let [tabId, tab] of TabsState.tabs) {
        if (tab.active && tabId != id) {
          TabsState.onEvent("update", { id: tabId, active: false });
        }
      }
    }

    //dump("call "+TabsState.listeners.size+" listeners about "+id+" changed:"+changed+"\n");
    TabsState.listeners.forEach(f => {
      try {
        f(event, id, changed, tab);
      } catch(e) {
        dump(" >> exception while calling TabsState listener: " + e + "\n" + e.stack + "\n");
      }
    });

    return id;
  },

  getTab(frame) {
    let id = TabManager.getId(frame);
    let tab = this.tabs.get(id);
    if (!tab) {
      throw new Error("Missing state for tab id=" + id);
    }
    return tab;
  },
  getTabById(id) {
    let tab = this.tabs.get(id);
    if (!tab) {
      throw new Error("Missing state for tab id=" + id);
    }
    return tab;
  },
  get activeTabId() {
    for (let [id, tab] of TabsState.tabs) {
      if (tab.active) {
        return id;
      }
    }
    return null;
  }
};

// Manages tab mappings and permissions for a specific extension.
function ExtensionTabManager(extension) {
  this.extension = extension;

  // A mapping of tab objects to the inner window ID the extension currently has
  // the active tab permission for. The active permission for a given tab is
  // valid only for the inner window that was active when the permission was
  // granted. If the tab navigates, the inner window ID changes, and the
  // permission automatically becomes stale.
  //
  // WeakMap[tab => inner-window-id<int>]
  this.hasTabPermissionFor = new WeakMap();
}

ExtensionTabManager.prototype = {
  addActiveTabPermission(tab = TabManager.activeTab) {
    if (this.extension.hasPermission("activeTab")) {
      // Note that, unlike Chrome, we don't currently clear this permission with
      // the tab navigates. If the inner window is revived from BFCache before
      // we've granted this permission to a new inner window, the extension
      // maintains its permissions for it.
      this.hasTabPermissionFor.set(tab, tab.innerWindowID);
    }
  },

  // Returns true if the extension has the "activeTab" permission for this tab.
  // This is somewhat more permissive than the generic "tabs" permission, as
  // checked by |hasTabPermission|, in that it also allows programmatic script
  // injection without an explicit host permission.
  hasActiveTabPermission(tab) {
    // This check is redundant with addTabPermission, but cheap.
    if (this.extension.hasPermission("activeTab")) {
      return (this.hasTabPermissionFor.has(tab) &&
              this.hasTabPermissionFor.get(tab) === tab.innerWindowID);
    }
    return false;
  },

  hasTabPermission(tab) {
    return this.extension.hasPermission("tabs") || this.hasActiveTabPermission(tab);
  },

  getTabForAddon(tabId) {
    let tab = TabsState.getTabById(tabId);
    // Clone the object so that the callsite can alter its own copy
    // but also to allow us to remove fields requiring special perms
    tab = JSON.parse(JSON.stringify(tab));

    if (!this.hasTabPermission(tab)) {
      delete tab.url;
      delete tab.title;
      delete tab.favIconUrl;
    }

    return tab;
  },

  convert(frameOrId) {
    let tab;
    if (typeof(frameOrId) == "number") {
      tab = TabsState.getTabById(frameOrId);
    } else {
      tab = TabsState.getTab(frameOrId);
    }
    // Clone the object so that the callsite can alter its own copy
    // but also to allow us to remove fields requiring special perms
    tab = JSON.parse(JSON.stringify(tab));

    if (!this.hasTabPermission(tab)) {
      delete tab.url;
      delete tab.title;
      delete tab.favIconUrl;
    }

    return tab;
  },

  getTabs(window) {
    return Array.from(window.gBrowser.tabs, tab => this.convert(tab));
  },
};


// Overrides TabManager defined in browser/components/extensions/ext-utils.js
// in order to support generic HTML browser
global.TabManager = {
  _tabs: new WeakMap(),

  frames: function *() {
    let frames = function (window) {
      let list = [...window.document.querySelectorAll("iframe")];
      for(let frame of list) {
        // XXX: Only consider frames with data-tab-id attributes
        // /!\ makes assumptions on the implementation of the "deck" addon
        if (frame.getAttribute("data-tab-id")) {
          yield frame;
        }
        if (frame.contentWindow) {
          for (let f of frames(frame.contentWindow)) {
            yield f;
          }
        }
      }
    };
    for (let window of WindowListManager.browserWindows()) {
      for (let frame of frames(window)) {
        yield frame;
      }
    }
  },

  getId(tab) {
    let id = tab.getAttribute("data-tab-id");
    if (!id) {
      throw new Error("tab without data-tab-id attribute");
    }
    return Number(id);
  },

  getBrowserId(browser) {
    return this.getId(browser);
  },

  getTab(tabId) {
    for(let frame of this.frames()) {
      if (this.getId(frame) == tabId) {
        return frame;
      }
    }
    dump(new Error().stack+"\n");
    throw new Error("Unable to find tab with id=" + tabId+"\n");
    return null;
  },

  get activeTab() {
    let id = TabsState.activeTabId;
    if (id) {
      return this.getTab(id);
    }
    return null;
  },

  getStatus(tab) {
    // TODO
    return "complete";
  },

  getTabForAddon(extension, tabId) {
    return TabManager.for(extension).getTabForAddon(tabId);
  },

  convert(extension, tab) {
    return TabManager.for(extension).convert(tab);
  },
};

// WeakMap[Extension -> ExtensionTabManager]
let tabManagers = new WeakMap();

// Returns the extension-specific tab manager for the given extension, or
// creates one if it doesn't already exist.
TabManager.for = function(extension) {
  if (!tabManagers.has(extension)) {
    tabManagers.set(extension, new ExtensionTabManager(extension));
  }
  return tabManagers.get(extension);
};

/* eslint-disable mozilla/balanced-listeners */
extensions.on("shutdown", (type, extension) => {
    tabManagers.delete(extension);
});
/* eslint-enable mozilla/balanced-listeners */

Cu.import("resource://gre/modules/ExtensionUtils.jsm");

/// XXX Just support our special non-xul non-chrome windows by listening for
/// document-element-inserted in WindowListManager.
//
// Manages listeners for window opening and closing. A window is
// considered open when the "load" event fires on it. A window is
// closed when a "domwindowclosed" notification fires for it.
global.WindowListManager = {
  _openListeners: new Set(),
  _closeListeners: new Set(),

  // Returns an iterator for all browser windows. Unless |includeIncomplete| is
  // true, only fully-loaded windows are returned.
  * browserWindows(includeIncomplete = false) {
    // The window type parameter is only available once the window's document
    // element has been created. This means that, when looking for incomplete
    // browser windows, we need to ignore the type entirely for windows which
    // haven't finished loading, since we would otherwise skip browser windows
    // in their early loading stages.
    // This is particularly important given that the "domwindowcreated" event
    // fires for browser windows when they're in that in-between state, and just
    // before we register our own "domwindowcreated" listener.

    let e = Services.wm.getEnumerator("");
    while (e.hasMoreElements()) {
      let window = e.getNext();

      let ok = includeIncomplete;
      if (window.document.readyState == "complete") {
        ok = window.document.documentElement.getAttribute("windowtype") == "navigator:browser";
      }

      if (ok) {
        yield window;
      }
    }
  },

  addOpenListener(listener) {
    if (this._openListeners.size == 0 && this._closeListeners.size == 0) {
      Services.ww.registerNotification(this);
      Services.obs.addObserver(this, "document-element-inserted", false);
    }
    this._openListeners.add(listener);

    for (let window of this.browserWindows(true)) {
      if (window.document.readyState != "complete") {
        window.addEventListener("load", this);
      }
    }
  },

  removeOpenListener(listener) {
    this._openListeners.delete(listener);
    if (this._openListeners.size == 0 && this._closeListeners.size == 0) {
      Services.ww.unregisterNotification(this);
      Services.obs.removeObserver(this, "document-element-inserted", false);
    }
  },

  addCloseListener(listener) {
    if (this._openListeners.size == 0 && this._closeListeners.size == 0) {
      Services.ww.registerNotification(this);
      Services.obs.removeObserver(this, "document-element-inserted", false);
    }
    this._closeListeners.add(listener);
  },

  removeCloseListener(listener) {
    this._closeListeners.delete(listener);
    if (this._openListeners.size == 0 && this._closeListeners.size == 0) {
      Services.ww.unregisterNotification(this);
      Services.obs.removeObserver(this, "document-element-inserted", false);
    }
  },

  handleEvent(event) {
    event.currentTarget.removeEventListener(event.type, this);
    let window = event.target.defaultView;
    if (window.document.documentElement.getAttribute("windowtype") != "navigator:browser") {
      return;
    }

    for (let listener of this._openListeners) {
      try {
        listener(window);
      } catch(e) {
        dump("Exception while calling WindowListManager listener: "+e+"\n"+e.stack+"\n");
      }
    }
  },

  observe(window, topic, data) {
    if (topic == "domwindowclosed") {
      if (window.document.documentElement.getAttribute("windowtype") != "navigator:browser") {
        return;
      }

      window.removeEventListener("load", this);
      for (let listener of this._closeListeners) {
        listener(window);
      }
    } else {
      if (window.location) { // Ignore xbl document dispatching document-element-inserted
        if (window.defaultView) {
          window.defaultView.addEventListener("load", this);
        } else {
          window.addEventListener("load", this);
        }
      }
    }
  },
};

function getBrowserInfo(browser) {
	let id = browser.getAttribute("data-tab-id");
  return {
    tabId: Number(id),
    windowId: 1 // TODO, compute real window id
  }
}
global.getBrowserInfo = getBrowserInfo;
extensions.on("fill-browser-data", (type, browser, data) => {
  let tabId, windowId;
  if (browser) {
    ({tabId, windowId} = getBrowserInfo(browser));
  }

  data.tabId = tabId || -1;
  data.windowId = windowId || -1;
});
