export function projectComboboxOptions(projectsValue, queryValue = "") {
  const query = normalize(queryValue).toLocaleLowerCase();
  return (Array.isArray(projectsValue) ? projectsValue : [])
    .map((project) => ({
      value: normalize(project?.name ?? project?.value),
      label: normalize(project?.name ?? project?.label ?? project?.value)
    }))
    .filter((project) => project.value && project.label)
    .filter((project, index, projects) => projects.findIndex((item) => item.value.toLocaleLowerCase() === project.value.toLocaleLowerCase()) === index)
    .filter((project) => !query || project.label.toLocaleLowerCase().includes(query));
}

export function projectComboboxPlacement({
  inputTop,
  inputBottom,
  boundaryTop,
  boundaryBottom,
  contentHeight,
  gap = 0
}) {
  const above = Math.max(0, Number(inputTop) - Number(boundaryTop) - Number(gap));
  const below = Math.max(0, Number(boundaryBottom) - Number(inputBottom) - Number(gap));
  const preferredHeight = Math.max(0, Number(contentHeight) || 0);
  const placement = below >= preferredHeight || below >= above ? "bottom" : "top";
  return {
    placement,
    maxHeight: Math.floor(placement === "top" ? above : below)
  };
}

export function attachProjectCombobox(input, options = {}) {
  if (!(input instanceof HTMLInputElement)) throw new TypeError("项目组合框需要输入框");
  input.removeAttribute("list");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  const listbox = document.createElement("div");
  listbox.className = "project-combobox-listbox";
  listbox.id = `project-combobox-${globalThis.crypto.randomUUID()}`;
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;
  input.setAttribute("aria-controls", listbox.id);
  input.insertAdjacentElement("afterend", listbox);

  let projects = Array.isArray(options.projects) ? options.projects : [];
  let activeIndex = -1;
  const controller = new AbortController();
  const eventOptions = { signal: controller.signal };
  const boundary = input.closest(".app-dialog-body, .import-dialog-body") || input.closest("dialog") || document.documentElement;

  function positionListbox() {
    if (listbox.hidden || !input.isConnected) return;
    listbox.dataset.placement = "bottom";
    listbox.style.removeProperty("--project-combobox-available-height");
    const styles = getComputedStyle(listbox);
    const gap = Number.parseFloat(styles.getPropertyValue("--ui-popover-gap")) || 0;
    const configuredMaxHeight = Number.parseFloat(styles.getPropertyValue("--ui-combobox-max-height"));
    const contentHeight = Math.min(listbox.scrollHeight, configuredMaxHeight || listbox.scrollHeight);
    const anchor = listbox.offsetParent instanceof HTMLElement ? listbox.offsetParent : input;
    const inputBounds = anchor.getBoundingClientRect();
    const boundaryBounds = boundary.getBoundingClientRect();
    const placement = projectComboboxPlacement({
      inputTop: inputBounds.top,
      inputBottom: inputBounds.bottom,
      boundaryTop: boundaryBounds.top,
      boundaryBottom: boundaryBounds.bottom,
      contentHeight,
      gap
    });
    listbox.dataset.placement = placement.placement;
    listbox.style.setProperty("--project-combobox-available-height", `${placement.maxHeight}px`);
  }

  function matching() {
    return projectComboboxOptions(projects, input.value);
  }

  function render(open = true) {
    const matches = matching();
    if (!matches.length) activeIndex = -1;
    else if (activeIndex >= matches.length) activeIndex = matches.length - 1;
    listbox.replaceChildren(...matches.map((project, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "project-combobox-option";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === activeIndex));
      option.dataset.value = project.value;
      option.textContent = project.label;
      option.addEventListener("pointerdown", (event) => event.preventDefault(), eventOptions);
      option.addEventListener("click", () => select(project.value), eventOptions);
      return option;
    }));
    const visible = open && matches.length > 0;
    listbox.hidden = !visible;
    if (visible) positionListbox();
    input.setAttribute("aria-expanded", String(visible));
    input.setAttribute("aria-activedescendant", "");
    const active = listbox.children[activeIndex];
    if (visible && active) {
      active.id = `${listbox.id}-option-${activeIndex}`;
      input.setAttribute("aria-activedescendant", active.id);
    }
  }

  function close() {
    listbox.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    activeIndex = -1;
  }

  function select(value) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
    input.focus();
  }

  function move(offset) {
    const matches = matching();
    if (!matches.length) return close();
    activeIndex = activeIndex < 0
      ? offset > 0 ? 0 : matches.length - 1
      : (activeIndex + offset + matches.length) % matches.length;
    render(true);
    listbox.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }

  input.addEventListener("focus", () => render(true), eventOptions);
  input.addEventListener("click", () => render(true), eventOptions);
  input.addEventListener("input", () => {
    activeIndex = -1;
    render(true);
  }, eventOptions);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && !listbox.hidden && activeIndex >= 0) {
      event.preventDefault();
      select(matching()[activeIndex]?.value || input.value);
      return;
    }
    if (event.key === "Escape" && !listbox.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }, eventOptions);
  input.addEventListener("blur", () => queueMicrotask(() => {
    if (!listbox.contains(document.activeElement)) close();
  }), eventOptions);
  boundary.addEventListener("scroll", positionListbox, { ...eventOptions, passive: true });
  window.addEventListener("resize", positionListbox, { ...eventOptions, passive: true });

  const dialog = input.closest("dialog");
  if (options.destroyOnDialogClose) dialog?.addEventListener("close", () => controller.abort(), { once: true });

  return {
    element: listbox,
    setProjects(nextProjects) {
      projects = Array.isArray(nextProjects) ? nextProjects : [];
      if (!listbox.hidden) render(true);
    },
    close,
    destroy() {
      controller.abort();
      listbox.remove();
      input.removeAttribute("role");
      input.removeAttribute("aria-autocomplete");
      input.removeAttribute("aria-expanded");
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    }
  };
}

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
