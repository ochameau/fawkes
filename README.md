# Fawkes browser 

## Checkout

```
git clone https://github.com/ochameau/fawkes.git
```

## How to build'n run

```
# Checkout sources
$ git clone https://github.com/ochameau/fawkes.git
$ cd fawkes/

# Serve browser resources from sources
$ sudo python -m SimpleHTTPServer 80 &
  ( or any other way to host this folder on localhost )

# Create a brand new development profile (this is going to wipe the given profile path)
$ ./dev-profile.sh profile

# Download a firefox nightly build

# Run firefox
$ firefox -profile profile/ http://localhost/

# Select one of the web extension browser
# Click "Install" to install it

# The browser is going to reboot on the browser flavor.

# Then you can refresh the web extensions via Alt + R key shortcut,
# Or revert back to original Firefox via Ctrl + Alt + R.
```

## Repo content

- /browsers/
  Manifest files defining list of addon URLs (Absolute [http://...], or relative to manifest folder).
  This actually defines a browser flavor implemented by a set of addons:
  - web-extension.json
    Basic browser with tabs on top, really looks like Firefox.
  - web-extension-vertical-tabs.json
    Same browser but with tabs on the left, like Vertical Tabs or Tree Style Tab.

- /extensions/
  Web extension Addons, using augmented API compared to Firefox or Chrome addon APIs.
  Most of these addons are just using chrome.tabs API (https://developer.chrome.com/extensions/tabs).
  - tabs
    Tab strip on top. Display tab title, favicon with rounded corner on top of the browser.
    Just the tabs. It doesn't manage the webpage itself.
  - urlbar
    Previous and forward buttons, as well as the url input.
    But doesn't include the suggestion popup for url from history or bookmarks,
    even if it is interacting a lot with it.
  - awesomebar
    Suggestion popup which help opening urls that you already visited or bookmarks.
  - deck
    This is the one displaying web pages by using <iframe>. This is using special iframes
    that regular websites can't use. This is mozbrowser iframe, originaly created for Firefox OS.
    https://developer.mozilla.org/en-US/docs/Web/API/Using_the_Browser_API#The_JavaScript_implementation
  - layout
    All the previous extensions end up being an HTML document which is loaded in an iframe.
    Most of the extension iframes are created in layout addon. Layout's document ends up being the top level
    document used for the browser window.
    For now, layout also manage browser actions. That is the buttons displayed on the right of the url input.
    Each button is implemented by another web extension, by using browser action API:
    https://developer.chrome.com/extensions/browserAction
  - vertial-tabs
    This is a fork of 'tabs', but displays tabs on the left, like Vertical Tabs or Tree Style Tab.
  - tab-groups
    This add a button next to the url input to manage tab groups. Like Tab groups or Panorama addons.
  - session-restore
    This simply allows saving all tab informations to be able to restore them on browser restart.
  - bookmarks
    Button next to the url input displaying all saved bookmarks.
  - bookmark-button
    Star icon next to the url input which displays if the current URL is bookmarked and allows to (un)bookmark it.
  - home-button
    Button next to the url input which allows to open the home page.

- /platform-addon/
  Privileged addon, full of hacks and using privileged (chrome) Firefox APIs
  to makes all the HTML/WebExtension things to work.
  Implements:
   - browserui:// protocol which allows changing the current browser flavor to use.
   - Manages the light web extension addons installed via browserui:// JSON manifests.
     (This is not using Addon Manager because it is too slow)
   - Makes the necessary tweaks to Gecko to make it possile to implement a browser using HTML.
     (Supports window transparency on Windows/Mac, allow to use HTML as top level window
   - Hacks WebExtension implementation to support our new architecture.
     (Make whatever is necessary to support <html:iframe mozbrowser> instead of <xul:browser>)
   - Implement new WebExtension APIs necessary to build a complete browser:
     - chrome.browserui
       That allows to list all web extensions implementing a browser ui part.
     - chrome.browserActionManagement
       This is a necessary API to be able to display the browser actions in HTML.
       chrome.browserAction helps defining an action, where browserActionManager helps listing all of them.
     - chrome.popups
       This is used to display special popups that can't be implemented with regular JS APIs.
       popups that don't have any OS borders, title bar, control buttons (minimize, close).
   - Reimplementation of some WebExtension APIs to map to HTML elements instead of Firefox XUL ones:
     - chrome.tabs
       Doesn't reference any DOM element. Instead it is just a Model. It only manage tab data.
       Web extensions are doing the job. This mostly ensure important invariant are enforced.
       'tabs' extension fully manage tab strip based on chrome.tabs events.
       Same as 'deck' which fully controls how and when web site are really loaded.
       'deck' extension also feed chrome.tabs with the current state of tabs out of mozbrowser iframe events.
     - chrome.browserAction
       Quite similar to chrome.tabs, only store data about browser actions. It acts with chrome.browserActionManager
       to let extensions do the final implementation of actions.
     - chrome.commands
       This is listening to DOM key events on top level window instead of using <xul:keyset>.
  
- /landing-page/
  - index.html redirects to /landing-page/index.html which displays links
  to install browsers declared in manifest files from /browsers.

# Browser documents hierarchy

	Layout
	+-----------------------------------------------------------------------+
	|-----------------------------------------------------------------------|
	||V||Tabs                                                              ||
	||e|--------------------------------------------------------------------|
	||r|------------------------------------------------------- Browser     |
	||t||Urlbar                                               | actions     |
	||i|-------------------------------------------------------             |
	||c|--------------------------------------------------------------------|
	||a||Deck                                                              ||
	||l||                                                                  ||
	||-||                                                                  ||
	||t||                                                                  ||
	||a||                                                                  ||
	||b||                                                                  ||
	||s||                                                                  ||
	|| ||                                                                  ||
	|| ||                                                                  ||
	|| ||                                                                  ||
	|| ||                                                                  ||
	|| ||                                                                  ||
	|-----------------------------------------------------------------------|
	+-----------------------------------------------------------------------+

# Story of a tab

- Press Ctrl+T
  This key shortcut is registered by 'tabs' extension. In its manifest.json file.
  Once pressed, it will fire a 'create-new-tab' event on chrome.commands.onCommand API.
  We are calling 'chrome.tabs.create({ url: "about:blank" })' from tabs/script.js.
- chrome.tabs.create
  This is implemented by privileged code from platform-addons/web-extension-html/api/tabs.js
  Which forward that to TabsState from platform-addons/web-extension-html/api/utils.js
  TabsState is just storing data about tabs. This is a Model for tabs.
  It doesn't store any reference to DOM. There is no plaform magic.
  All web extension are keeping these tab states updated.
  TabsState.onEvent is going to end up dispatching 'create' event to web extensions
  that uses chrome.tabs.onCreated or chrome.tabs.onUpdated.
- chrome.tabs.onUpdated
  - 'deck' is going to create an iframe for this tab. extensions/tabs/script.js
    is going to instanciate a 'Tab' object, whose goal to to manage the mozbrowser iframe
  - in parallel, 'tabs' is also going to create its own 'Tab' object, whose goal here
    is to display the rounded tab, with tab title, favicon and close button.
- mozbrowser iframe
  So 'deck' created a special mozbrowser iframe. It is setting its 'src' attribute
  to 'about:blank'. These special iframes are firing various events.
  It is firing mozbrowserlocationchange when the iframe changes location
  and mozbrowsertitlechanged when the loaded document changes its title.
  We are going to receive both these events in 'deck' extension.
  extensions/deck/script.js is going to call chrome.tabs.update({ url: newURL, title: newTitle })
  That, to keep TabsState data up to date.
- chrome.tabs.update -> TabsState.onEvent -> chrome.tabs.onUpdated
  This will again call TabsState.onEvent with modified attributes, which is also
  going to call 'deck' and 'tabs' chrome.tabs.onUpdated.
  'tabs' is going to update tab title accordingly to the new url and title being changed.

```
        extension/tabs/manifest.json
            'create-new-tab'         extensions/tabs/script.js
Ctrl+T +---------------------------> chrome.commands.onCommand
                                               v
                      chrome.tabs.create({url:"blank"})
                platform-addon/web-extension-html/api/tabs.js
                                             v
                TabsState.onEvent("create",{url:"about:blank"})
                platform-addon/web-extension-html/api/utils.js
                           v
                 chrome.tabs.onUpdated
extensions/tabs/deck.js          extensions/tabs/script.js
new Tab()                        new Tab()
<iframe src="about:blank">        ________________
          v                      / Loading       x\
mozbrowserlocationchange
          +
mozbrowsertitlechanged
          v
chrome.tabs.update({url:"about:blank",title:""})
          v
TabsState.onEvent("update",{url:"about:blank",title:""})
                           v
                 chrome.tabs.onUpdated
extensions/tabs/deck.js          extensions/tabs/script.js
tab.updateDom({title: ""})       tab.update({title: ""})
> Nothing to change               ________________                     
  regarding tab iframe           / New tab       x\
```

