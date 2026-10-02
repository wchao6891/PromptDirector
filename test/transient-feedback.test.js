import test from "node:test";
import assert from "node:assert/strict";
import { createTransientFeedback, FEEDBACK_DURATION_MS, ERROR_FEEDBACK_DURATION_MS, RECOVERY_ACTION_DURATION_MS } from "../extension/transient-feedback.js";

function fixture() {
  let id = 0;
  const tasks = new Map();
  const feedback = createTransientFeedback({
    setTimer(callback, delay) { const key = ++id; tasks.set(key, { callback, delay }); return key; },
    clearTimer(key) { tasks.delete(key); }
  });
  const classes = new Set();
  const element = { textContent: "", hidden: false, open: false, hovered: false,
    classList: { remove(name) { classes.delete(name); }, toggle(name, value) { value ? classes.add(name) : classes.delete(name); } },
    matches() { return this.hovered; } };
  function expire() { const [key, task] = tasks.entries().next().value; tasks.delete(key); task.callback(); }
  return { feedback, element, tasks, classes, expire };
}

test("finished success and error text clears without leaving red styling", () => {
  const { feedback, element, tasks, classes, expire } = fixture();
  feedback.show(element, "旧错误", { error: true, hideWhenEmpty: true });
  assert.equal([...tasks.values()][0].delay, ERROR_FEEDBACK_DURATION_MS);
  expire();
  assert.equal(element.textContent, "");
  assert.equal(element.hidden, true);
  assert.equal(classes.has("error"), false);
  feedback.show(element, "已完成", { hideWhenEmpty: true });
  assert.equal(element.hidden, false);
  assert.equal([...tasks.values()][0].delay, FEEDBACK_DURATION_MS);
  expire();
  assert.equal(element.textContent, "");
});

test("old notification expiry cannot erase a newer message and progress persists until completion", () => {
  const { feedback, element, tasks, expire } = fixture();
  feedback.show(element, "旧错误", { error: true });
  const oldCallback = [...tasks.values()][0].callback;
  feedback.show(element, "备份中", { pending: true });
  oldCallback();
  assert.equal(element.textContent, "备份中");
  assert.equal(tasks.size, 0);
  feedback.settle(element);
  assert.equal(tasks.size, 1);
  expire();
  assert.equal(element.textContent, "");
});

test("recovery presentation folds after interaction without removing the recovery control", () => {
  const { feedback, element, tasks, expire } = fixture();
  element.textContent = "可撤回";
  feedback.revealRecovery(element);
  assert.equal(element.open, true);
  assert.equal([...tasks.values()][0].delay, RECOVERY_ACTION_DURATION_MS);
  element.hovered = true;
  expire();
  assert.equal(element.open, true);
  element.hovered = false;
  expire();
  assert.equal(element.open, false);
  assert.equal(element.hidden, false);
  assert.equal(element.textContent, "可撤回");
});

test("leaving a panel clears its old error and folds recovery without clearing another panel", () => {
  const { feedback, element, tasks } = fixture();
  feedback.show(element, "红字", { error: true });
  const other = { ...element, textContent: "其他面板" };
  feedback.show(other, "其他面板", { pending: true });
  const recovery = { open: true };
  feedback.clearWithin({ contains(node) { return node === element; }, querySelectorAll() { return [recovery]; } });
  assert.equal(element.textContent, "");
  assert.equal(other.textContent, "其他面板");
  assert.equal(tasks.size, 0);
  assert.equal(recovery.open, false);
});
