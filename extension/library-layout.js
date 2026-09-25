import { normalizeSidebarLayout } from "./preferences.js";
import { createUiIcon } from "./ui-icons.js";
import { t } from "./i18n.js";

// Presentation only: move existing controls, never clone IDs or change case data.
export function createLibraryLayout({ preferences, persist, onToggle }) {
  const workspace = document.querySelector(".workspace");
  const sidebar = document.getElementById("filter-sidebar");
  const dock = document.getElementById("sidebar-modules");
  const toggle = document.getElementById("toggle-filters");
  const modules = new Map();
  let layout = normalizeSidebarLayout(preferences.sidebarLayout);
  const mobile = matchMedia("(max-width: 640px)");
  if (mobile.matches) layout.collapsed = true;
  const names = { projects: "项目", types: "内容类型", tags: "标签筛选" };
  const icons = { projects: "folder", types: "layers", tags: "tag" };
  let saving = Promise.resolve();
  function save() {
    const snapshot = structuredClone(layout);
    saving = saving.catch(() => {}).then(() => persist(snapshot));
    return saving;
  }
  function apply() {
    workspace.classList.toggle("filters-collapsed", layout.collapsed);
    toggle.setAttribute("aria-expanded", String(!layout.collapsed));
    toggle.replaceChildren(createUiIcon(layout.collapsed ? "panel-left" : "panel-left-close"));
    for (const key of layout.order) dock.append(modules.get(key).section);
    for (const [key, item] of modules) {
      const open = !layout.collapsed && layout.open.includes(key);
      item.section.classList.toggle("module-open", open);
      item.button.setAttribute("aria-expanded", String(open));
      item.body.hidden = !open;
    }
    onToggle();
  }
  function openModule(key) {
    if (layout.collapsed) layout.open = [key];
    else if (!layout.open.includes(key)) layout.open.push(key);
    layout.collapsed = false;
    apply();
    void save();
  }
  for (const section of dock.querySelectorAll("[data-sidebar-module]")) {
    const key = section.dataset.sidebarModule;
    const heading = section.querySelector(".filter-heading");
    const title = heading.querySelector("strong");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sidebar-module-toggle button-secondary";
    button.title = t(names[key]);
    button.setAttribute("aria-label", t(names[key]));
    button.setAttribute("aria-controls", `sidebar-${key}-body`);
    const label = document.createElement("span");
    label.className = "module-label";
    label.textContent = t(names[key]);
    const count = document.createElement("small");
    count.className = "module-active-count";
    count.hidden = true;
    button.append(createUiIcon(icons[key]), label, count, createUiIcon("chevron-down", { className: "module-chevron" }));
    title.replaceWith(button);
    button.addEventListener("click", () => {
      if (layout.collapsed || !layout.open.includes(key)) openModule(key);
      else { layout.open = layout.open.filter(id => id !== key); apply(); void save(); }
    });
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "module-grip icon-button";
    grip.draggable = true;
    grip.title = t("拖动排序，方向键调整位置");
    grip.setAttribute("aria-label", `${t(names[key])}：${grip.title}`);
    grip.append(createUiIcon("grip-vertical"));
    heading.prepend(grip);
    const move = offset => {
      const from = layout.order.indexOf(key);
      const to = Math.max(0, Math.min(layout.order.length - 1, from + offset));
      layout.order.splice(from, 1); layout.order.splice(to, 0, key);
      apply(); void save(); grip.focus();
    };
    grip.addEventListener("keydown", event => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); move(event.key === "ArrowUp" ? -1 : 1);
    });
    grip.addEventListener("dragstart", event => {
      event.dataTransfer.setData("application/x-promptdirector-module", key);
      event.dataTransfer.effectAllowed = "move";
    });
    heading.addEventListener("dragover", event => {
      if (!event.dataTransfer.types.includes("application/x-promptdirector-module")) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move";
      heading.classList.add("module-drop-target");
    });
    heading.addEventListener("dragleave", () => heading.classList.remove("module-drop-target"));
    heading.addEventListener("drop", event => {
      heading.classList.remove("module-drop-target");
      const source = event.dataTransfer.getData("application/x-promptdirector-module");
      if (!modules.has(source)) return;
      event.preventDefault(); event.stopPropagation();
      const targetIndex = layout.order.indexOf(key);
      layout.order = layout.order.filter(id => id !== source);
      layout.order.splice(targetIndex, 0, source);
      apply(); void save();
    });
    modules.set(key, { section, button, body: section.querySelector(".sidebar-module-body"), count });
  }
  const nav = sidebar.querySelector(".workspace-navigation");
  nav.querySelector(".filter-heading").remove();
  const menu = document.createElement("details");
  menu.className = "sidebar-layout-menu package-menu";
  const summary = document.createElement("summary");
  summary.title = t("面板布局"); summary.setAttribute("aria-label", t("面板布局"));
  summary.append(createUiIcon("ellipsis"));
  const panel = document.createElement("div");
  panel.className = "package-menu-panel";
  for (const [label, action] of [
    ["全部展开", () => { layout.collapsed = false; layout.open = [...layout.order]; }],
    ["恢复默认布局", () => { layout = normalizeSidebarLayout(); }]
  ]) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "button-secondary"; button.textContent = t(label);
    button.addEventListener("click", () => { action(); menu.open = false; apply(); void save(); });
    panel.append(button);
  }
  menu.append(summary, panel);
  sidebar.append(menu);
  for (const item of sidebar.querySelectorAll(".workspace-navigation-item")) {
    item.title = item.textContent.trim(); item.setAttribute("aria-label", item.title);
  }
  toggle.addEventListener("click", () => { layout.collapsed = !layout.collapsed; apply(); void save(); });
  mobile.addEventListener("change", event => { if (event.matches) { layout.collapsed = true; apply(); } });
  apply();
  setupCompactToolbar();
  return {
    openModule,
    updateCounts({ types = 0, tags = 0 }) {
      for (const [key, count] of Object.entries({ types, tags })) {
        const item = modules.get(key);
        item.count.textContent = String(count); item.count.hidden = !count;
        item.button.title = `${t(names[key])}${count ? ` · ${count}` : ""}`;
        item.button.setAttribute("aria-label", item.button.title);
      }
    }
  };
}

function setupCompactToolbar() {
  const heading = document.getElementById("gallery-heading");
  const controls = document.getElementById("gallery-view-controls");
  const actions = document.querySelector(".top-actions");
  const add = document.getElementById("add-menu");
  const compose = document.getElementById("start-compose");
  const menu = document.createElement("details");
  menu.id = "toolbar-more";
  menu.className = "toolbar-more";
  const summary = document.createElement("summary");
  summary.title = t("更多"); summary.setAttribute("aria-label", t("更多"));
  summary.append(createUiIcon("ellipsis"));
  const panel = document.createElement("div");
  panel.className = "toolbar-more-panel";
  const context = document.createElement("div");
  context.className = "toolbar-context";
  const copy = heading.querySelector(".gallery-heading-copy");
  const breadcrumb = heading.querySelector(".browse-location");
  const count = document.getElementById("result-count");
  menu.append(summary, panel); heading.append(menu);
  const compact = matchMedia("(max-width: 1100px)");
  function apply() {
    if (compact.matches) {
      context.append(breadcrumb, count);
      panel.append(context, controls, add, compose);
    }
    else {
      copy.prepend(breadcrumb); copy.append(count);
      heading.querySelector(".global-search").after(controls);
      actions.prepend(add, compose); menu.open = false;
    }
    menu.hidden = !compact.matches;
  }
  panel.addEventListener("click", event => {
    if (event.target.closest("#select-cases, #start-compose, #add-media, #add-video-reference, #add-quick-note")) menu.open = false;
  });
  document.addEventListener("click", event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open) { menu.open = false; summary.focus(); }
  });
  compact.addEventListener("change", apply); apply();
}
