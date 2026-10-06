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
    ownerEntryId: "case", currentDetailId: "case", gallery: { isConnected: true, dataset: { displayedAssetId: 'first' } },
    rail: { scrollLeft: 20 }, mediaNavigation: { focus() { ctx.focused = "media-navigation"; } },
    confirmPromptEditDiscard: confirm, renders: 0, focused: "", errors: [], preparations: 0, discardedViewers: 0,
    renderToken: 0, imageUrls: [], entry: { id: 'case', primaryMediaId: 'first' }, notes: { reviewFeedback: { getState: () => ({ saving: false }) } },
    elements: { detailContent: { querySelector: () => null } },
    el: () => ({}), t: value => value,
    createMediaViewer: async () => { ctx.preparations++; return { releaseMedia() { ctx.discardedViewers++; } }; },
    captureDetailScrollAnchor: () => ({}), restoreDetailScrollAnchor: () => {},
    requestAnimationFrame: callback => callback(), showFeedback: message => ctx.errors.push(message)
  });
  // Execute the real viewer await, latest-draft confirmation, and identity checks.
  // Only the synchronous DOM construction after the accepted commit is doubled.
  const renderStart = source.indexOf('  async function renderActive(index = activeIndex)');
  const commit = '    activeIndex = index;';
  const renderCommit = source.indexOf(commit, renderStart);
  assert.ok(renderStart >= 0 && renderCommit > renderStart);
  vm.runInContext(source.slice(renderStart, renderCommit + commit.length) + '\n    renders++; rail.scrollLeft = 0; onCommit?.(); return true;\n  }', ctx);
  ctx.onCommit = null;
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
  assert.equal(ctx.preparations, 1, 'preparing the next viewer must not replace the current media');
  assert.equal(ctx.discardedViewers, 1);
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
  assert.equal(ctx.activeIndex, 0);
  assert.equal(ctx.discardedViewers, 1);
  assert.equal(ctx.switchingMedia, false);
});

test("reaching a disabled media arrow keeps keyboard focus within media navigation", async () => {
  const ctx = mediaSwitchHarness();
  ctx.onCommit = () => { ctx.trigger.disabled = true; };
  await ctx.switchMedia(1, ctx.trigger);
  assert.equal(ctx.focused, "media-navigation");
});

test('a note save begun during media preparation keeps the original player and pending draft', async () => {
  let release;
  let confirmations = 0;
  const ctx = mediaSwitchHarness(async () => { confirmations++; return true; });
  ctx.createMediaViewer = () => new Promise(resolve => { release = resolve; });
  const pending = ctx.switchMedia(1, ctx.trigger);
  ctx.notes.reviewFeedback.getState = () => ({ saving: true });
  release({ releaseMedia() { ctx.discardedViewers++; } }); await pending;
  assert.equal(ctx.activeIndex, 0);
  assert.equal(ctx.renders, 0);
  assert.equal(confirmations, 0);
  assert.equal(ctx.discardedViewers, 1);
  assert.deepEqual(ctx.errors, ['正在保存…']);
});

test('a save started while discard confirmation is pending cannot be replaced by the prepared viewer', async () => {
  let resolve;
  const ctx = mediaSwitchHarness(() => new Promise(done => { resolve = done; }));
  const pending = ctx.switchMedia(1, ctx.trigger);
  await new Promise(done => setImmediate(done));
  ctx.notes.reviewFeedback.getState = () => ({ saving: true });
  resolve(true); await pending;
  assert.equal(ctx.activeIndex, 0);
  assert.equal(ctx.renders, 0);
  assert.equal(ctx.discardedViewers, 1);
  assert.deepEqual(ctx.errors, ['正在保存…']);
});

// Small DOM doubles execute the production note handlers; they do not verify browser layout.
class Control {
  constructor(tag, className = "", text = "") {
    Object.assign(this, { tag, className, textContent: text, children: [], handlers: {}, dataset: {}, attributes: {}, value: "", hidden: false, isConnected: true });
    this.classList = { add: (...names) => { this.className += " " + names.join(" "); }, remove() {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(event, handler) { this.handlers[event] = handler; }
  fire(event) { return this.handlers[event]?.({ preventDefault() {} }); }
  getAttribute(name) { return this.attributes[name]; }
  cloneNode() { return Object.assign(new Control(this.tag, this.className), { attributes: { ...this.attributes }, type: this.type, min: this.min, step: this.step }); }
  focus(options) { this.focusOptions = options; }
  checkValidity() { return !this.value || Number.isFinite(Number(this.value)) && Number(this.value) >= 0; }
  querySelector() { return null; }
}

const feedbackSource = (await readFile(new URL('../extension/review-feedback.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replace(/export function /g, 'function ');
const panelDragSource = (await readFile(new URL('../extension/panel-drag.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replace(/export function /g, 'function ');
const panelPositionSource = (await readFile(new URL('../extension/panel-position.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '').replace(/export (async )?function /g, '$1function ');
function noteHarness(controller = null, response = { ok: true }) {
  const nodes = [], messages = [];
  const make = tag => { const node = new Control(tag); nodes.push(node); return node; };
  const ctx = vm.createContext({ document: { createElement: make }, createUiIcon: () => make('svg'), crypto: { randomUUID: () => 'new-note' },
    Number, Promise, notes: [{ id: 'existing', startMs: 3000, text: 'existing' }],
    getPosition: async () => { if (!controller?.getCurrentTimeMs) throw new Error('请输入备注时间'); return controller.getCurrentTimeMs(); },
    seek: async () => { if (!controller?.seekToMs) throw new Error('当前播放器无法直接跳转'); },
    saveNote: async note => { messages.push({ note }); if (!response?.ok) throw new Error('保存失败'); return [...ctx.notes, note]; },
    removeNote: async () => [] });
  vm.runInContext(panelDragSource + '\n' + panelPositionSource + '\n' + feedbackSource, ctx);
  const container = make('section'); ctx.container = container;
  vm.runInContext('api = mountReviewFeedback({ container, notes, getPosition, seek, saveNote, removeNote })', ctx);
  return { nodes, messages, api: ctx.api, byClass: name => nodes.find(node => node.className.startsWith(name)) };
}

test("uncontrollable external players keep manual time entry and report honest seek failure", async () => {
  const harness = noteHarness({ destroy() {} });
  await harness.api.open();
  assert.equal(harness.api.panel.hidden, false);
  assert.equal(harness.nodes.find(node => node.tag === 'input').value, '');
  await harness.byClass('button-secondary review-feedback-jump').fire('click');
  await Promise.resolve();
  assert.match(harness.byClass('review-feedback-status').textContent, /无法直接跳转/);
});

test("folding feedback retains its draft and reopens without moving the reading position", async () => {
  const harness = noteHarness({ getCurrentTimeMs: async () => 12500 });
  await harness.api.open();
  const text = harness.nodes.find(node => node.tag === 'textarea');
  text.value = 'unsaved feedback'; await harness.byClass('review-feedback-form').fire('input');
  harness.api.hide(); assert.equal(harness.api.panel.hidden, true);
  assert.equal(harness.api.getState().dirty, true);
  await harness.api.open();
  assert.equal(text.value, 'unsaved feedback');
  assert.equal(text.focusOptions.preventScroll, true);
});

test("failed feedback saves retain the draft and unknown time is never silently saved as zero", async () => {
  const harness = noteHarness(null, null); await harness.api.open();
  const text = harness.nodes.find(node => node.tag === 'textarea'), start = harness.nodes.find(node => node.tag === 'input');
  text.value = 'keep this'; await harness.byClass('review-feedback-form').fire('input');
  await harness.api.save(); assert.equal(harness.messages.length, 0);
  start.value = '0'; await harness.api.save();
  assert.equal(harness.messages[0].note.startMs, 0);
  assert.equal(harness.api.getState().dirty, true); assert.equal(text.value, 'keep this');
  assert.equal(harness.api.panel.hidden, false);
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
      t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]),
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
    t: (text, values = {}) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]),
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
