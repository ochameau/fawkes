Cu.import("resource://gre/modules/ExtensionUtils.jsm");

/*
 * Reimplement chrome.tabs to not depend on browser.xul
 *
 * Instead we just store the state and forward events
 */

var {
    SingletonEventManager,
} = ExtensionUtils;

// Hack to tweak chrome.tabs Schema and allow passing various other fields in chrome.tabs.update
var {Management} = Cu.import("resource://gre/modules/Extension.jsm");
Management.on("startup", () => {
  let { Schemas } = Cu.import("resource://gre/modules/Schemas.jsm", {});
  let string = Schemas.parseSchema({
    "type": "string",
  }, [], []);
  let bool = Schemas.parseSchema({
    "type": "boolean",
  }, [], []);
  let integer = Schemas.parseSchema({
    "type": "integer",
  }, [], []);
  let { properties } = Schemas.namespaces.get("tabs").get("update").parameters[1].type;
  properties.status = {
    type: string,
    optional: "true",
    description: "Tab status can be loading or complete."
  };
  properties.title = {
    type: string,
    optional: "true",
    description: "Tab title."
  };
  properties.favIconUrl = {
    type: string,
    optional: "true",
    description: "Tab favicon url."
  };
  properties.discarded = {
    type: bool,
    optional: "true",
    description: "Tab document should only be loaded once the tab is selected."
  };
  properties.openerTabId = {
    type: integer,
    optional: "true",
    description: "Tab id from which this tab has been opened."
  };
  properties.visible = {
    type: bool,
    optional: "true",
    description: "Tab is shown in the tab strip."
  };
  properties.sessionId = {
    type: string,
    optional: "true",
    description: "Tab unique id over browser sessions."
  };

  properties = Schemas.namespaces.get("tabs").get("create").parameters[0].type.properties;
  properties.discarded = {
    type: bool,
    optional: "true",
    description: "Tab document should only be loaded once the tab is selected."
  };
  properties.openerTabId = {
    type: integer,
    optional: "true",
    description: "Tab id from which this tab has been opened."
  };
  properties.visible = {
    type: bool,
    optional: "true",
    description: "Tab is shown in the tab strip."
  };
  properties.sessionId = {
    type: string,
    optional: "true",
    description: "Tab unique id over browser sessions."
  };

  // Hack two helpers tabs.do(tabId, actionString) and tabs.onAction event
  // to help execute various actions to the tab like go-back/forward, reload, stop loading...
  Schemas.namespaces.get("tabs").set("do", Schemas.parseFunction(["tabs"], {
    type: "function",
    name: "do",
    parameters: [
      { type: "integer", name: "tabId", optional: "true" },
      { type: "string", name: "action" }
    ]
  }));
  Schemas.loadEvent("tabs", {
    name: "onAction",
    type: "function",
    parameters: [
      { type: "integer", name: "tabId" },
      { type: "string", name: "action" }
    ]
  });
});

// Override getSender to support <html:iframe mozbrowser> instead of just <xul:browser>
function getSender(context, target, sender) {
  // The message was sent from a content script to a <browser> element.
  // We can just get the |tab| from |target|.
  if (target.tagName == "IFRAME") {
    // The message came from a content script.
    sender.tab = TabManager.convert(context.extension, target);
  } else if ("tabId" in sender) {
    // The message came from an ExtensionPage. In that case, it should
    // include a tabId property (which is filled in by the page-open
    // listener below).
    sender.tab = TabManager.convert(context.extension, TabManager.getTab(sender.tabId));
    delete sender.tabId;
  }
}

// Hack! To be able to open a URL from chrome code
// For example, used to make ContentSearch.jsm to be able to open links
// from about:home, about:newtab
let onOpenUrl = function (subject, topic, url) {
  TabsState.onEvent("update", {
    id: TabsState.activeTabId,
    url
  });
}
Services.obs.addObserver(onOpenUrl, "open-url", false);

let actionListeners = new Set();
extensions.registerSchemaAPI("tabs", "addon_parent", context => {
  let {extension} = context;
  return {
    tabs: {
      onAction: new SingletonEventManager(context, "tabs.onAction", fire => {
        actionListeners.add(fire);
        return () => {
          actionListeners.delete(fire);
        };
      }).api(),

      do(tabId, action) {
        // Default to current tab when first argument is null
        tabId = tabId || TabsState.activeTabId;
        actionListeners.forEach(fire => {
          fire.async(tabId, action);
        });
      },

      onCreated: new SingletonEventManager(context, "tabs.onCreated", fire => {
        let listener = (event, tabId) => {
          if (event != "create") {
            return;
          }
          let tab = TabManager.getTabForAddon(extension, tabId);
          fire.async(tabId,
            {
              status: tab.status
            }, // TODO: fill this object
            tab
          );
        };
        TabsState.addListener(listener);
        return () => {
          TabsState.removeListener(listener);
        };
      }).api(),

      onActivated: new SingletonEventManager(context, "tabs.onActivated", fire => {
          let listener = (event, tabId, changed, tab) => {
            if ((event != "create" && event != "update") ||
                !tab.active ||
                !changed.includes("active")) {
              return;
            }

            fire.async({tabId: tabId, windowId: "TODO"});
          };
          TabsState.addListener(listener);
          return () => {
            TabsState.removeListener(listener);
          };
        }).api(),

      onUpdated: new SingletonEventManager(context, "tabs.onUpdated", fire => {
        let listener = (event, tabId) => {
          if (event != "create" && event != "update") {
            return;
          }
          let tab = TabManager.getTabForAddon(extension, tabId);
          fire.async(tabId,
            {
              status: tab.status
            }, // TODO: fill this object
            tab
          );
        };
        TabsState.addListener(listener);
        return () => {
          TabsState.removeListener(listener);
        };
      }).api(),

      onMoved: new SingletonEventManager(context, "tabs.onMoved", fire => {
        // XXX NOT IMPLEMENTED
        return () => {
        };
      }).api(),

      onRemoved: new SingletonEventManager(context, "tabs.onRemoved", fire => {
        let listener = (event, tabId, tab) => {
          if (event != "remove") {
            return;
          }
          // We can call TabManager.getTabForAddon as the tab is already removed
          // We may need to do something smarter than just JSON copy
          // At least it allows the callsite to do whatever it wants with its copy
          tab = JSON.parse(JSON.stringify(tab));
          fire.async(tabId, { windowId: null, isWindowClosing: false }, tab);
        };
        TabsState.addListener(listener);
        return () => {
          TabsState.removeListener(listener);
        };
      }).api(),

      get(tabId) {
        return Promise.resolve(TabsState.getTabById(tabId));
      },

      update(tabId, properties) {
        dump("chrome.tab.update("+tabId+", "+JSON.stringify(properties)+")\n");
        // ?? some properties are set to null even if the caller didn't pass it...
        // Remove them to not confuse TabsState.
        for(let k in properties) {
          if (properties[k] === null) {
            delete properties[k];
          }
        }
        // If no tabId was given, automatically try to fetch the active tab
        properties.id = tabId || TabsState.activeTabId;
        if (!properties.id) {
          dump("chrome.tab.update() failed as we couldn't find any currently selected tab\n");
          return;
        }
        TabsState.onEvent("update", properties);
      },

      create(properties) {
        // XXX It needs to return a promise with the success/failure of creating
        // a tab. Without that the session restore web extension will have an
        // hard time to work.
        dump("chrome.tabs.create("+JSON.stringify(properties)+")\n");
        if (!("openerTabId" in properties)) {
          properties.openerTabId = TabsState.activeTabId;
        }
        let tabId = TabsState.onEvent("create", properties);
        return Promise.resolve(TabManager.convert(extension, tabId));
      },

      highlight({ tabs }) {
        if (typeof(tabs) == "number") {
          tabs = [tabs];
        }
        dump(" ==> Highlight > "+tabs.join(", ")+"\n");
        if (tabs.length > 1) {
          throw new Error("Supports only one highlighted tab at a time");
        }
        let tabId = tabs[0];
        TabsState.onEvent("update", { id: tabId, selected: true, highlighted: true, active: true });
      },

      remove(id) {
        let tab = TabsState.getTabById(id);
        let wasActive = tab.active;

        TabsState.onEvent("remove", { id });

        // If that was an active tab, automatically make the last tab the new active one
        if (wasActive) {
          let last = [...TabsState.tabs.keys()].pop();
          if (last) {
            this.highlight({ tabs: last });
          }
        }
      },

      getCurrent() {
        return Promise.resolve(TabManager.convert(extension, TabManager.activeTab));
      },

      query: function(queryInfo) {
        let pattern = null;
        if (queryInfo.url !== null) {
          if (!extension.hasPermission("tabs")) {
            return Promise.reject({message: 'The "tabs" permission is required to use the query API with the "url" parameter'});
          }

          pattern = new MatchPattern(queryInfo.url);
        }

        function matches(tab) {
          let props = ["active", "pinned", "highlighted", "status", "title", "index"];
          for (let prop of props) {
            if (queryInfo[prop] !== null && queryInfo[prop] != tab[prop]) {
              return false;
            }
          }

          /*
          let lastFocused = window == WindowManager.topWindow;
          if (queryInfo.lastFocusedWindow !== null && queryInfo.lastFocusedWindow != lastFocused) {
            return false;
          }

          let windowType = WindowManager.windowType(window);
          if (queryInfo.windowType !== null && queryInfo.windowType != windowType) {
            return false;
          }

          if (queryInfo.windowId !== null) {
            if (queryInfo.windowId == WindowManager.WINDOW_ID_CURRENT) {
              if (currentWindow(context) != window) {
                return false;
              }
            } else if (queryInfo.windowId != tab.windowId) {
              return false;
            }
          }
          */

          if (queryInfo.audible !== null) {
            if (queryInfo.audible != tab.audible) {
              return false;
            }
          }

          if (queryInfo.muted !== null) {
            if (queryInfo.muted != tab.mutedInfo.muted) {
              return false;
            }
          }

          /*
          if (queryInfo.currentWindow !== null) {
            let eq = window == currentWindow(context);
            if (queryInfo.currentWindow != eq) {
              return false;
            }
          }
          */

          if (pattern && !pattern.matches(Services.io.newURI(tab.url, null, null))) {
            return false;
          }

          return true;
        }

        let result = [];
        for (let [id, tab] of TabsState.tabs) {
          if (matches(tab)) {
            result.push(tab);
          }
        }
        return Promise.resolve(result);
      },

      // Used to executeScript, insertCSS and removeCSS.
      _execute: function(tabId, details, kind, method) {
        let tab = tabId !== null ? TabManager.getTab(tabId) : TabManager.activeTab;
        // XXX: We only modified this line, otherwise it is just copy paster from ext-tabs.js from browser/ folder.
        let mm = tab.QueryInterface(Ci.nsIFrameLoaderOwner)
                    .frameLoader.messageManager;

        let options = {
          js: [],
          css: [],
          remove_css: method == "removeCSS",
        };

        // We require a `code` or a `file` property, but we can't accept both.
        if ((details.code === null) == (details.file === null)) {
          return Promise.reject({message: `${method} requires either a 'code' or a 'file' property, but not both`});
        }

        if (details.frameId !== null && details.allFrames) {
          return Promise.reject({message: `'frameId' and 'allFrames' are mutually exclusive`});
        }

        let recipient = {
          innerWindowID: tab.innerWindowID, //tab.linkedBrowser.innerWindowID,
        };

        if (TabManager.for(extension).hasActiveTabPermission(tab)) {
          // If we have the "activeTab" permission for this tab, ignore
          // the host whitelist.
          options.matchesHost = ["<all_urls>"];
        } else {
          options.matchesHost = extension.whiteListedHosts.serialize();
        }

        if (details.code !== null) {
          options[kind + "Code"] = details.code;
        }
        if (details.file !== null) {
          let url = context.uri.resolve(details.file);
          if (!extension.isExtensionURL(url)) {
            return Promise.reject({message: "Files to be injected must be within the extension"});
          }
          options[kind].push(url);
        }
        if (details.allFrames) {
          options.all_frames = details.allFrames;
        }
        if (details.frameId !== null) {
          options.frame_id = details.frameId;
        }
        if (details.matchAboutBlank) {
          options.match_about_blank = details.matchAboutBlank;
        }
        if (details.runAt !== null) {
          options.run_at = details.runAt;
        } else {
          options.run_at = "document_idle";
        }

        return context.sendMessage(mm, "Extension:Execute", {options}, {recipient});
      },

      executeScript: function(tabId, details) {
        return this._execute(tabId, details, "js", "executeScript");
      },
    },
  };
});
