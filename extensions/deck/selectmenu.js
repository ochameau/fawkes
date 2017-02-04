window.onmessage = function (e) {
  let { options } = e.data;
  if (options) {
    update(options);
  }
}
function update(options) {
  document.body.innerHTML = options.map((option, idx) => {
    return "<div data-idx=\"" + idx + "\">" + option.textContent.replace(/</g, "&gt;") + "</div>";
  }).join("");
}
window.onclick = function (event) {
  let idx = event.target.dataset.idx;
  window.postMessage(idx, "*");
  window.close();
}
