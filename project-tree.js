import { collectionPathLabelsById, collectionSubtreeIds } from "./organizer.js";
import { attachProjectCombobox } from "./project-combobox.js";
import { showAppDialog } from "./ui-dialogs.js";
import { t } from "./i18n.js";

const EXPANSION_KEY = "promptdirector-project-tree-expanded";
// Keep the existing pointer threshold; a deliberate pause opens a folded branch.
const DRAG_THRESHOLD = 4;
const HOVER_EXPAND_MS = 600;

export function readProjectExpansion(storage = sessionStorage) {
  try {
    const ids = JSON.parse(storage.getItem(EXPANSION_KEY) || "[]");
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : []);
  } catch { return new Set(); }
}

export function saveProjectExpansion(ids, storage = sessionStorage) {
  try { storage.setItem(EXPANSION_KEY, JSON.stringify([...ids])); } catch { /* View preference only. */ }
}

export function projectTreeRows(childrenByParent, expanded, query = "", paths = new Map()) {
  const rows = [];
  const search = query.trim().toLocaleLowerCase();
  const pending = [...(childrenByParent.get(null) ?? [])].reverse().map((collection) => ({ collection, depth: 0 }));
  while (pending.length) {
    const current = pending.pop();
    if (!search || (paths.get(current.collection.id) || current.collection.name).toLocaleLowerCase().includes(search)) rows.push(current);
    if (!search && !expanded.has(current.collection.id)) continue;
    const children = childrenByParent.get(current.collection.id) ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) pending.push({ collection: children[i], depth: current.depth + 1 });
  }
  return rows;
}

export function projectMovePlan(state, sourceId, targetId, position = "inside") {
  const excluded = new Set(collectionSubtreeIds(state, sourceId));
  if (!state.collections.some((item) => item.id === sourceId)) throw new Error(t("项目不存在"));
  if (targetId && excluded.has(targetId)) throw new Error(t("不能把项目移入自身或其子项目"));
  const target = targetId ? state.collections.find((item) => item.id === targetId) : null;
  if (targetId && !target) throw new Error(t("目标项目不存在"));
  if (!["inside", "before", "after"].includes(position) || (!target && position !== "inside")) throw new Error(t("请选择移动位置"));
  const parentId = position === "inside" ? target?.id ?? null : target.parentId;
  const siblings = state.collections.filter((item) => item.parentId === parentId && item.id !== sourceId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "zh-CN"));
  return { parentId, index: position === "inside" ? siblings.length : siblings.findIndex((item) => item.id === targetId) + (position === "after" ? 1 : 0) };
}

export function createProjectTreeInteractions({ elements, expanded, getState, unavailable, render, onState, feedback }) {
  const list = elements.collectionFilters;
  const root = elements.projectRootDrop;
  const status = elements.projectOrderStatus;
  const undoButton = elements.projectMoveUndo;
  const scroller = list.closest(".filter-sidebar");
  document.body.append(elements.projectMoveFeedback);
  elements.projectMoveFeedback.querySelector(".project-move-dismiss").addEventListener("click", () => {
    elements.projectMoveFeedback.hidden = true;
  });
  let saving = false;
  let undo = null;
  let drag = null;
  let suppressClick = false;

  // Keep a bottom-row menu inside the viewport without changing other app menus.
  function positionMenu(menu) {
    const panel = menu.querySelector(".project-menu-panel");
    const anchor = menu.querySelector("summary").getBoundingClientRect();
    panel.popover = "manual";
    if (!panel.matches(":popover-open")) panel.showPopover();
    panel.style.position = "fixed";
    panel.style.margin = "0";
    panel.style.bottom = "auto";
    panel.style.maxHeight = `${window.innerHeight - 16}px`;
    panel.style.overflowY = "auto";
    panel.style.right = "auto";
    panel.style.left = `${Math.max(8, Math.min(anchor.right - panel.offsetWidth, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(anchor.bottom + 5, window.innerHeight - panel.offsetHeight - 8))}px`;
  }
  list.addEventListener("toggle", (event) => {
    if (!event.target.matches?.(".project-menu")) return;
    if (event.target.open) positionMenu(event.target);
    else {
      const panel = event.target.querySelector(".project-menu-panel");
      if (panel.matches(":popover-open")) panel.hidePopover();
    }
  }, true);
  scroller.addEventListener("scroll", () => {
    for (const menu of list.querySelectorAll(".project-menu[open]")) positionMenu(menu);
  }, { passive: true });
  window.addEventListener("resize", () => {
    for (const menu of list.querySelectorAll(".project-menu[open]")) positionMenu(menu);
  });

  function focus(id) {
    list.querySelector(`[data-collection-id="${CSS.escape(id)}"] .project-filter`)?.focus({ preventScroll: true });
  }

  async function move(id, parentId, index, { undoing = false } = {}) {
    if (saving || unavailable()) throw new Error(t("结束案例选择后可移动项目"));
    const before = getState().collections.find((item) => item.id === id);
    if (!before) throw new Error(t("项目不存在"));
    const siblings = getState().collections.filter((item) => item.parentId === before.parentId);
    const previous = { id, parentId: before.parentId, index: siblings.findIndex((item) => item.id === id) };
    saving = true;
    undoButton.disabled = true;
    list.setAttribute("aria-busy", "true");
    try {
      const response = await chrome.runtime.sendMessage({ type: "MOVE_COLLECTION", collectionId: id, parentId, index });
      if (!response?.ok) throw new Error(response?.message || t("项目结构保存失败"));
      onState(response.organizerState);
      undo = undoing ? null : previous;
      const paths = collectionPathLabelsById(getState());
      status.textContent = t(undoing ? "已撤销移动：{project}" : "已移动：{project}", { project: paths.get(id) });
      undoButton.hidden = !undo;
      elements.projectMoveFeedback.hidden = false;
      focus(id);
      return true;
    } finally {
      saving = false;
      list.removeAttribute("aria-busy");
      undoButton.disabled = unavailable();
    }
  }

  undoButton.addEventListener("click", () => {
    if (undo) void move(undo.id, undo.parentId, undo.index, { undoing: true }).catch((error) => feedback(error.message, true));
  });

  async function openMove(collection) {
    if (saving || unavailable()) return;
    const state = getState();
    const excluded = new Set(collectionSubtreeIds(state, collection.id));
    const paths = collectionPathLabelsById(state);
    const rootId = crypto.randomUUID();
    const projects = [{ id: rootId, pathLabel: t("项目根目录") }, ...state.collections.filter((item) => !excluded.has(item.id)).map((item) => ({ ...item, pathLabel: paths.get(item.id) }))];
    let combobox;
    await showAppDialog({
      title: t("移动项目“{project}”", { project: collection.name }),
      confirmLabel: t("移动"),
      fields: [
        { id: "destination", label: t("目标项目"), placeholder: t("搜索项目名称或路径"), required: true },
        { id: "position", label: t("移动位置"), type: "select", value: "inside", options: [
          { value: "inside", label: t("放入项目") }, { value: "before", label: t("放在前面") }, { value: "after", label: t("放在后面") }
        ] }
      ],
      onReady: ({ controls, body }) => {
        const input = controls.get("destination");
        const position = controls.get("position");
        combobox = attachProjectCombobox(input, { projects, destroyOnDialogClose: true });
        combobox.setSelected(collection.parentId || rootId);
        const preview = document.createElement("p");
        preview.className = "project-move-preview";
        preview.setAttribute("aria-live", "polite");
        body.append(preview);
        const update = () => {
          const isRoot = input.dataset.projectId === rootId;
          position.disabled = isRoot;
          if (isRoot) position.value = "inside";
          preview.textContent = t("{project} → {destination} · {position}", {
            project: collection.name, destination: input.value,
            position: isRoot ? t("根级末尾") : position.selectedOptions[0].textContent
          });
        };
        input.addEventListener("input", update);
        input.addEventListener("change", () => queueMicrotask(() => {
          combobox.close();
          if (!position.disabled) position.focus();
        }));
        position.addEventListener("change", update);
        update();
      },
      onSubmit: async (values, { form }) => {
        const targetId = form.elements.namedItem("destination").dataset.projectId;
        if (!projects.some((item) => item.id === targetId)) throw new Error(t("请从搜索结果中选择目标项目"));
        const plan = projectMovePlan(getState(), collection.id, targetId === rootId ? null : targetId, values.position);
        await move(collection.id, plan.parentId, plan.index);
      }
    });
    combobox?.destroy();
    focus(collection.id);
  }

  function clearIndicators() {
    root.classList.remove("is-drop-target");
    for (const row of list.querySelectorAll(".drop-before, .drop-after, .drop-inside")) row.classList.remove("drop-before", "drop-after", "drop-inside");
  }

  function cancel() {
    if (!drag) return;
    const previous = drag;
    drag = null;
    previous.events.abort();
    cancelAnimationFrame(previous.frame);
    clearTimeout(previous.hoverTimer);
    previous.preview?.remove();
    if (list.hasPointerCapture?.(previous.pointerId)) list.releasePointerCapture(previous.pointerId);
    root.hidden = true;
    clearIndicators();
    list.classList.remove("is-project-dragging");
    if (previous.moved) {
      expanded.clear();
      for (const id of previous.expansion) expanded.add(id);
      render();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 0);
    }
  }

  function updateDrop() {
    if (!drag?.moved) return;
    const bounds = scroller.getBoundingClientRect();
    root.style.left = `${bounds.left + 8}px`;
    root.style.top = `${Math.max(8, bounds.top + 8)}px`;
    root.style.width = `${bounds.width - 16}px`;
    clearIndicators();
    drag.drop = null;
    const hit = document.elementFromPoint(drag.x, drag.y);
    const row = hit?.closest?.(".project-row");
    const targetId = row?.dataset.collectionId;
    const rect = row?.getBoundingClientRect();
    const ratio = rect ? (drag.y - rect.top) / Math.max(1, rect.height) : 0;
    const position = ratio < .28 ? "before" : ratio > .72 ? "after" : "inside";
    const hoverId = row && position === "inside" && !drag.excluded.has(targetId) ? targetId : null;
    if (drag.hoverId !== hoverId) {
      clearTimeout(drag.hoverTimer);
      drag.hoverId = hoverId;
      if (hoverId && !expanded.has(hoverId) && getState().collections.some((item) => item.parentId === hoverId)) {
        drag.hoverTimer = setTimeout(() => {
          if (!drag || drag.hoverId !== hoverId) return;
          expanded.add(hoverId);
          render();
          updateDrop();
        }, HOVER_EXPAND_MS);
      }
    }
    let label = t("选择移动位置");
    try {
      if (hit?.closest?.("#project-root-drop")) {
        drag.drop = projectMovePlan(getState(), drag.id, null);
        root.classList.add("is-drop-target");
        label = t("移到根级");
      } else if (row && !drag.excluded.has(targetId)) {
        drag.drop = projectMovePlan(getState(), drag.id, targetId, position);
        row.classList.add(`drop-${position}`);
        label = t("{position}：{project}", { position: t(position === "inside" ? "放入项目" : position === "before" ? "放在前面" : "放在后面"), project: row.querySelector(".project-filter-name").textContent });
      }
    } catch (error) { label = error.message; }
    drag.preview.textContent = label;
    drag.preview.style.left = `${Math.min(drag.x + 12, window.innerWidth - drag.preview.offsetWidth)}px`;
    drag.preview.style.top = `${Math.min(drag.y + 16, window.innerHeight - drag.preview.offsetHeight)}px`;
  }

  function tick(time) {
    if (!drag?.moved) return;
    const bounds = scroller.getBoundingClientRect();
    const rowHeight = list.querySelector(".project-row")?.getBoundingClientRect().height || 30;
    const edge = rowHeight * 2;
    const top = Math.max(0, bounds.top);
    const bottom = Math.min(window.innerHeight, bounds.bottom);
    if (drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= top && drag.y <= bottom) {
      const amount = drag.y < top + edge ? -Math.min(1, (top + edge - drag.y) / edge)
        : drag.y > bottom - edge ? Math.min(1, (drag.y - bottom + edge) / edge) : 0;
      const elapsed = Math.min(32, time - (drag.time || time));
      scroller.scrollTop += amount * rowHeight * elapsed / 32;
    }
    drag.time = time;
    updateDrop();
    drag.frame = requestAnimationFrame(tick);
  }

  list.addEventListener("click", (event) => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; }
  }, true);
  list.addEventListener("dragstart", (event) => event.preventDefault());
  list.addEventListener("pointerdown", (event) => {
    if (saving || unavailable() || event.button > 0 || drag || event.target.closest(".project-disclosure, .project-menu")) return;
    const row = event.target.closest(".project-row");
    if (!row) return;
    const events = new AbortController();
    const options = { signal: events.signal };
    drag = { id: row.dataset.collectionId, pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, events, expansion: new Set(expanded) };
    document.addEventListener("pointermove", (next) => {
      if (!drag || next.pointerId !== drag.pointerId) return;
      drag.x = next.clientX;
      drag.y = next.clientY;
      if (!drag.moved && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < DRAG_THRESHOLD) return;
      next.preventDefault();
      if (!drag.moved) {
        drag.moved = true;
        drag.excluded = new Set(collectionSubtreeIds(getState(), drag.id));
        expanded.delete(drag.id);
        render();
        root.hidden = false;
        list.classList.add("is-project-dragging");
        try { list.setPointerCapture(drag.pointerId); } catch { /* Synthetic pointers cannot be captured. */ }
        drag.preview = document.createElement("div");
        drag.preview.className = "project-drag-preview";
        document.body.append(drag.preview);
        drag.frame = requestAnimationFrame(tick);
      }
      updateDrop();
    }, { ...options, passive: false });
    document.addEventListener("pointerup", (next) => {
      if (!drag || next.pointerId !== drag.pointerId) return;
      if (drag.moved) { drag.x = next.clientX; drag.y = next.clientY; updateDrop(); }
      const { id, drop } = drag;
      cancel();
      if (drop) void move(id, drop.parentId, drop.index).catch((error) => feedback(error.message, true));
    }, options);
    document.addEventListener("pointercancel", cancel, options);
    document.addEventListener("keydown", (next) => { if (next.key === "Escape") { next.preventDefault(); cancel(); } }, options);
    window.addEventListener("blur", cancel, options);
  });

  return {
    openMove, cancel,
    sync() {
      if (unavailable()) cancel();
      undoButton.disabled = saving || unavailable();
      if (drag?.moved) list.querySelector(`[data-collection-id="${CSS.escape(drag.id)}"]`)?.classList.add("is-dragging");
      else saveProjectExpansion(expanded);
    }
  };
}
