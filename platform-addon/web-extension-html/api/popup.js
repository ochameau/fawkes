Cu.import("resource://gre/modules/ExtensionUtils.jsm");

/*
 * Implement chrome.popup
 *
 * Allows opening popup windows at arbitrary positions.
 * Mostly used to open the Awesomebar.
 */

var {
    SingletonEventManager,
} = ExtensionUtils;

let popupId = 1;

let popups = new Set();

function waitForContentLoaded(win) {
  if (win.document.readyState == "complete") {
    return Promise.resolve(win);
  }
  return new Promise(done => {
    win.addEventListener("load", done, { once: true })
  });
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

extensions.on("shutdown", (type, extension) => {
  for (let id of popups) {
    close(id);
  }
});

extensions.registerSchemaAPI("popup", "addon_parent", context => {
  let {extension} = context;
  return {
    popup: {
      open(url, width, height, left, top) {
        let id = popupId++;

        //let features = "directories=no,titlebar=no,toolbar=no,location=no,status=no,menubar=no,scrollbars=no,resizable=no,popup=yes,dialog=yes," +
        let features = "chrome,titlebar=no,modal=no,dialog=no,popup=yes,close=no," +
          "width=" + width + ",height=" + height;

        // Use wrapper document in order to load the web extension document in a iframe
        // all web extension codebase expect their document to be loaded in iframes and have message managers...
        url = "data:text/html;charset=utf-8," +
              "<style>body {margin: 0} iframe {border: none; width: 100%; height: 100%}</style>" +
              "<iframe mozbrowser=\"true\" src=\"" + url + "\" />";

        let win = Services.ww.openWindow(null, url, "popup-" + id, features, null);
        win.moveTo(left, top);

        return Promise.resolve(id);
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
      }).api()

    }
  };
});
