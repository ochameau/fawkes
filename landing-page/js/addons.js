addEventListener("load", function () {
  updateAddonState();

  let group = document.querySelector(".group.addons");
  group.addEventListener("click", function(event) {
    let { id, path } = event.target.dataset;
    if (!id) return;
    if (event.target.classList.contains("keep-installed")) {
      if (event.target.processing) return;
      event.target.processing = true;
      disable(path, id).then(() => {
        event.target.classList.remove("enabled");
        event.target.processing = false;
      });
    }
    event.target.classList.toggle("keep-installed");
  });

  group.addEventListener("mouseover", function(event) {
    let { id, path } = event.target.dataset;
    if (!id) return;
    if (!event.target.classList.contains("enabled")) {
      if (event.target.processing) return;
      event.target.processing = true;
      enable(path, id).then(() => {
        event.target.classList.add("enabled");
        event.target.processing = false;
      });
    }
  });

  group.addEventListener("mouseout", function(event) {
    let { id, path } = event.target.dataset;
    if (!id) return;
    if (event.target.classList.contains("keep-installed")) {
      return;
    }
    if (event.target.classList.contains("enabled")) {
      if (event.target.processing) return;
      event.target.processing = true;
      disable(path, id).then(() => {
        event.target.classList.remove("enabled");
        event.target.processing = false;
      });
    }
  });
});

function updateAddonState() {
  for(let addon of document.querySelectorAll(".group.addons li")) {
    let extension = addon;
    let { id, path } = addon.dataset;
    isInstalled(id).then(function (addon, installed) {
      if (installed) {
        addon.classList.add("enabled");
        addon.classList.add("keep-installed");
      } else {
        addon.classList.remove("enabled");
      }
      addon.classList.add("loaded");
    }.bind(null, addon));
  }
}

let am = navigator.mozAddonManager;

let cache = {};

function getAddonByID(id) {
  return new Promise(function(resolve, reject) {
    if (cache[id]) {
      resolve(cache[id]);
    }

    am.getAddonByID(id).then(
      function success(addon) {
        if (!addon) {
          resolve(null);
          return;
        }

        cache[id] = addon;
        resolve(cache[id]);
      },
      function failure() {
        reject();
      }
    );
  });
}

let channel = new BroadcastChannel("addons");

function isInstalled(id) {
  return new Promise(done => {
    channel.addEventListener("message", function onMessage({ data }) {
      if (data.event == "isInstalledResponse" && data.id == id) {
        channel.removeEventListener("message", onMessage);
        done(data.isInstalled);
      }
    });
    channel.postMessage({ event: "isInstalled", id });
  });
}

function enable(path, id) {
  return new Promise(done => {
    let url = new URL(path, location).href;
    channel.addEventListener("message", function onMessage({ data }) {
      if (data.event == "installed" && data.id == id) {
        channel.removeEventListener("message", onMessage);
        done();
      }
    });
    channel.postMessage({ event: "install", url, id });
  });
}

function disable(path, id) {
  return new Promise(done => {
    channel.addEventListener("message", function onMessage({ data }) {
      if (data.event == "uninstalled" && data.id == id) {
        channel.removeEventListener("message", onMessage);
        done();
      }
    });
    channel.postMessage({ event: "uninstall", id });
  });
}
