let selected = -1;
let results = [];
let input = "";

window.onmessage = function (e) {
  let command = e.data.command;
  switch(command) {
    case "search":
      search(e.data.value);
      break;
    case "up":
      if (selected > -1) {
        selected--;
        update();
      }
      break;
    case "down":
      if (selected < results.length - 1) {
        selected++;
        update();
      }
      break;
    case "open":
      open(e.data.value);
      window.close();
      break;
  }
}

window.onmousedown = function (event) {
  let target = event.target;
  while(target && target.tagName != "LI") {
    target = target.parentNode;
  }
  if (!target) {
    return;
  }
  let i = target.dataset.i;
  if (i >= 0) {
    selected = parseInt(i);
    open();
  } else if (target.dataset.suggest) {
    // Otherwise ensure that we clicked on the suggested action link
    open(target.dataset.url);
  }
  // In any case we close the popup on awesomebar click
  window.close();
}

window.onbeforeunload = function () {
  postMessage({ unload: true }, "*");
}

function open(urlbarValue) {
  if (selected >= 0) {
    let item = results[selected];
    if (item) {
      postMessage({ open: item.url }, "*");
      chrome.tabs.update(null, { url: item.url });
    }
  } else {
    let url;
    input = urlbarValue || input;
    if (isInputURL()) {
      url = formatURL(input);
    } else {
      url = "https://www.google.com/search?q=" + encodeURIComponent(input);
    }
    postMessage({ open: url }, "*");
    chrome.tabs.update(null, { url });
  }
}

function search(text) {
  if (text == input) {
    return;
  }
  // Do not compute autocompletion if user is hitting backspace
  // and also when this is the first keystroke and input is still empty
  let doNotAutocomplete = input.length == 0 || (input.startsWith(text) && input.length > text.length);
  input = text;
  chrome.history.search({ text }, function (r) {
    // Only take the 5th first results as we can only display 5 of them.
    results = r.slice(0, 5);
    update(doNotAutocomplete);
  });
}

const URL_REGEX = /\w\.\w+/;
const ABOUT_REGEX = /^\w+:(\/\/)?\w*/;
function isInputURL() {
  return URL_REGEX.test(input) || ABOUT_REGEX.test(input);
}

function formatURL(url) {
  if (!url.match(/\w+:/)) {
    url = "http://" + url;
  }
  return url;
}

function lookupInHistory(input) {
  let original = input;
  input = input.replace(/^\w+:\/\//, "");
  input = input.replace(/^www\./, "");
  if (!input) {
    return null;
  }
  let idx = input.indexOf("/");
  let path = "";
  if (idx != -1) {
    path = input.substr(idx);
    input = input.substr(0, idx);
  }

  // Lookup for a a url in history that matches the host and eventually the path
  let url = null;
  for (let i = 0; i < results.length; i++) {
    let visit = results[i];
    let u = new URL(visit.url);
    let host = u.host;
    host = host.replace(/^www\./, "");
    let fullpath = u.pathname + u.search;
    //dump("match? (host:"+host+" path:"+fullpath+" input:"+input+" path:"+path+")\n")
    if (host.startsWith(input) && (!path || fullpath.startsWith(path))) {
      let autocomplete = "";
      // Restore scheme and www. if there were originaly in the input
      let scheme = original.match(/^\w+:\/\//);
      if (scheme) {
        autocomplete += scheme[0];
      }
      if (original.startsWith("www.")) {
        autocomplete += "www.";
      }
      autocomplete += host;
      if (path) {
        // Autocomplete only up to the next '/'
        let idx = fullpath.indexOf("/", path.length);
        autocomplete += fullpath.substr(0, idx == -1 ? fullpath.length : idx);
      }
      return {
        url: visit.url,
        autocomplete: autocomplete
      }
    }
  }

  return null;
}

function update(doNotAutocomplete) {
  let html = [];

  html.push("<li data-suggest=\"true\"");
  if (selected == -1) {
    html.push(" data-selected=\"true\"");
  }

  let lookup = lookupInHistory(input);
  if (lookup) {
    let autocomplete = lookup.autocomplete;
    if (!doNotAutocomplete) {
      postMessage({ autocomplete: autocomplete }, "*");
    }
    html.push(" data-url=\""+autocomplete.replace(/"/g, "\\\"")+"\"");
    html.push(">");
    html.push("Visit: " + autocomplete.replace(/</g, "&lt;"));
  } else if (isInputURL()) {
    html.push(">");
    html.push("Visit: " + input.replace(/</g, "&lt;"));
  } else {
    html.push(">");
    html.push("Search for: " + input.replace(/</g, "&lt;"));
  }
  html.push("</li>");

  results.forEach(function (visit, i) {
    html.push("<li");
    html.push(" data-i=\"" + i + "\"");
    if (selected == i) {
      html.push(" data-selected=\"true\"");
    }
    html.push(">");
    if (visit.title) {
      html.push(visit.title + " - <span class=\"url\">" + visit.url + "</span>");
    } else if (visit.url) {
      html.push(visit.url);
    }
    html.push("</li>");
  });
  document.body.innerHTML = "<ul>" + html.join("") + "</ul>";

  // Send the selected URI, or a matching URI for autocompletion
  if (selected >= 0) {
    let current = results[selected];
    postMessage({ selectedUri: (current ? current.url : null) }, "*");
  }
}
