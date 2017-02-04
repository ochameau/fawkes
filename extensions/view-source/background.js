'use strict';

chrome.browserAction.onClicked.addListener(function() {
  chrome.tabs.getCurrent((tab) => {
    chrome.tabs.create({url: 'view-source:' + tab.url});
  });
});
