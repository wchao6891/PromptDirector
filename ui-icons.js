const ICON_SPRITE_URL = new URL("./assets/ui-icons.svg", import.meta.url).href;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export function createUiIcon(name, options = {}) {
  const icon = document.createElementNS(SVG_NAMESPACE, "svg");
  icon.classList.add("ui-icon");
  if (options.className) icon.classList.add(options.className);
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");

  const use = document.createElementNS(SVG_NAMESPACE, "use");
  use.setAttribute("href", `${ICON_SPRITE_URL}#icon-${name}`);
  icon.append(use);
  return icon;
}

export function setUiIcon(target, name) {
  if (!target) return null;
  const icon = createUiIcon(name);
  target.replaceChildren(icon);
  return icon;
}
