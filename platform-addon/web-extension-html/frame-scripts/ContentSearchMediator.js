var ContentSearchMediator = {

  whitelist: new Set([
    "about:home",
    "about:newtab",
  ]),

  init: function(chromeGlobal) {
    chromeGlobal.addEventListener("ContentSearchClient", this, true, true);
    addMessageListener("ContentSearch", this);
  },

  handleEvent: function(event) {
    if (this._contentWhitelisted) {
      this._sendMsg(event.detail.type, event.detail.data);
    }
  },

  receiveMessage: function(msg) {
    if (msg.data.type == "AddToWhitelist") {
      for (let uri of msg.data.data) {
        this.whitelist.add(uri);
      }
      this._sendMsg("AddToWhitelistAck");
      return;
    }
    if (this._contentWhitelisted) {
      this._fireEvent(msg.data.type, msg.data.data);
    }
  },

  get _contentWhitelisted() {
    return this.whitelist.has(content.document.documentURI);
  },

  _sendMsg: function(type, data = null) {
    sendAsyncMessage("ContentSearch", {
      type: type,
      data: data,
    });
  },

  _fireEvent: function(type, data = null) {
    let event = Cu.cloneInto({
      detail: {
        type: type,
        data: data,
      },
    }, content);
    content.dispatchEvent(new content.CustomEvent("ContentSearchService",
                                                  event));
  },
};
ContentSearchMediator.init(this);
