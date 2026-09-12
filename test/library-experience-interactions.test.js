import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { load } from "cheerio";

const source = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
const html = await readFile(new URL("../extension/library.html", import.meta.url), "utf8");

test("case navigation has a stable parent and management keeps project and trash outside overflow", () => {
  const $ = load(html);
  assert.equal($("#detail-navigation").parent().attr("id"), "detail-drawer");
  assert.equal($("#selection-trash").closest("details").length, 0);
  assert.equal($("#selection-project-menu").closest("#selection-more-menu").length, 0);
  assert.equal($("#share-export").closest("details").attr("id"), "selection-more-menu");
  for (const id of ["selection-project-menu", "selection-trash", "selection-label-menu"]) {
    assert.ok($("#" + id).find(".selection-action-label").text().trim());
  }
});

function mediaSwitchHarness(confirm = async () => true) {
  const ctx = vm.createContext({
    switchingMedia: false, activeIndex: 0, contentAssets: [{ id: "first" }, { id: "second" }],
    ownerEntryId: "case", currentDetailId: "case", gallery: { isConnected: true },
    rail: { scrollLeft: 20 }, mediaNavigation: { focus() { ctx.focused = "media-navigation"; } },
    confirmPromptEditDiscard: confirm, renders: 0, focused: "", errors: [],
    renderActive: async () => { ctx.renders++; ctx.rail.scrollLeft = 0; },
    captureDetailScrollAnchor: () => ({}), restoreDetailScrollAnchor: () => {},
    requestAnimationFrame: callback => callback(), showFeedback: message => ctx.errors.push(message)
  });
  const start = source.indexOf("  async function switchMedia(");
  const end = source.indexOf('  previousMedia.addEventListener("click"', start);
  vm.runInContext(source.slice(start, end), ctx);
  ctx.trigger = { disabled: false, focus() { ctx.focused = "trigger"; } };
  return ctx;
}

test("media endpoints stay in this case and an accepted switch preserves the thumbnail position", async () => {
  const ctx = mediaSwitchHarness();
  await ctx.switchMedia(-1, ctx.trigger);
  await ctx.switchMedia(0, ctx.trigger);
  await ctx.switchMedia(2, ctx.trigger);
  assert.equal(ctx.renders, 0);
  await ctx.switchMedia(1, ctx.trigger);
  assert.equal(ctx.activeIndex, 1);
  assert.equal(ctx.currentDetailId, "case");
  assert.equal(ctx.rail.scrollLeft, 20);
  assert.equal(ctx.focused, "trigger");
});

test("declining to discard a draft keeps the current media", async () => {
  const ctx = mediaSwitchHarness(async () => false);
  await ctx.switchMedia(1, ctx.trigger);
  assert.equal(ctx.activeIndex, 0);
  assert.equal(ctx.renders, 0);
  assert.equal(ctx.switchingMedia, false);
});

test("repeated clicks share one pending confirmation and a detached gallery cannot switch", async () => {
  let resolve;
  let confirmations = 0;
  const ctx = mediaSwitchHarness(() => { confirmations++; return new Promise(done => { resolve = done; }); });
  const first = ctx.switchMedia(1, ctx.trigger);
  await ctx.switchMedia(1, ctx.trigger);
  assert.equal(confirmations, 1);
  ctx.gallery.isConnected = false;
  resolve(true);
  await first;
  assert.equal(ctx.renders, 0);
  assert.equal(ctx.switchingMedia, false);
});

test("reaching a disabled media arrow keeps keyboard focus within media navigation", async () => {
  const ctx = mediaSwitchHarness();
  ctx.renderActive = async () => { ctx.trigger.disabled = true; };
  await ctx.switchMedia(1, ctx.trigger);
  assert.equal(ctx.focused, "media-navigation");
});

// Small DOM doubles execute the production note handlers; they do not verify browser layout.
class Control {
  constructor(tag, className = "", text = "") {
    Object.assign(this, { tag, className, textContent: text, children: [], handlers: {}, dataset: {}, attributes: {}, value: "", hidden: false, isConnected: true });
    this.classList = { add: (...names) => { this.className += " " + names.join(" "); } };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  fire(event) { return this.handlers[event]?.(); }
  focus(options) { this.focusOptions = options; }
  checkValidity() { return !this.value || Number.isFinite(Number(this.value)) && Number(this.value) >= 0; }
  querySelector() { return null; }
}

function noteHarness(controller = null, response = { ok: true }) {
  const nodes = [];
  const el = (tag, className, text) => { const node = new Control(tag, className, text); nodes.push(node); return node; };
  const messages = [], feedback = [];
  const ctx = vm.createContext({
    el, textEl: el, rawTextEl: el, document: { createElement: tag => el(tag) }, t: value => value,
    formatMediaTime: value => String(value / 1000), promptIconButton: label => el("button", "button-secondary", label),
    preserveElementPosition: () => () => {}, refreshLibrary: async () => {},
    perform: async (_button, message) => { messages.push(message); return response; },
    showFeedback: message => feedback.push(message)
  });
  const start = source.indexOf("function renderTimeNotes(");
  const end = source.indexOf("async function saveVideoKeyframe(", start);
  vm.runInContext(source.slice(start, end), ctx);
  const container = el("section");
  ctx.renderTimeNotes(container, { id: "case", timeNotes: [{ id: "note", assetId: "video", startMs: 3000, text: "existing" }] }, { id: "video", kind: "video" }, () => controller);
  return { nodes, messages, feedback, byText: text => nodes.find(node => node.textContent === text), byClass: name => nodes.find(node => node.className === name) };
}

test("uncontrollable external players keep manual time entry and show an honest seek failure", async () => {
  const harness = noteHarness({ destroy() {} });
  await harness.byText("添加时间笔记").fire("click");
  assert.equal(harness.byClass("time-note-form").hidden, false);
  assert.equal(harness.nodes.find(node => node.tag === "input").value, "");
  await harness.byText("3").fire("click");
  assert.equal(harness.feedback.length, 1);
  assert.match(harness.feedback[0], /无法直接跳转/);
});

test("cancelling a note clears its draft and returns focus without moving the reading position", async () => {
  const harness = noteHarness({ getCurrentTimeMs: async () => 12500 });
  await harness.byText("添加时间笔记").fire("click");
  const text = harness.nodes.find(node => node.tag === "textarea");
  const form = harness.byClass("time-note-form");
  text.value = "unsaved feedback";
  await form.fire("input");
  assert.equal(form.dataset.dirty, "true");
  await harness.byText("取消").fire("click");
  assert.equal(form.dataset.dirty, "false");
  assert.equal(text.value, "");
  assert.equal(form.hidden, true);
  assert.equal(harness.byText("添加时间笔记").focusOptions.preventScroll, true);
});

test("failed note saves retain the draft and an unknown time is not silently saved as zero", async () => {
  const harness = noteHarness(null, null);
  await harness.byText("添加时间笔记").fire("click");
  const text = harness.nodes.find(node => node.tag === "textarea");
  const start = harness.nodes.find(node => node.tag === "input");
  const form = harness.byClass("time-note-form");
  text.value = "keep this";
  await form.fire("input");
  await harness.byText("保存笔记").fire("click");
  assert.equal(harness.messages.length, 0);
  start.value = "0";
  await harness.byText("保存笔记").fire("click");
  assert.equal(harness.messages[0].note.startMs, 0);
  assert.equal(form.dataset.dirty, "true");
  assert.equal(text.value, "keep this");
  assert.equal(form.hidden, false);
});

function completionHarness(job) {
  const feedback = [];
  const dialog = { open: true, close() { this.open = false; } };
  const ctx = vm.createContext({
    activeImportJob: job, latestImportJob: null, pendingLocalImport: null,
    elements: { importDialog: dialog }, window: { scrollY: 200, scrollTo() {} },
    refreshLibrary: async () => {}, requestAnimationFrame: callback => callback(),
    t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]),
    showFeedback: (message, error) => feedback.push({ message, error }),
    discardPendingLocalImport: async () => { throw new Error("Completed job must not discard media"); }
  });
  for (const [start, end] of [
    ["async function refreshAfterImport(", "async function cancelImportFlow("],
    ["async function closeImportDialog(", "async function discardPendingLocalImport("]
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), ctx);
  return { ctx, dialog, feedback };
}

test("successful import dismisses its dialog and preserves the last job for review and undo", async () => {
  const job = { id: "import", status: "completed", items: [{ status: "imported" }, { status: "skipped" }] };
  const { ctx, dialog, feedback } = completionHarness(job);
  await ctx.refreshAfterImport(job);
  assert.equal(dialog.open, false);
  assert.equal(ctx.activeImportJob, null);
  assert.equal(ctx.latestImportJob, job);
  assert.match(feedback[0].message, /1 个案例.*1 项跳过/);
});

test("failed or canceled imports retain their result and never report complete success", async () => {
  for (const status of ["failed", "canceled"]) {
    const job = { id: "import", status, items: [{ status: "imported" }, { status: "failed" }] };
    const { ctx, dialog, feedback } = completionHarness(job);
    await ctx.refreshAfterImport(job);
    assert.equal(dialog.open, true);
    assert.equal(ctx.activeImportJob, job);
    assert.doesNotMatch(feedback[0].message, /导入完成/);
  }
});

test("completion of an older import cannot close a newer import dialog", async () => {
  const job = { id: "old", status: "completed", items: [{ status: "imported" }] };
  const { ctx, dialog } = completionHarness({ ...job, id: "new" });
  await ctx.refreshAfterImport(job);
  assert.equal(dialog.open, true);
  assert.equal(ctx.activeImportJob.id, "new");
});

test("emptying trash closes only after successful cleanup with no outstanding warnings", async () => {
  for (const outcome of ["success", "failed", "warning", "declined"]) {
    const dialog = { open: true, close() { this.open = false; } };
    const feedback = [], errors = [], sent = [];
    const ctx = vm.createContext({
      trashItems: [{ id: "trash" }], elements: { trashDialog: dialog, trashEmpty: {} },
      confirmAppAction: async () => outcome !== "declined",
      performTrashAction: async (_button, message) => {
        sent.push(message);
        return outcome === "failed" ? null : { ok: true, trashState: { items: [] }, message: "result", failedLegacyScreenshotCount: outcome === "warning" ? 1 : 0 };
      },
      renderTrashItems: () => {}, showFeedback: message => feedback.push(message),
      showTrashFeedback: message => errors.push(message)
    });
    vm.runInContext(source.slice(source.indexOf("async function emptyTrashFromDialog("), source.indexOf("function showTrashFeedback(")), ctx);
    await ctx.emptyTrashFromDialog();
    assert.equal(dialog.open, outcome !== "success", outcome);
    assert.equal(feedback.length, outcome === "success" ? 1 : 0, outcome);
    assert.equal(sent.length, outcome === "declined" ? 0 : 1, outcome);
    if (outcome === "warning") assert.equal(errors.length, 1);
  }
});

test("case switches clear stale content without flashing the new title in the loading surface", () => {
  const nodes = [];
  const el = (tag, className, text = "") => {
    const node = new Control(tag, className, text);
    node.classList.remove = () => {};
    node.removeAttribute = name => { delete node.attributes[name]; };
    nodes.push(node);
    return node;
  };
  const drawer = el("aside");
  const content = el("div");
  content.append(el("h2", "detail-title", "Previous case"));
  const ctx = vm.createContext({
    el, rawTextEl: el, logicalCases: [{ id: "a", title: "Case A" }, { id: "b", title: "Case B" }],
    elements: { detailDrawer: drawer, detailContent: content, drawerToolbar: el("div") }
  });
  vm.runInContext(source.slice(source.indexOf("function invalidateDetailContent("), source.indexOf("function createLocalDiscovery(")), ctx);
  const visibleText = node => node.textContent + node.children.map(visibleText).join("");
  for (const [id, title] of [["a", "Case A"], ["b", "Case B"]]) {
    ctx.invalidateDetailContent(id);
    assert.equal(content.children.length, 1);
    const loading = content.children[0];
    assert.equal(visibleText(loading), "", "Loading must not render either case title as visible text");
    assert.equal(loading.attributes.role, "status");
    assert.ok(loading.attributes["aria-label"].includes(title));
    assert.equal(drawer.dataset.loadingEntryId, id);
    assert.equal(content.scrollTop, 0);
  }
});
