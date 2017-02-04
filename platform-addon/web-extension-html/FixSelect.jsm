/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Helps implement <select> dropdowns by forwarding a mozbrowserselectmenu
 * event to the deck addon.
 *
 * - Inject select-child.js frame script that listen for mozshowdropdown
 *   and translate that to a message manager message Forms:ShowDropDown.
 * - Listen for Forms:ShowDropDown message and translate it to a mozbrowserselectmenu
 *   event sent on <iframe mozbrowser>
 * 
 */

"use strict";

let EXPORTED_SYMBOLS = [];

let Cc = Components.classes;
let Ci = Components.interfaces;
let Cu = Components.utils;

Cu.import("resource://gre/modules/Services.jsm");

Services.mm.addMessageListener("Forms:ShowDropDown", function (msg) {
  let frame = msg.target;
  let { messageManager } = frame;
  let window = frame.ownerDocument.defaultView;
  let detail = Cu.cloneInto(msg.data, window);
  Cu.exportFunction(function(index) {
    messageManager.sendAsyncMessage('Forms:SelectDropDownItem', {value: index});
  }, detail, { defineAs: 'select' });

  Cu.exportFunction(function() {
    messageManager.sendAsyncMessage('Forms:DismissedDropDown', {});
  }, detail, { defineAs: 'close' });
  let evt = new window.CustomEvent('mozbrowserselectmenu', {
    bubbles: true,
    cancelable: true,
    detail
  });

  frame.dispatchEvent(evt);
});
Services.mm.loadFrameScript("resource://webextensions/frame-scripts/select-child.js", true);
