let DEBUG = false;
if (!DEBUG) {
  dump = () => {};
}

// Automatically select the urlbar when opening a new, already selected/active tab
chrome.tabs.onCreated.addListener(function (tabId, changeInfo, tab) {
  if (tab.active) {
    // When switching the a new tab, the awesomebar should hide
    hideAwesomebar();

    let urlbar = document.getElementById('urlbar');
    dump("urlbar.onCreate >> "+tab.url+"\n");
    if (tab.url != "about:newtab" && tab.url != "about:blank") {
      urlbar.value = tab.url;
    } else {
      urlbar.dataset.originalUri = tab.url;
      urlbar.value = "";
    }
    if (tab.active) {
      currentTab = tabId;
    }
    window.focus();
    urlbar.focus();
  }
});

let currentTab;
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  dump("urlbar.onUpdated("+tabId+": "+tab.url+")\n");
  if (!tab.active) {
    dump("urlbar.onUpdated > tab not active\n");
    return;
  }

  let urlbar = document.getElementById('urlbar');
  if (currentTab != tabId) {
    currentTab = tabId;
    // If we are switching to a new tab, blur the urlbar
    urlbar.blur();
  }

  // Update original uri if the urlbar is focused
  // (originalUri is set while focused)
  // so that we can restore the real document url on escape press
  if ("originalUri" in urlbar.dataset) {
    urlbar.dataset.originalUri = tab.url;
  } else {
    // Otherwise, if we are not focused, update the urlbar with whatever
    // is the document url. Do a quick hack to keep an empty urlbar for blank and newtab.
    if (tab.url != "about:newtab" && tab.url != "about:blank") {
      urlbar.value = tab.url;
    } else {
      urlbar.value = "";
    }
  }

  // Update the stop or reload button
  let state = tab.status == "loading" ? "stop" : "reload";
  let stopReload = document.getElementById("stop-reload");
  stopReload.setAttribute("state", state);
});

chrome.commands.onCommand.addListener(function (command) {
  if (command == "focus-url-bar") {
    let urlbar = document.getElementById('urlbar');
    window.focus();
    urlbar.select();
  }
  else if (command == "back" || command == "back-mouse") {
    goBack();
  }
  else if (command == "forward" || command == "forward-mouse") {
    goForward();
  } else if (command == "reload-tab" || command == "reload-tab-2") {
    reloadTab();
  }
});

function onAwesomebarMessage(data) {
  dump("urlbar.onAwesomebarMessage > "+JSON.stringify(data)+"\n");
  let urlbar = document.getElementById('urlbar');
  if (data.selectedUri) {
    if (!urlbar.dataset.userInput) {
      urlbar.dataset.userInput = urlbar.value;
    }
    urlbar.value = data.selectedUri;
  } else if (data.autocomplete) {
    urlbar.dataset.userInput = urlbar.value.substr(0, urlbar.selectionStart);
    let pos = urlbar.selectionStart;
    urlbar.value = data.autocomplete;
    urlbar.setSelectionRange(pos, urlbar.value.length);
  } else if (data.open) {
    urlbar.value = data.open;
    urlbar.blur();
  } else if (data.unload) {
    hideAwesomebar();
  }
}
let awesomebarId;
function showAwesomebar() {
  if (awesomebarId) {
    return;
  }
  // Immediately set an invalid but non-falsy id to prevent displaying more than one awesomebar
  awesomebarId = new Promise(gotBarId => {
    chrome.browserui.getAll(function (uis) {
      let url = uis["awesomebar"];
      if (url) {
        let x = Math.round(window.mozInnerScreenX);
        let y = Math.round(window.mozInnerScreenY + window.innerHeight);
        chrome.popup.open(url, window.innerWidth, 200, x, y, id => {
          gotBarId(id);
          chrome.popup.onMessage.addListener(onAwesomebarMessage, id);
          let urlbar = document.getElementById("urlbar");
          chrome.popup.postMessage(id, { command: "search", value: urlbar.value });
        });
      } else {
        awesomebarId = null;
      }
    });
  });
}
function hideAwesomebar() {
  if (awesomebarId) {
    awesomebarId.then(id => {
      chrome.popup.onMessage.removeListener(onAwesomebarMessage, id);
      chrome.popup.close(id);
    });
    awesomebarId = null;
  }
}

window.addEventListener("blur", hideAwesomebar, true);

function onDocumentLoaded() {
  removeEventListener('load', onDocumentLoaded);

  let urlbar = document.getElementById('urlbar');

  let lastInput = "";
  urlbar.addEventListener('input', function (evt) {
    dump("urlbar.onInput("+urlbar.value+")\n");
    if (urlbar.value == lastInput) {
      return;
    }
    lastInput = urlbar.value;
    if (urlbar.value.length > 0) {
      if (awesomebarId) {
        awesomebarId.then(id => {
          chrome.popup.postMessage(id, { command: "search", value: urlbar.value });
        });
      } else {
        showAwesomebar();
      }
    }
  });
  urlbar.addEventListener('focus', function() {
    dump("urlbar.focus("+urlbar.value+")\n");
    if (!urlbar.dataset.originalUri) {
      urlbar.dataset.originalUri = urlbar.value;
    }
    urlbar.dataset.userInput = "";
    urlbar.select();
  });
  urlbar.addEventListener('blur', function() {
    dump("urlbar.blur("+urlbar.value+")\n");
    delete urlbar.dataset.originalUri;
    delete urlbar.dataset.userInput;
    hideAwesomebar();
  });

  let back = document.getElementById('back');
  back.addEventListener('click', goBack);

  let forward = document.getElementById('forward');
  forward.addEventListener('click', goForward);

  let stopOrReload = document.getElementById('stop-reload');
  stopOrReload.addEventListener('click', function() {
    let state = stopOrReload.getAttribute("state");
    if (state == "reload") {
      reloadTab();
    } else if (state == "stop") {
      chrome.tabs.do(null, "stop");
    }
  });
}
addEventListener('load', onDocumentLoaded);

function reloadTab() {
  chrome.tabs.do(null, "reload");
}

function onKeyPress(event) {
  dump("onKeyPress: "+event.keyCode+"\n");
  let urlbar = document.getElementById('urlbar');
  if (event.keyCode == 27) { // Escape
    if (urlbar.dataset.userInput) {
      urlbar.value = urlbar.dataset.userInput;
      delete urlbar.dataset.userInput;
      event.preventDefault();
      event.stopPropagation();
    } else if (urlbar.dataset.originalUri) {
      urlbar.value = urlbar.dataset.originalUri;
      delete urlbar.dataset.originalUri;
      urlbar.select();
    }
    hideAwesomebar();
  } else if (event.keyCode == 40) { // Down
    event.preventDefault();
    event.stopPropagation();
    if (!awesomebarId) {
      showAwesomebar();
    } else {
      awesomebarId.then(id => {
        chrome.popup.postMessage(id, { command: "down" });
      });
    }
  }


  if (event.keyCode == 13) { // Enter
    if (!awesomebarId) {
      let url = urlbar.value;
      if (isInputURL(url)) {
        url = formatURL(url);
      } else {
        url = "https://www.google.com/search?q=" + encodeURIComponent(url);
      }
      chrome.tabs.update(null, { url });
    } else {
      awesomebarId.then(id => {
        chrome.popup.postMessage(id, { command: "open", value: urlbar.value });
      });
    }
    // Ensure hiding the awesomebar and reset the urlbar value to the newly
    // loaded url on next tabs.onUpdate event
    currentTab = -1;
    delete urlbar.dataset.originalUri;
  } else if (event.keyCode == 38) { // Up
    if (awesomebarId) {
      awesomebarId.then(id => {
        chrome.popup.postMessage(id, { command: "up" });
      });
    }
    event.preventDefault();
    event.stopPropagation();
  }

}
addEventListener('keypress', onKeyPress);

const URL_REGEX = /\w\.\w+/;
const ABOUT_REGEX = /\w:(\/\/)?\w+/;
function isInputURL(input) {
  return URL_REGEX.test(input) || ABOUT_REGEX.test(input);
}

function formatURL(url) {
  if (!url.match(/\w+:/)) {
    url = "http://" + url;
  }
  return url;
}

function goBack() {
  chrome.tabs.do(null, "back");
}
function goForward() {
  chrome.tabs.do(null, "forward");
}
