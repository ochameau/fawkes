'use strict';

let DEBUG = true;
if (!DEBUG) {
  dump = () => {};
}

let container = document.getElementById("groups");
chrome.runtime.sendMessage({ type: "get" }, data => {
  dump("Groups > "+JSON.stringify(data)+"\n");
  let { groups, current } = data;
  groups.forEach((group, i) => {
    let li = document.createElement("li");
    li.textContent = group.name + " (" + group.tabs.length + ")";
    li.dataset.position = i;
    if (i == current) {
      li.classList.add("current");
    }
    container.appendChild(li);
  });
});

window.onclick = function (event) {
  if (event.target.tagName == "INPUT") {
    window.focus();
    event.target.focus();
    return;
  }
  let position = event.target.dataset.position;
  if (typeof (position) == "string") { // dataset converts everything to strings
    chrome.runtime.sendMessage({ type: "select", position: parseInt(position) });
  }
  window.close();
};
let newInput = document.querySelector("#new");
newInput.onkeypress = function (event) {
  if (event.keyCode == 13) { // Enter
    chrome.runtime.sendMessage({ type: "create", name: newInput.value });
  }
};
