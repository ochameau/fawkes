'use strict';

chrome.browserAction.onClicked.addListener(function() {
  chrome.tabs.update({url: 'about:home'});
});
