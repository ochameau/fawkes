'use strict';

let DEBUG = true;
if (!DEBUG) {
  dump = () => {};
}

let groups;
let current;
try {
  groups = JSON.parse(localStorage["groups"]);
  current = JSON.parse(localStorage["current"]);
} catch(e) {
  groups = [];
  current = -1;
}

// Failsafes
if (groups.length == 0) {
  groups.push({ name: "default", tabs: [] });
  current = 0;
}
if (current < 0 || current >= groups.length) {
  current = 0;
}
// Avoid having two tabs in distinct groups
let ids = [];
groups.forEach(group => {
  group.tabs = group.tabs.filter(id => {
    let alreadySeen = ids.includes(id);
    ids.push(id);
    return !alreadySeen;
  });
});

// Update all tabs visibility immediately
select(current);

function create(name) {
  groups.push({ name, tabs: [] });
  save();
}
function select(position) {
  current = position;
  let { name, tabs, active } = groups[position];
  chrome.tabs.query({}, function (list) {
    for (let t of list) {
      let id = t.sessionId;
      let visible = tabs.includes(id);
      chrome.tabs.update(t.id, { visible, active: active == id } );
    }
  });
}
function save() {
  localStorage["groups"] = JSON.stringify(groups);
  localStorage["current"] = JSON.stringify(current);
}

chrome.tabs.onCreated.addListener(function (tabId, changeInfo, tab) {
  dump("onCreated("+tab.sessionId+")\n");
  let id = tab.sessionId;
  let group = groups[current];
  if (!group) return;
  if (group.tabs.includes(id)) {
    // If the id is already in the group, it means that we are restoring a previous session
    // so, ensure the tab is visible.
    if (!tab.visible) {
      chrome.tabs.update(tabId, { visible: true } );
    }
    return;
  }
  // If the id is in another group, it still means we are restoring a previous session
  // but this time we ensure the tab is hidden
  if (ids.includes(id)) {
    if (tab.visible) {
      chrome.tabs.update(tabId, { visible: false } );
    }
    return;
  }
  // Otherwise, it looks like a fresh new tab, so flag it for the current group
  group.tabs.push(id);
  save();


});
chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  dump("onUpdated("+tab.sessionId+")\n");
  if (!tab.active) {
    return;
  }
  let id = tab.sessionId;
  // Update current active tab for this group
  let group = groups[current];
  if (!group) return;
  if (!group.tabs.includes(id)) return;
  if (group.active == id) return;
  group.active = id;
  save();
});
chrome.tabs.onRemoved.addListener(function (tabId, changeInfo, tab) {
  let changed = false;
  let id = tab.sessionId;
  groups.forEach(function (group) {
    let idx = group.tabs.indexOf(id);
    if (idx != -1) {
      group.tabs.splice(idx, 1);
    }
  });
  let idx = ids.indexOf(id);
  if (idx != -1) {
    ids.splice(idx, 1);
  }
  if (changed) {
    save();
  }
});

chrome.runtime.onMessage.addListener(function(request, sender, reply) {
  switch (request.type) {
    case 'select':
      let { position } = request;
      select(position);
      break;

    case 'get':
      reply({ groups, current });
      break;

    case 'create':
      let { name } = request;
      create(name);
      break;
  };
});
