let AutoCompletePopup = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIAutoCompletePopup]),

  _connected: false,

  MESSAGES: [
    "FormAutoComplete:HandleEnter",
    "FormAutoComplete:PopupClosed",
    "FormAutoComplete:PopupOpened",
    "FormAutoComplete:RequestFocus",
  ],

  init: function() {
    addEventListener("unload", this);
    addEventListener("DOMContentLoaded", this);

    for (let messageName of this.MESSAGES) {
      addMessageListener(messageName, this);
    }

    this._input = null;
    this._popupOpen = false;
  },

  destroy: function() {
    if (this._connected) {
      let controller = Cc["@mozilla.org/satchel/form-fill-controller;1"]
                         .getService(Ci.nsIFormFillController);
      controller.detachFromBrowser(docShell);
      this._connected = false;
    }

    removeEventListener("unload", this);
    removeEventListener("DOMContentLoaded", this);

    for (let messageName of this.MESSAGES) {
      removeMessageListener(messageName, this);
    }
  },

  handleEvent(event) {
    switch (event.type) {
      case "DOMContentLoaded": {
        removeEventListener("DOMContentLoaded", this);

        let controller = Cc["@mozilla.org/satchel/form-fill-controller;1"]
                           .getService(Ci.nsIFormFillController);
        controller.attachToBrowser(docShell,
                                   this.QueryInterface(Ci.nsIAutoCompletePopup));
        this._connected = true;
        break;
      }

      case "unload": {
        this.destroy();
        break;
      }
    }
  },

  receiveMessage(message) {
    switch (message.name) {
      case "FormAutoComplete:HandleEnter": {
        this.selectedIndex = message.data.selectedIndex;

        let controller = Cc["@mozilla.org/autocomplete/controller;1"]
                           .getService(Ci.nsIAutoCompleteController);
        controller.handleEnter(message.data.isPopupSelection);
        break;
      }

      case "FormAutoComplete:PopupClosed": {
        this._popupOpen = false;
        break;
      }

      case "FormAutoComplete:PopupOpened": {
        this._popupOpen = true;
        break;
      }

      case "FormAutoComplete:RequestFocus": {
        if (this._input) {
          this._input.focus();
        }
        break;
      }
    }
  },

  get input() { return this._input; },
  get overrideValue() { return null; },
  set selectedIndex(index) {
    sendAsyncMessage("FormAutoComplete:SetSelectedIndex", { index });
  },
  get selectedIndex() {
    return sendSyncMessage("FormAutoComplete:GetSelectedIndex", {});
  },
  get popupOpen() {
    return this._popupOpen;
  },

  openAutocompletePopup: function(input, element) {
    if (this._popupOpen || !input) {
      return;
    }

    let rect = BrowserUtils.getElementBoundingScreenRect(element);
    let window = element.ownerDocument.defaultView;
    let dir = window.getComputedStyle(element).direction;
    let results = this.getResultsFromController(input);

    sendAsyncMessage("FormAutoComplete:MaybeOpenPopup",
                     { results, rect, dir });
    this._input = input;
  },

  closePopup: function() {
    this._popupOpen = false;
    sendAsyncMessage("FormAutoComplete:ClosePopup", {});
  },

  invalidate: function() {
    if (this._popupOpen) {
      let results = this.getResultsFromController(this._input);
      sendAsyncMessage("FormAutoComplete:Invalidate", { results });
    }
  },

  selectBy: function(reverse, page) {
    this._index = sendSyncMessage("FormAutoComplete:SelectBy", {
      reverse: reverse,
      page: page
    });
  },

  getResultsFromController(inputField) {
    let results = [];

    if (!inputField) {
      return results;
    }

    let controller = inputField.controller;
    if (!(controller instanceof Ci.nsIAutoCompleteController)) {
      return results;
    }

    for (let i = 0; i < controller.matchCount; ++i) {
      let result = {};
      result.value = controller.getValueAt(i);
      result.label = controller.getLabelAt(i);
      result.comment = controller.getCommentAt(i);
      result.style = controller.getStyleAt(i);
      result.image = controller.getImageAt(i);
      results.push(result);
    }

    return results;
  },
};

AutoCompletePopup.init();
