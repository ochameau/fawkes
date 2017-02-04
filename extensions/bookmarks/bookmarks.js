'use strict';

chrome.bookmarks.getTree(function (results) {
  let list = function (container, node) {
    let li = document.createElement("li");
    li.textContent = node.title || node.url;
    li.title = node.url;
    if (node.url) {
      li.setAttribute("url", node.url);
    }

    if (node.children) {
      let ul = document.createElement("ul");
      node.children.forEach(list.bind(null, ul));
      li.appendChild(ul);
    }

    container.appendChild(li);
  };

  let ul = document.getElementById("bookmarks");
  ul.innerHTML = "";
  results.forEach(list.bind(null, ul));
});

window.onclick = function (event) {
  let url = event.target.getAttribute("url");
  if (url) {
    chrome.tabs.update({
      url
    });
  }
  window.close();
};
