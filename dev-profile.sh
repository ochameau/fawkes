#!/bin/bash

if [ -z $1 ]; then
  echo "$0 expects first argument to be path to the profile directory"
  exit
fi

PROFILE=$1
rm -rf $PROFILE
mkdir -p $PROFILE/extensions/
echo "$PWD/platform-addon" > $PROFILE/extensions/browserui@mozilla.org
echo "pref('xpinstall.signatures.required', false);" > $PROFILE/user.js
echo "pref('extensions.autoDisableScopes', 0);" >> $PROFILE/user.js
echo "pref('browser.dom.window.dump.enabled', true);" >> $PROFILE/user.js
echo "pref('dom.serviceWorkers.testing.enabled', true);" >> $PROFILE/user.js
echo "pref('browser.shell.checkDefaultBrowser', false);" >> $PROFILE/user.js
# Prevent having the "safe run popup when killing firefox via CTRL+C"
echo "pref('toolkit.startup.max_resumed_crashes', -1);" >> $PROFILE/user.js
# enable browser toolbox
echo "pref('devtools.debugger.remote-enabled', true);" >> $PROFILE/user.js
echo "pref('devtools.chrome.enabled', true);" >> $PROFILE/user.js
