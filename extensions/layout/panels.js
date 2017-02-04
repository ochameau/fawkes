const Panels = (function() {
  'use strict';

  let panels = new Map();

  function createPanel(options) {
    let frame = document.createElement('iframe');
    frame.id = 'devtools';
    frame.target = document.getElementById('content');
    frame.setAttribute('mozbrowser', 'true');
    frame.setAttribute('orientation', options.orientation);
    frame.setAttribute('src', options.panel);
    frame.setAttribute('height', '30%');
    document.body.appendChild(frame);
    return frame;
  }

  function open(options) {
    let panel = panels.get(options.id);
    if (panel) {
      return;
    }

    panel = createPanel(options);
    panels.set(options.id, panel);
  }

  function close(options) {
    let panel = panels.get(options.id);
    if (!panel) {
      return;
    }

    panels.delete(options.id);
    panel.remove();
  }

  function toggle(options) {
    let panel = panels.get(options.id);
    if (panel) {
      close(options);
    } else {
      open(options);
    }
  }

  return {
    open: open,
    close: close,
    toggle: toggle
  }
})();
