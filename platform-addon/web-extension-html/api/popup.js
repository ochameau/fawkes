Cu.import("resource://gre/modules/ExtensionUtils.jsm");

/*
 * Implement chrome.popup
 *
 * Allows opening popup windows at arbitrary positions.
 * Mostly used to open the Awesomebar.
 *
 * Today, we are using xul:panel, but we might be able to just use Services.ww.openWindow(popup=yes)
 * but unfortunately, popup=yes prevents focus in these windows. <input> for example can't be focused.
 * Second unfortunate conclusion is that popup=yes seems to be the only way to create a window
 * that is not visible in task view (Alt+Tab) or the dock on mac.
 *
 * So we end up creating a xul document, via an hidden <iframe> injected into the top level html document.
 * (We could have created a somewhat hidden window, but using popup=yes to prevent seeing it in the task list
 * have the same impact on focus and inputs)
 * Then, we create one instance of <xul:panel> per popup in it. This panel is made of an <html:iframe mozbrowser>
 * in which we load the web extension html document.
 */

var {
    SingletonEventManager,
} = ExtensionUtils;

const { BrowserUI } = Components.utils.import("resource://browserui/BrowserUI.jsm", {});

let popupId = 1;

let popups = new Set();
let panels = {};

function waitForContentLoaded(win) {
  if (win.document.readyState == "complete") {
    return Promise.resolve(win);
  }
  return new Promise(done => {
    win.addEventListener("load", done.bind(null, win), { once: true });
  });
}

function createHiddenXulWindow() {
  // We need a xul document to be able to create a <xul:panel>...
  // Create one in an invisible iframe in the toplevel html doc
  // (note that if this xul doc is loaded as a toplevel document, it has to contain a <textbox/>
  //  in order to make the panel's <input> focusable)
  let doc = "<window xmlns=\"http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul\"></window>";
  let url = "data:application/vnd.mozilla.xul+xml;charset=utf-8," + encodeURI(doc);
  let win = Services.wm.getMostRecentWindow(null);
  let i = win.document.createElement("iframe");
  i.setAttribute("src", url);
  // Doesn't use display:none nor visibility:hidden as <panel> won't be visible
  i.style.width="0px";
  i.style.height="0px";
  win.document.documentElement.appendChild(i);
  win = i.contentWindow;

  /*
  // popup=yes is the only way to prevent the window from appearing in the Alt+Tab list of windows or in dock
  // but it prevent <input> from being focused...
  let flags = "chrome,dialog=yes,dependent=yes,popup=no,modal=no";
  let win = Services.ww.openWindow(null, url, "_blank", flags, null);
  var baseWindow = win.QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIWebNavigation)
                      .QueryInterface(Ci.nsIDocShellTreeItem)
                      .treeOwner
                      .QueryInterface(Ci.nsIInterfaceRequestor)
                      .getInterface(Ci.nsIBaseWindow);
	baseWindow.enabled = true;
  baseWindow.visibility = true;
  */
  /*
  // windowlessbrowser prevent <panel> from appearing
  let b = Services.appShell.createWindowlessBrowser(true);
  let win = b.document.defaultView;
  win.location = url;
  */
  // Wait for load as about:blank is first loaded
  return waitForContentLoaded(win);
}
let xulWindow;
function getXulWindow() {
  // Also verify that location is not null.
  // It becomes null if the window is closed, which happens
  // if some web extension code calls window.close()
  if (xulWindow) {
    return xulWindow.then(win => {
      if (win.location) {
        return win;
      }
      return xulWindow = createHiddenXulWindow();
    });
  }
  return xulWindow = createHiddenXulWindow();
}
function createXulPanel() {
  return getXulWindow().then(win => {
    let panel = win.document.createElement("panel");
    panel.setAttribute("animate", false);
    panel.setAttribute("consumeoutsideclicks", "false");
    panel.setAttribute("noautofocus", "true");
    panel.setAttribute("ignorekeys", true);

    // Use type="arrow" to prevent side effects (see Bug 1285206)
    panel.setAttribute("type", "arrow");
    panel.setAttribute("level", "top");

    win.document.documentElement.appendChild(panel);
    return panel;
  });
}
function waitForPanelBinding(panel) {
  return new Promise(done => {
    function checkXBLBinding() {
      if (typeof(panel.sizeTo) == "function") {
        done();
      } else {
        panel.ownerDocument.defaultView.setTimeout(checkXBLBinding, 25);
      }
    }
    checkXBLBinding();
  });
}
function create(id, url, width, height, left, top) {
  return createXulPanel().then(panel => {
    panels[id] = panel;
    let iframe = panel.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
    iframe.setAttribute("mozbrowser", "true");
    iframe.setAttribute("src", url);
    iframe.style.border = "none";

    // Only way I found to maximize the size of the html:iframe within xul:panel...
    iframe.style.display = "-moz-box";
    iframe.style.MozBoxFlex = "1";

    // Remove border and background from xul:panel
    panel.style.MozAppearance = "none";
    panel.appendChild(iframe);
    panel.addEventListener("popuphidden", function onHidden() {
      panel.removeEventListener("popuphidden", onHidden);
      close(id);
    });

    return waitForPanelBinding(panel).then(() => {
      panel.sizeTo(width, height);
      panel.openPopupAtScreen(left, top, false);
    });
  });
}
function getPopupWindow(id) {
  let panel = panels[id];
  if (!panel) return Promise.resolve(null);
  let win = panel.querySelector("iframe").contentWindow;
  return waitForContentLoaded(win);
}
function close(id) {
  let panel = panels[id];
  if (!panel) return;
  delete panels[id];
  panel.hidePopup();
  panel.remove();
}

/*
function create(id, url, width, height, left, top) {
  let features = "chrome,titlebar=no,modal=no,dialog=no,popup=yes,close=no," +
    "width=" + width + ",height=" + height;

  // Use wrapper document in order to load the web extension document in a iframe
  // all web extension codebase expect their document to be loaded in iframes and have message managers...
  url = "data:text/html;charset=utf-8," +
        "<style>body {margin: 0} iframe {border: none; width: 100%; height: 100%}</style>" +
        "<iframe mozbrowser=\"true\" src=\"" + url + "\" />";

  let win = Services.ww.openWindow(null, url, "popup-" + id, features, null);
  win.moveTo(left, top);

  return Promise.resolve();
}
function getPopupWindow(id) {
  let win = Services.ww.getWindowByName("popup-" + id, null);
  if (!win) {
    return Promise.resolve(null);
  }
  return waitForContentLoaded(win).then(() => {
    win = win.document.querySelector("iframe").contentWindow;
    return waitForContentLoaded(win).then(() => {
      return win;
    });
  });
}
function close(id) {
  let win = Services.ww.getWindowByName("popup-" + id, null);
  if (win) {
    win.close();
  }
}
*/

extensions.on("shutdown", (type, extension) => {
  for (let id in panels) {
    close(id);
  }
});

extensions.registerSchemaAPI("popup", "addon_parent", context => {
  let {extension} = context;
  return {
    popup: {
      open(url, width, height, left, top) {
        try {
          let id = popupId++;
          return create(id, url, width, height, left, top).then(() => {
            return id;
          }, (e) => dump("ex:"+e+"\n"));
        } catch(e) {
          dump("popup.ex > "+e+"\n");
        }
      },

      close(id) {
        close(id);
        return Promise.resolve();
      },

      postMessage(id, data) {
        return getPopupWindow(id).then(win => {
          if (win) {
            win.postMessage(data, "*");
          }
        });
      },

      onMessage: new SingletonEventManager(context, "popup.onMessage", (fire, id) => {
        try {
        let listener = event => {
          fire.async(event.data);
        };
        let promise = getPopupWindow(id);
        let cleanup = () => {
          if (!promise) {
            return;
          }
          promise.then(win => {
            if (win) {
              win.removeEventListener("message", listener);
              win.removeEventListener("unload", cleanup, true);
            }
          });
          promise = null;
        }

        promise.then(win => {
          if (win) {
            win.addEventListener("message", listener);
            win.addEventListener("unload", cleanup, true);
          }
        });
        return cleanup;
        } catch(e) {
          dump(" > "+e+"\n");
        }
      }).api()

    }
  };
});
