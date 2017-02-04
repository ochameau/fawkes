let DEBUG = false;
if (!DEBUG) {
  dump = () => {};
}

// Prevent dragging content scrollbars, but also anything from content...
addEventListener("dragstart", e => {
  e.preventDefault(); e.stopPropagation();
});

let windowOpenFrames = new Map();

// Non-Remote iframes may steal the focus :/
const INPROCESS_URLS = [
     'about:'
   , 'about:addons'
   , 'about:buildconfig'
   , 'about:config'
   , 'about:cache'
   , 'about:crashes'
   , 'about:debugging'
   , 'about:devtools-toolbox'
   , 'about:downloads'
   , 'about:healthreport'
   , 'about:networking'
   , 'about:nightly'
   , 'about:newtab'
   , 'about:performance'
   , 'about:plugins'
   , 'about:preferences'
   , 'about:sharing'
   , 'about:support'
   , 'about:telemetry'
   , 'about:webrtc'
];

// Tab JS object.
function Tab() {
  this.remote = true;
  this.location = this.lastUrl = "about:blank";
}

Tab.prototype = {
  createDom: function (tab) {
    // When a website calls window.open, mozbrowseropenwindow fires with a pre-created iframe
    // try to fetch it first before creating a new one
    this.iframe = windowOpenFrames.get(tab.url);
    windowOpenFrames.delete(tab.url);

    if (!this.iframe) {
      this.iframe = document.createElement('iframe');
    }
    this.iframe.setAttribute("mozbrowser", "true");
    if (this.remote) {
      this.iframe.setAttribute("remote", "true");
    }
    dump("create dom "+this.remote+"\n");

    this.iframe.setAttribute("mozpasspointerevents", "true");

    // /!\ Critical information set for WebExtension codebase.
    // Allows to know for which tab a given iframe is associated
    this.id = tab.id;
    this.iframe.setAttribute("data-tab-id", this.id);

    this.addListeners();
    if (!this.iframe.parentNode) {
      document.body.appendChild(this.iframe);
    }

    // setVisible can only be called after the iframe is added to the DOM tree
    this.iframe.setVisible(false);
  },

  events: [
    "mozbrowserlocationchange",
    "mozbrowserloadstart",
    "mozbrowserloadend",
    "mozbrowsertitlechange",
    "mozbrowsersecuritychange",
    "mozbrowserfirstpaint",
    "mozbrowsererror",
    "mozbrowsericonchange",
    "mozbrowseropenwindow",
    "mozbrowseropentab",
    "mozbrowsercontextmenu",
    "mozbrowsershowmodalprompt",
    "mozbrowserclose",
    "mozbrowserselectmenu",
  ],

  addListeners: function () {
    this.events.forEach(name => {
      this.iframe.addEventListener(name, this);
    });
  },

  removeListeners: function () {
    if (!this.iframe) {
      return;
    }
    this.events.forEach(name => {
      this.iframe.removeEventListener(name, this);
    });
  },

  destroy: function() {
    this.removeListeners();
    if (this.iframe) {
      this.iframe.remove();
    }
  },

  remove: function() {
    chrome.tabs.remove(this.id);
  },

  handleEvent: function(event) {
    dump("deck.handleEvent("+event.type+")\n");
    // Ignore events from about:blank when the tab is discarded
    if (this.discarded) {
      return;
    }
    switch(event.type) {
      case "mozbrowserlocationchange":
        this.location = event.detail.url;
        dump("locationchange("+this.id+"):" + this.location+"\n");
        chrome.tabs.update(this.id, { url: this.location });
        break;
      case "mozbrowserloadstart":
        chrome.tabs.update(this.id, { status: "loading" });
        break;
      case "mozbrowserloadend":
        chrome.tabs.update(this.id, { status: "complete" });
        break;
      case "mozbrowsererror":
        chrome.tabs.update(this.id, { status: "complete" });
        break;
      case "mozbrowsericonchange":
        chrome.tabs.update(this.id, { favIconUrl: event.detail.href });
        break;
      case "mozbrowsertitlechange":
        chrome.tabs.update(this.id, { title: event.detail });
        break;
      case "mozbrowseropenwindow":
      case "mozbrowseropentab":
        dump("deck.openWindowOrTab: " + event.type+" -- "+Object.keys(event.detail)+" -- "+JSON.stringify(event.detail)+"\n");
        // Immediately append the frame to the DOM (mozbrowseropenwindow expectation)
        // and save it for later when we finally create the related tab
        let frame = event.detail.frameElement;
        if (frame) {
          windowOpenFrames.set(event.detail.url, frame);
          frame.setAttribute("mozbrowser", "true");
          document.body.appendChild(frame);
        }

        chrome.tabs.create({
          url: event.detail.url,
          active: true,
          openerTabId: this.id
        });
        break;
      case "mozbrowsershowmodalprompt":
        dump("modal: "+JSON.stringify(event.detail)+"\n");
        break;
      case "mozbrowserselectmenu":
        let { left, top, width, height } = event.detail.rect;
        let { options } = event.detail;
        let url = location.href.replace("deck.html", "selectmenu.html");
        // Use parseInt as sometimes, values from detail.rect are float.
        let popupHeight = Math.min(options.length * 30 + 2, 300);
        chrome.popup.open(url, 200, popupHeight, parseInt(left), parseInt(top + height), id => {
          chrome.popup.onMessage.addListener(function (idx) {
            // By default messages are converted to strings
            idx = parseInt(idx);
            if (isNaN(idx)) return;
            dump("Select > "+idx+"\n");
            if (idx >= 0) {
              event.detail.select(idx);
            }
            // We have to call close no matter what otherwise none of the other select would work
            event.detail.close();
          }, id);
          chrome.popup.postMessage(id, { options });
        });
        break;
    }
  },

  updateDom: function(tab) {
    // Update tab remotenesss if needed
    let shouldBeRemote = !INPROCESS_URLS.includes(tab.url) && tab.url && !tab.url.startsWith("chrome:");
    if (shouldBeRemote != this.remote) {
      this.destroy();
      this.remote = shouldBeRemote;
      this.createDom(tab);
    } if (!this.iframe) {
      this.createDom(tab);
    }

    this.discarded = tab.discarded;

    if (this.location != tab.url && this.lastUrl != tab.url && (!tab.discarded || tab.active)) {
      dump("deck.setAttribute("+this.id+") this.location:"+this.location+" tab.url:"+tab.url+"\n");
      this.location = this.lastUrl = tab.url;
      this.iframe.setAttribute("src", this.location);
    }

    if (tab.active) {
      this.iframe.classList.add('active');
    } else {
      this.iframe.classList.remove('active');
    }

    // Platform recently changed browser-element API to be available
    // So it depends on some hacks done in WebExtDocAddPrivileges.jsm
    this.iframe.setVisible(!!tab.active);
  },
};

// Cache all `Tab` instances
let tabs = new Map();

// Keep around a preloaded tab to speed up tab opening
let cachedTab = new Tab();

function updateTab(addonTab) {
  let id = addonTab.id;
  let domTab = tabs.get(id);
  if (!domTab) {
    //domTab = cachedTab;
    if (!domTab) {
      domTab = new Tab();
    } else {
      window.setTimeout(function () {
        cachedTab = new Tab();
      }, 0);
    }
    tabs.set(id, domTab);
  }
  domTab.updateDom(addonTab);
}
chrome.tabs.onAction.addListener(function (tabId, action) {
  let tab = tabs.get(tabId);
  if (!tab) {
    return;
  }
  let iframe = tab.iframe;
  if (!iframe) {
    return;
  }
  if (action == "stop") {
    iframe.stop();
  }
  else if (action == "reload") {
    iframe.reload(false);
  }
  else if (action == "back") {
    iframe.goBack();
  }
  else if (action == "forward") {
    iframe.goForward();
  }
});
chrome.tabs.onUpdated.addListener(function (id, changeInfo, tab) {
  dump("deck.onUpdate("+id+": "+JSON.stringify(tab)+")\n");
  updateTab(tab);
});
chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
  dump("deck.onRemoved("+tabId+")\n");
  let tab = tabs.get(tabId);
  if (!tab) {
    return;
  }
  tab.destroy();
  tabs.delete(tabId);
});
chrome.tabs.query({}, function (tabs) {
  for (let tab of tabs) {
    updateTab(tab);
  }
});

chrome.commands.onCommand.addListener(function (command) {
  if (command == "search") {
    let searchInput = document.getElementById("search-input");
    toggleFind(true);
    if (searchInput != document.activeElement) {
      window.focus();
      searchInput.focus();
    } else {
      search("forward");
    }
  }
});

function toggleFind(visible) {
  let searchBar = document.getElementById("findbar");
  if (visible) {
    searchBar.classList.add("active");
  } else {
    searchBar.classList.remove("active");
  }
}
function search(direction) {
  let currentIframe = document.querySelector("iframe.active");
  currentIframe.findNext("forward");
}

function onDocumentLoaded() {
  removeEventListener('load', onDocumentLoaded);
  let searchInput = document.getElementById("search-input");
  searchInput.oninput = function() {
    let currentIframe = document.querySelector("iframe.active");
    currentIframe.findAll(searchInput.value, "case-insensitive");
  };
  searchInput.onkeypress = function(e) {
    if (e.keyCode == 13) { // Enter
      search("forward");
    }
    if (e.keyCode == 27) { // Escape
      let currentIframe = document.querySelector("iframe.active");
      currentIframe.clearMatch();
      toggleFind(false);
    }
  };
  let searchForward = document.getElementById("search-next");
  searchForward.onclick = search.bind(null, "forward");
  let searchBackward = document.getElementById("search-previous");
  searchBackward.onclick = search.bind(null, "backward");
  let searchClose = document.getElementById("search-close");
  searchClose.onclick = toggleFind.bind(null, false);
}
addEventListener('load', onDocumentLoaded);
