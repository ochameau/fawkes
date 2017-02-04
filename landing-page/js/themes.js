addEventListener("load", function () {
  let group = document.querySelector(".group.themes");
  group.addEventListener("click", function(event) {
    let { path, header, footer, vars } = event.target.dataset;
    if (!path) return;
    if (event.target.classList.contains("keep-installed")) {
      event.target.classList.remove("enabled");
      reset();
    } else {
      emit("Install", path, header, footer, vars, event.target.textContent);
    }
    event.target.classList.toggle("keep-installed");
  });

  group.addEventListener("mouseover", function(event) {
    let { path, header, footer, vars } = event.target.dataset;
    if (!path) return;
    if (!event.target.classList.contains("enabled")) {
      event.target.classList.add("enabled");
      emit("Preview", path, header, footer, vars, event.target.textContent);
    }
  });

  group.addEventListener("mouseout", function(event) {
    if (event.target.classList.contains("keep-installed")) {
      return;
    }
    if (event.target.classList.contains("enabled")) {
      event.target.classList.remove("enabled");
      reset();
    }
  });
});

function emit(command, path, header, footer, vars, name) {
  if (vars) {
    vars = JSON.parse(vars);
  }
  let url = new URL(path, location).href;
  let theme = {
    id: path,
    name,
    headerURL: new URL("./" + header, url).href,
    footerURL: new URL("./" + footer, url).href,
    vars,
  };

  let node = document.createElement("div");
  node.setAttribute("style", "display: none");
  document.body.appendChild(node);
  node.setAttribute("data-browsertheme", JSON.stringify(theme));
  var event = document.createEvent("Events");
  event.initEvent(command + "BrowserTheme", true, false);
  node.dispatchEvent(event);
  node.remove();
}

function reset() {
  var event = document.createEvent("Events");
  event.initEvent("ResetBrowserThemePreview", true, false);
  document.documentElement.dispatchEvent(event);
}
