This is a clone of tabs addon, but instead of managing tabs horizontaly, it displays them vertically.

The only differences in term of code are:
 # in tabs.html:
  <html class="vertical-tabs">
  ...
  <link rel="stylesheet" href="vertical-style.css">

In script.js, there is isVertical variable to help doing some specifics.
There is also isTree and html class="tree" to toggle the tree mode.

To synchronize sources from ../tabs/, just run ./copy-tabs.sh
