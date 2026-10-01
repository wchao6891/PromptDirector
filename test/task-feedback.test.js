import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { setTaskFeedbackState, setTaskProgress } from "../extension/task-feedback.js";
import { createTransientFeedback } from "../extension/transient-feedback.js";

function element() {
  const attributes = new Map();
  const classes = new Set();
  return {
    textContent: "", hidden: false, disabled: false,
    classList: {
      toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
      remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    set value(value) { attributes.set("value", String(value)); },
    get value() { return Number(attributes.get("value") || 0); }
  };
}

test("saving with unknown progress cannot keep the preceding transfer's full bar", () => {
  const progress = element();
  setTaskProgress(progress, { completed: 159, total: 159, pending: true });
  assert.equal(progress.value, 159);
  setTaskProgress(progress, { pending: true });
  assert.equal(progress.getAttribute("value"), null);
  assert.equal(progress.getAttribute("aria-busy"), "true");
});

test("a failure stops the waiting animation and keeps only verified work", () => {
  const status = element();
  const progress = element();
  setTaskFeedbackState(status, { pending: true });
  setTaskFeedbackState(status, { pending: true, error: true });
  setTaskProgress(progress, { completed: 22, total: 159, pending: true, error: true });
  assert.equal(status.getAttribute("aria-busy"), "false");
  assert.equal(progress.value, 22);
  assert.equal(progress.getAttribute("aria-busy"), "false");
});

test("terminal feedback expiry removes its bar; navigating panels keeps an active task", () => {
  const callbacks = new Map();
  let id = 0;
  const feedback = createTransientFeedback({ setTimer(fn) { callbacks.set(++id, fn); return id; }, clearTimer(key) { callbacks.delete(key); } });
  const status = element();
  const progress = element();
  feedback.show(status, "正在整理", { pending: true, progress });
  feedback.clearWithin({ contains: () => true, querySelectorAll: () => [] });
  assert.equal(status.textContent, "正在整理");
  assert.equal(status.getAttribute("aria-busy"), "true");
  feedback.settle(status);
  assert.equal(status.getAttribute("aria-busy"), "false");
  [...callbacks.values()][0]();
  assert.equal(status.textContent, "");
  assert.equal(progress.hidden, true);
});

test("a plain follow-up message cannot leave the preceding task's bar behind", () => {
  const feedback = createTransientFeedback({ setTimer: () => 1, clearTimer: () => {} });
  const status = element();
  const progress = element();
  feedback.show(status, "整理完成", { progress });
  feedback.show(status, "当前没有需要整理的标签");
  assert.equal(progress.hidden, true);
});

test("composer completion rendering stops feedback motion even when it bypasses renderActiveState", async () => {
  const source = await readFile(new URL("../extension/composer-page.js", import.meta.url), "utf8");
  const status = element();
  const failure = element();
  status.textContent = "正在执行";
  failure.textContent = "保存失败";
  setTaskFeedbackState(failure, { error: true });
  const context = {
    composerFeedbackElements: () => [status, failure], setTaskFeedbackState,
    activeOperation: {}, composerInitializationComplete: false, composerSession: null,
    elements: { composerInstruction: element(), composerAction: element() }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf("function renderSendState()"), source.indexOf("function composerTurnPolicyFor(")), context);
  context.renderSendState();
  assert.equal(status.getAttribute("aria-busy"), "true");
  context.activeOperation = null;
  context.renderSendState();
  assert.equal(status.getAttribute("aria-busy"), "false");
  assert.equal(failure.classList.contains("error"), true);
  assert.equal(failure.getAttribute("aria-busy"), "false");
});

const library = await readFile(new URL("../extension/library.js", import.meta.url), "utf8");
const controller = library.slice(library.indexOf("async function organizeDetailTags()"), library.indexOf("async function controlAnalysisBatch("));

function organizationFixture() {
  const elements = Object.fromEntries(["organizeDetailTags", "organizeDetailStatus", "organizeDetailProgress", "facetRecoveryActions"].map(name => [name, element()]));
  const chunks = Array.from({ length: 159 }, (_, index) => ({ g: ["subject", "人物与角色", `分组${index + 1}`], d: [[`detail${index}`, "测试标签", 1]] }));
  let resolveModel;
  let resolveSave;
  let failureAt = null;
  const calls = [];
  const saves = [];
  const notices = [];
  const context = {
    elements, facetCatalog: {}, entries: [], detailOrganizationProgress: null,
    createDetailOrganizationChunks: () => chunks, detailOrganizationRequestChunk: chunk => chunk,
    privateAiSettings: async () => ({ activeProvider: "fixture", analysisModel: "fixture" }),
    TextEncoder, currentLocale: () => "zh-CN", translateUiMessage: text => text,
    t: (text, args = {}) => text.replace(/\{([^}]+)\}/g, (_, key) => args[key] ?? `{${key}}`),
    confirmAppAction: async value => { notices.push(value); return true; },
    transientFeedback: createTransientFeedback({ setTimer: () => 1, clearTimer: () => {} }),
    setTaskProgress,
    organizeDetailTagsWithDeepSeek: async chunk => {
      const index = chunks.indexOf(chunk);
      calls.push(index);
      if (failureAt === index) { failureAt = null; throw new Error("同一标签有不同名称，本次未修改标签"); }
      if (index === 106) await new Promise(resolve => { resolveModel = resolve; });
      return { mappings: [{ id: chunk.d[0][0], n: chunk.d[0][1] }] };
    },
    chrome: { runtime: { sendMessage: async message => {
      saves.push(message);
      return await new Promise(resolve => { resolveSave = resolve; });
    } } },
    refreshLibrary: async () => {}
  };
  vm.createContext(context);
  vm.runInContext(controller, context);
  return { context, calls, saves, notices, elements, failAt(index) { failureAt = index; }, releaseModel() { resolveModel(); }, releaseSave(result) { resolveSave(result); } };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

test("the real tag controller shows 106 completed while request 107 waits, and completes only after the save receipt", async () => {
  const run = organizationFixture();
  const work = run.context.organizeDetailTags();
  await flush();
  assert.match(run.elements.organizeDetailStatus.textContent, /分组107 · 已完成106\/159批/);
  assert.equal(run.elements.organizeDetailProgress.value, 106);
  assert.equal(run.saves.length, 0);
  run.releaseModel();
  await flush();
  assert.equal(run.elements.organizeDetailStatus.textContent, "正在保存整理结果…");
  assert.equal(run.elements.organizeDetailProgress.getAttribute("value"), null);
  assert.equal(run.elements.organizeDetailTags.disabled, true);
  assert.equal(run.saves[0].mappings.length, 159);
  run.releaseSave({ ok: true, message: "三级标签整理完成" });
  await work;
  assert.equal(run.elements.organizeDetailProgress.value, 159);
  assert.equal(run.elements.organizeDetailStatus.getAttribute("aria-busy"), "false");
  assert.equal(run.elements.organizeDetailTags.disabled, false);
});

test("failed batch 23 stays at 22 completed and retry starts from those results without resending them", async () => {
  const run = organizationFixture();
  run.failAt(22);
  await run.context.organizeDetailTags();
  assert.equal(run.elements.organizeDetailProgress.value, 22);
  assert.equal(run.saves.length, 0);
  assert.match(run.elements.organizeDetailStatus.textContent, /第 23\/159 批/);
  const retry = run.context.organizeDetailTags();
  await flush();
  assert.match(run.notices[1].description, /137 次付费请求/);
  assert.equal(run.calls.filter(index => index < 22).length, 22);
  run.releaseModel();
  await flush();
  run.releaseSave({ ok: false, message: "写回冲突，正式标签未修改" });
  await retry;
  assert.equal(run.context.detailOrganizationProgress.results.length, 159);
  assert.equal(run.elements.organizeDetailProgress.hidden, true);
  assert.equal(run.elements.organizeDetailStatus.classList.contains("error"), true);
});
