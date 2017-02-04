if (navigator.appVersion.indexOf('Win') >= 0) {
  document.documentElement.setAttribute('os', 'windows');
}
if (navigator.appVersion.indexOf('Mac') >= 0) {
  document.documentElement.setAttribute('os', 'osx');
}
if (navigator.appVersion.indexOf('X11') >= 0) {
  document.documentElement.setAttribute('os', 'linux');
}

function updateSizeMode() {
  let mode = "normal";
  switch(window.windowState) {
    case 1:
      mode = "maximized";
      break;
    case 2:
      mode = "minimized";
      break;
    case 3:
      mode = "normal";
      break;
    case 4:
      mode = "fullscreen";
      break;
  }
  document.documentElement.setAttribute("sizemode", mode);
}
window.addEventListener("resize", updateSizeMode);
updateSizeMode();
