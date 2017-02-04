let DEBUG = false;
if (!DEBUG) {
  dump = () => {};
}

if (navigator.appVersion.indexOf('Win') >= 0) {
  document.documentElement.setAttribute('os', 'windows');
}
if (navigator.appVersion.indexOf('Mac') >= 0) {
  document.documentElement.setAttribute('os', 'osx');
}
if (navigator.appVersion.indexOf('X11') >= 0) {
  document.documentElement.setAttribute('os', 'linux');
}

let isVertical = document.documentElement.classList.contains('vertical-tabs');
if (localStorage["tree"] === "1") {
  document.documentElement.classList.add('tree');
}
let isTree = document.documentElement.classList.contains('tree');

function Tab(id) {
  this.id = id;

  let hbox = document.createElement('div');
  hbox.className = 'tab';
  hbox.setAttribute('align', 'center');

  let throbber = document.createElement('div');
  throbber.className = 'throbber';

  let favicon = document.createElement('img');
  favicon.className = 'favicon';

  let title = document.createElement('div');
  title.className = 'title';

  let button = document.createElement('button');
  button.className = 'close-button';
  button.title = 'Close Tab';

  button.onmouseup = (event) => {
    if (event.button == 0) {
      event.stopPropagation();
      this.remove();
    }
  };

  hbox.onmousedown = (event) => {
    if (event.button == 0 &&
        !event.target.classList.contains("close-button")) {
      this.highlight();
    }
  };

  hbox.onmouseup = (event) => {
    if (event.button == 1) {
      event.stopPropagation();
      this.remove();
    }
  }

  hbox.appendChild(throbber);
  hbox.appendChild(favicon);
  hbox.appendChild(title);
  hbox.appendChild(button);

  this._dom = hbox;

  document.getElementById("tabs").appendChild(this._dom);
}

Tab.prototype = {
  depth: 0,

  get tabIframe() {
    return this._tabIframe;
  },

  get dom() {
    return this._dom;
  },

  destroy: function() {
    this.dom.remove();
  },

  highlight: function() {
    chrome.tabs.highlight({ tabs: this.id });
  },

  remove: function() {
    chrome.tabs.remove(this.id);
  },

  select: function() {
    this.dom.classList.add('selected');
  },

  unselect: function() {
    this.dom.classList.remove('selected');
  },

  // chrome.tabs.Tab instance for this tab. 
  tab: null,

  update: function(tab) {
    this.tab = tab;

    if (tab.status == "loading" && tab.url && tab.url != "about:newtab" && tab.url != "about:blank") {
      this.dom.classList.add('loading');
    } else {
      this.dom.classList.remove('loading');
    }

    let title = tab.title;
    if (!title) {
      if (tab.url) {
        title = tab.url;
      } else {
        title = 'New Tab';
      }
    }
    this.dom.querySelector('.title').textContent = title;
    this.dom.setAttribute('title', title);

    if (tab.active) {
      // Automatically sroll to see the tab if it becomes active
      this.scrollIntoView();
      this.dom.classList.add('selected');
    } else {
      this.dom.classList.remove('selected');
    }

    let faviconImg = this.dom.querySelector('.favicon');
    if (tab.favIconUrl) {
      faviconImg.src = tab.favIconUrl;
    } else {
      faviconImg.removeAttribute('src');
    }

    let opener = tab.openerTabId;
    if (opener) {
      let parent = tabs.get(opener);
      if (tab) {
        this.depth = parent.depth + 1;
        if (isTree) {
          this.dom.style.marginLeft = (this.depth * 10) + "px";
          if (!this.dom.depth) {
            let next = parent.dom.nextSibling;
            while (next.depth == this.depth) {
              next = next.nextSibling;
            }
            if (next) { 
              document.getElementById("tabs").insertBefore(this.dom, next);
            } else {
              document.getElementById("tabs").appendChild(this.dom);
            }
          }
        }
        this.dom.depth = this.depth;
      }
    }

    if (this.depth > 0) {
      this.dom.classList.add("branch");
    } else {
      this.dom.classList.remove("branch");
    }
  },

  scrollIntoView() {
    let tabs = document.getElementById("tabs");
    let tabsRect = tabs.getBoundingClientRect();
    if (isVertical) {
      let { top, bottom} = this.dom.getBoundingClientRect();
      top -= tabsRect.top;
      bottom -= tabsRect.top;
      if (top < 0) {
        tabs.scrollBy(0, top);
      }
      if (bottom > tabs.clientHeight) {
        tabs.scrollBy(bottom - tabs.clientHeight, 0);
      }
    } else {
      let { left, right } = this.dom.getBoundingClientRect();
      left -= tabsRect.left;
      right -= tabsRect.left;
      if (left < 0) {
        tabs.scrollBy(left, 0);
      }
      if (right > tabs.clientWidth) {
        tabs.scrollBy(right - tabs.clientWidth, 0);
      }
    }
  }
};

let tabs = new Map();
let tabsOrder = [];
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, t) {
  dump("tabs.onUpdate("+tabId+": "+JSON.stringify(t)+")\n");
  let tab = tabs.get(tabId);
  if (!tab) {
    tab = new Tab(tabId);
    tabs.set(tabId, tab);
    tabsOrder.push(tabId);
  }
  tab.update(t);
});
let lastDestroyedTabs = [];
chrome.tabs.onRemoved.addListener(function (tabId, removeInfo) {
  dump("tabs.onRemoved("+tabId+")\n");
  let tab = tabs.get(tabId);
  if (!tab) {
    return;
  }
  tab.destroy();
  tabs.delete(tabId);
  lastDestroyedTabs.unshift(tab);
  let idx = tabsOrder.indexOf(tabId);
  if (idx != -1) {
    tabsOrder.splice(idx, 1);
  }
});

function restoreLastDestroyedTab() {
  let tab = lastDestroyedTabs.shift();
  if (!tab) {
    return;
  }
  chrome.tabs.create({ url: tab.tab.url, active:true });
}

chrome.tabs.query({}, function (list) {
  for (let t of list) {
    let { id } = t;
    let tab = tabs.get(id);
    if (!tab) {
      tab = new Tab(id);
      tabs.set(id, tab);
      tabsOrder.push(id);
    }
    tab.update(t);
  }
  // Ensure having at list one tab at startup!
  if (list.length == 0) {
    chrome.tabs.create({ url: "about:home", active: true });
  }
});

chrome.commands.onCommand.addListener(function (command) {
  dump(" command > "+command+"\n");
  if (command == "create-new-tab") {
    chrome.tabs.create({ url: "about:blank", active:true, openerTabId: null });
  } else if (command == "next-tab" || command == "next-tab-2") {
    for (let [id, tab] of tabs.entries()) {
      if (tab.dom.classList.contains('selected')) {
        let idx = tabsOrder.indexOf(id);
        let next = tabsOrder[idx+1] || tabsOrder[0];
        if (next) {
          chrome.tabs.highlight({ tabs: next });
        }
      }
    }
  } else if (command == "previous-tab" || command == "previous-tab-2") {
    for (let [id, tab] of tabs.entries()) {
      if (tab.dom.classList.contains('selected')) {
        let idx = tabsOrder.indexOf(id);
        let previous = tabsOrder[idx-1] || tabsOrder[tabsOrder.length - 1];
        if (previous) {
          chrome.tabs.highlight({ tabs: previous });
        }
      }
    }
  } else if (command == "close-tab") {
    if (tabs.size == 1) {
      return;
    }
    for (let [id, tab] of tabs.entries()) {
      if (tab.dom.classList.contains('selected')) {
        tab.remove();
      }
    }
  } else if (command == "restore-tab") {
    restoreLastDestroyedTab();
  } else if (command.startsWith("select-tab")) {
    let n = parseInt(command.match(/select-tab-(\d)/)[1]) - 1;
    chrome.tabs.highlight({ tabs: tabsOrder[n] });
  }
});

function onDocumentLoaded() {
  removeEventListener('load', onDocumentLoaded);
  if (!document.documentElement.classList.contains('vertical-tabs')) {
    setTimeout(BuildCurvedTabs, 0);
  }
  document.querySelector("#new-tab").addEventListener("click", function () {
    chrome.tabs.create({ url: "about:blank", active: true });
  });
  document.querySelector("#tree").addEventListener("click", function () {
    // Watchout, localStorage convert everything to strings...
    localStorage["tree"] = localStorage["tree"] === "1" ? "0" : "1";
    location.reload();
  });
  document.querySelector(".scroll.left").addEventListener("click", onScrollClick);
  document.querySelector(".scroll.right").addEventListener("click", onScrollClick);
  document.querySelector("#tabs").addEventListener("scroll", onScroll);
  document.querySelector("#tabs").addEventListener("wheel", onWheel);
}
addEventListener('load', onDocumentLoaded);

function BuildCurvedTabs() {
  let curveDummyElt = document.querySelector('.dummy-tab-curve');
  let style = window.getComputedStyle(curveDummyElt);

	let curveBorder = style.getPropertyValue('--curve-border');
	let curveGradientStart = style.getPropertyValue('--curve-gradient-start');
	let curveGradientEnd = style.getPropertyValue('--curve-gradient-end');
	let curveHoverBorder = style.getPropertyValue('--curve-hover-border');
	let curveHoverGradientStart = style.getPropertyValue('--curve-hover-gradient-start');
	let curveHoverGradientEnd = style.getPropertyValue('--curve-hover-gradient-end');

  let c1 = document.createElement('canvas');
  c1.id = 'canvas-tab-selected';
  c1.hidden = true;
  c1.width = 3 * 28;
  c1.height = 28;
  drawBackgroundTab(c1, curveGradientStart, curveGradientEnd, curveBorder);
  document.body.appendChild(c1);

  let c2 = document.createElement('canvas');
  c2.id = 'canvas-tab-hover';
  c2.hidden = true;
  c2.width = 3 * 28;
  c2.height = 28;
  drawBackgroundTab(c2, curveHoverGradientStart, curveHoverGradientEnd, curveHoverBorder);
  document.body.appendChild(c2);

  function drawBackgroundTab(canvas, bg1, bg2, borderColor) {
    canvas.width = window.devicePixelRatio * canvas.width;
    canvas.height = window.devicePixelRatio * canvas.height;
    let ctx = canvas.getContext('2d');
    let r = canvas.height;
    ctx.save();
    ctx.beginPath();
    drawCurve(ctx, r);
    ctx.lineTo(3 * r, r);
    ctx.lineTo(0, r);
    ctx.closePath();
    ctx.clip();

    // draw background
    let lingrad = ctx.createLinearGradient(0, 0, 0, r);
    lingrad.addColorStop(0, bg1);
    lingrad.addColorStop(1, bg2);
    ctx.fillStyle = lingrad;
    ctx.fillRect(0, 0, 3 * r, r);

    // draw border
    ctx.restore();
    ctx.beginPath();
    drawCurve(ctx, r);
    ctx.strokeStyle = borderColor;
    ctx.stroke();
  }

  function drawCurve(ctx, r) {
    let firstLine = 1 / window.devicePixelRatio;
    ctx.moveTo(r * 0, r * 0.984);
    ctx.bezierCurveTo(r * 0.27082458, r * 0.95840561,
                      r * 0.3853096, r * 0.81970962,
                      r * 0.43499998, r * 0.5625);
    ctx.bezierCurveTo(r * 0.46819998, r * 0.3905,
                      r * 0.485, r * 0.0659,
                      r * 0.95,  firstLine);
    ctx.lineTo(r + r * 1.05, firstLine);
    ctx.bezierCurveTo(3 * r - r * 0.485, r * 0.0659,
                      3 * r - r * 0.46819998, r * 0.3905,
                      3 * r - r * 0.43499998, r * 0.5625);
    ctx.bezierCurveTo(3 * r - r * 0.3853096, r * 0.81970962,
                      3 * r - r * 0.27082458, r * 0.95840561,
                      3 * r - r * 0, r * 0.984);
  }
}

let lastClick = 0;
function onScrollClick(event) {
  let tabs = document.getElementById("tabs");
  let amountToScroll = 100;
  if (performance.now() - lastClick < 500) {
    amountToScroll = isVertical ? tabs.clientHeight : tabs.clientWidth;
  }
  let direction = event.target.classList.contains("left") ? -1 : 1;
  let scroll = amountToScroll*direction;
  if (isVertical) {
    tabs.scrollBy(0, scroll);
  } else {
    tabs.scrollBy(scroll, 0);
  }
  lastClick = performance.now();
}

function onWheel(event) {
  let tabs = document.getElementById("tabs");
  let amountToScroll = 1;
  switch(event.deltaMode) {
    case 0:
      amountToScroll = 1;
      break;
    case 1:
      amountToScroll = 100;
      break;
    case 2:
      amountToScroll = tabs.clientWidth;
      break;
  }
  let direction = event.deltaX || event.deltaY;
  let scroll = amountToScroll*direction;
  if (isVertical) {
    tabs.scrollBy(0, scroll);
  } else {
    tabs.scrollBy(scroll, 0);
  }
}

function onScroll() {
  let tabs = document.getElementById("tabs");
  if ((isVertical && tabs.scrollTop == 0) || (!isVertical && tabs.scrollLeft == 0)) {
    document.querySelector(".scroll.left").classList.add("disabled");
  } else {
    document.querySelector(".scroll.left").classList.remove("disabled");
  }
  if ((isVertical && tabs.scrollTop == tabs.scrollTopMax) || (!isVertical && tabs.scrollLeft == tabs.scrollLeftMax)) {
    document.querySelector(".scroll.right").classList.add("disabled");
  } else {
    document.querySelector(".scroll.right").classList.remove("disabled");
  }
}
