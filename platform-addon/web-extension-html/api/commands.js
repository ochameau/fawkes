/* -*- Mode: indent-tabs-mode: nil; js-indent-level: 2 -*- */
/* vim: set sts=2 sw=2 et tw=80: */

/*
 * Reimplements chrome.commands
 * without using XUL!
 */
"use strict";

Cu.import("resource://devtools/shared/event-emitter.js");
Cu.import("resource://gre/modules/ExtensionUtils.jsm");

var {
  SingletonEventManager,
  PlatformInfo,
} = ExtensionUtils;

// WeakMap[Extension -> CommandList]
var commandsMap = new WeakMap();

function CommandList(manifest, extension) {
  this.extension = extension;
  this.id = makeWidgetId(extension.id);
  this.windowOpenListener = null;

  // Map[{String} commandName -> {Object} commandProperties]
  this.commands = this.loadCommandsFromManifest(manifest);

  // WeakMap[Window -> <xul:keyset>]
  this.keysetsMap = new WeakMap();

  this.register();
  EventEmitter.decorate(this);
}

CommandList.prototype = {
  /**
   * Registers the commands to all open windows and to any which
   * are later created.
   */
  register() {
    for (let window of WindowListManager.browserWindows()) {
      this.registerKeysToDocument(window);
    }

    this.windowOpenListener = (window) => {
      this.registerKeysToDocument(window);
    };

    WindowListManager.addOpenListener(this.windowOpenListener);
  },

  /**
   * Unregisters the commands from all open windows and stops commands
   * from being registered to windows which are later created.
   */
  unregister() {
    for (let window of WindowListManager.browserWindows()) {
      window.removeEventListener("keydown", this);
      window.removeEventListener("AppCommand", this);
    }

    WindowListManager.removeOpenListener(this.windowOpenListener);
  },

  /**
   * Creates a Map from commands for each command in the manifest.commands object.
   *
   * @param {Object} manifest The manifest JSON object.
   * @returns {Map<string, object>}
   */
  loadCommandsFromManifest(manifest) {
    let commands = new Map();
    // For Windows, chrome.runtime expects 'win' while chrome.commands
    // expects 'windows'.  We can special case this for now.
    let os = PlatformInfo.os == "win" ? "windows" : PlatformInfo.os;
    for (let name of Object.keys(manifest.commands)) {
      let command = manifest.commands[name];
      let shortcut = command.suggested_key[os] || command.suggested_key.default;
      if (shortcut) {
        commands.set(name, {
          description: command.description,
          shortcut: shortcut.replace(/\s+/g, ""),
        });
      }
    }
    return commands;
  },

  /**
   * Registers the commands to a document.
   * @param {ChromeWindow} window The window to insert the Keyset.
   */
  registerKeysToDocument(window) {
    window.addEventListener("keydown", this, true);
    window.addEventListener("AppCommand", this, true);
  },

  handleEvent(event) {
    this.commands.forEach((command, name) => {
      if (this.doesEventMatchesShortcut(event, command.shortcut)) {
        if (name == "_execute_page_action") {
          let win = event.target.ownerDocument.defaultView;
          pageActionFor(this.extension).triggerAction(win);
        } else {
          //TabManager.for(this.extension)
          //          .addActiveTabPermission(TabManager.activeTab);
          this.emit("command", name);
        }
      }
    });
  },
  
  doesEventMatchesShortcut(event, shortcut) {
    let parts = shortcut.split("+");

    // The key is always the last element.
    let chromeKey = parts.pop();

    if (event.type == "AppCommand") {
      let matchesCommand = 
        (event.command == "Back" && chromeKey == "CommandBack") ||
        (event.command == "Forward" && chromeKey == "CommandForward");
      return matchesCommand;
    }

    let modifierMatches =
      event.altKey == parts.includes("Alt") &&
      event.metaKey == parts.includes("Command") &&
      event.ctrlKey == (parts.includes("Ctrl") || parts.includes("MacCtrl")) &&
      event.shiftKey == parts.includes("Shift");

    let matchesKey;
    if (/^[A-Z]$/.test(chromeKey)) {
      matchesKey = chromeKey == event.key.toUpperCase();
    } else if (/^[0-9]$/.test(chromeKey)) {
      // Also test against keyCode/charCodeAt to match Ctrl+1 on azerty keyboard,
      // event.key is '&' and you have to press Shift+Ctrl+1 to have event.key = 1
      // whereas most key shortcut would work without having to press Shift...
      matchesKey = chromeKey == event.key ||
                   chromeKey.charCodeAt(0) == event.keyCode;
    } else {
      let keyCodeName = "DOM_" + this.getKeycodeAttribute(chromeKey);
      let win = event.target.ownerDocument.defaultView;
      let keyCode = win.KeyboardEvent[keyCodeName];
      matchesKey = keyCode == event.keyCode;
    }
    //dump("parts: "+parts+" chromeKey:"+chromeKey+"\n");
    //dump("event.key:"+event.key+"\n");
    //dump("mod: "+modifierMatches+" key: "+matchesKey+"\n");
    
    return modifierMatches && matchesKey;
  },

  /**
   * Determines the corresponding XUL keycode from the given chrome key.
   *
   * For example:
   *
   *    input     |  output
   *    ---------------------------------------
   *    "PageUP"  |  "VK_PAGE_UP"
   *    "Delete"  |  "VK_DELETE"
   *
   * @param {string} chromeKey The chrome key (e.g. "PageUp", "Space", ...)
   * @returns {string} The constructed value for the Key's 'keycode' attribute.
   */
  getKeycodeAttribute(chromeKey) {
    return `VK${chromeKey.replace(/([A-Z])/g, "_$&").toUpperCase()}`;
  },

};


/* eslint-disable mozilla/balanced-listeners */
extensions.on("manifest_commands", (type, directive, extension, manifest) => {
  commandsMap.set(extension, new CommandList(manifest, extension));
});

extensions.on("shutdown", (type, extension) => {
  let commandsList = commandsMap.get(extension);
  if (commandsList) {
    commandsList.unregister();
    commandsMap.delete(extension);
  }
});
/* eslint-enable mozilla/balanced-listeners */

extensions.registerSchemaAPI("commands", "addon_parent", context => {
  let {extension} = context;
  return {
    commands: {
      getAll() {
        let commands = commandsMap.get(extension).commands;
        return Promise.resolve(Array.from(commands, ([name, command]) => {
          return ({
            name,
            description: command.description,
            shortcut: command.shortcut,
          });
        }));
      },
      onCommand: new SingletonEventManager(context, "commands.onCommand", fire => {
        let listener = (eventName, commandName) => {
          fire.async(commandName);
        };
        commandsMap.get(extension).on("command", listener);
        return () => {
          commandsMap.get(extension).off("command", listener);
        };
      }).api(),
    },
  };
});
