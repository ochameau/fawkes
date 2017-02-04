
let buttons = new Map();
let container = document.getElementById('navbar-extensions');

chrome.browserActionManagement.onUpdate.addListener(function (event, data) {
  let button = buttons.get(data.id);
  switch(event) {
    case "update":
      update(data);
      break;
    case "open":
      let url = button.dataset.popup;
      openPopup(button, url);
      break;
    case "shutdown":
      if (button) {
        button.remove();
      }
      buttons.delete(data.id);
      break;
  }
});

function update(options) {
  let button = buttons.get(options.id);
  if (!button) {
    button = createButton(options);
    buttons.set(options.id, button);
  }

  updateTitle(options);
  updateBadge(options);
  updateIcon(options);
}

chrome.browserActionManagement.getAll(function (actions) {
  if (actions) {
    actions.forEach(update);
  }
});

function createButton(options) {
  let element = document.createElement('button');
  element.className = 'extension-button';
  element.dataset.popup = options.popup;
  element.addEventListener("click", function() {
    chrome.browserActionManagement.click(options.id);
  });

  container.appendChild(element); 
  return element;
}

function updateTitle(options) {
  let button = buttons.get(options.id);
  button.setAttribute('title', options.title || '');
}

function updateBadge(options) {
  let button = buttons.get(options.id);

  let badge = button.querySelector('.button-badge');
  if (!options.badgeText && !badge) {
    return;
  }

  if (!options.badgeText && badge) {
    badge.remove();
    return;
  }

  if (options.badgeText && !badge) {
    badge = document.createElement('div');
    badge.className = 'button-badge';
    badge.setAttribute('style', 'position: absolute; bottom: 0; right: 0px; border: 1px solid black; border-radius: 5px;');
    button.appendChild(badge);
  }

  badge.textContent = options.badgeText;
  badge.style.backgroundColor = options.badgeBackgroundColor || '#e0e0e0';
}

function updateIcon(options) {
  let button = buttons.get(options.id);

  if (options.icon) {
    button.innerHTML = '<img src="' + options.icon[Object.keys(options.icon)[0]] + '" />';
  } else {
    button.innerHTMl = '';
  }
}

function openPopup(button, url) {
  let { left, bottom, height } = button.getBoundingClientRect();
  // Use parseInt as sometimes, values are float and webextension throws...
  chrome.popup.open(url, 200, 300, parseInt(left), parseInt(window.mozInnerScreenY + bottom));
}
