(function () {

function update(name, url) {
  // Remove any already installed ones
  let previous = document.getElementById(name);
  if (previous) {
    previous.remove();
  }

  let iframe = document.createElement('iframe');
  iframe.id = name;
  iframe.setAttribute('mozbrowser', 'true');
  iframe.setAttribute('src', url);
  if (name == 'vertical-tabs') {
    document.documentElement.classList.add('vertical-tabs');
  } else if (name == 'tabs') {
    document.documentElement.classList.remove('vertical-tabs');
  }
  if (name == 'tabs') {
    document.getElementById('chrome-and-content').insertBefore(iframe, document.getElementById('chromebar'));
  } else if (name == 'vertical-tabs') {
    document.body.insertBefore(iframe, document.getElementById('chrome-and-content'));
  } else if (name == 'deck') {
    document.getElementById('chrome-and-content').appendChild(iframe);
  } else if (name == 'urlbar') {
    let chrome = document.getElementById('chromebar');
    chrome.insertBefore(iframe, chrome.firstChild);
  }
}

function fetch() {
  chrome.browserui.getAll(function (uis) {
    for (let name in uis) {
      let url = uis[name];
      update(name, url);
    }
  });
}

fetch();
})()
