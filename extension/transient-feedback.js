// Match the library's existing notification durations. Recovery actions remain
// available after their initially expanded presentation has folded away.
import { setTaskFeedbackState } from "./task-feedback.js";

export const FEEDBACK_DURATION_MS = 3000;
export const ERROR_FEEDBACK_DURATION_MS = 8000;
export const RECOVERY_ACTION_DURATION_MS = 30000;

export function createTransientFeedback({ setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const records = new Map();

  function cancel(element) {
    const record = records.get(element);
    if (record?.timer) clearTimer(record.timer);
    records.delete(element);
  }

  function clear(element) {
    const record = records.get(element);
    cancel(element);
    if (record?.kind === "recovery") element.open = false;
    else {
      element.textContent = "";
      setTaskFeedbackState(element);
      if (record?.progress) record.progress.hidden = true;
      if (record?.hideWhenEmpty) element.hidden = true;
    }
  }

  function schedule(element, record, duration) {
    if (!duration) return;
    record.timer = setTimer(() => {
      if (records.get(element) !== record) return;
      // Never fold a control out from under keyboard focus or pointer use.
      if (element.matches?.(":hover, :focus-within")) return schedule(element, record, duration);
      clear(element);
    }, duration);
  }

  function show(element, message, { error = false, pending = false, hideWhenEmpty = false, progress } = {}) {
    const previousProgress = records.get(element)?.progress;
    cancel(element);
    if (previousProgress && previousProgress !== progress) previousProgress.hidden = true;
    if (!message && progress) progress.hidden = true;
    element.textContent = message || "";
    setTaskFeedbackState(element, { error, pending: pending && Boolean(message) });
    if (hideWhenEmpty) element.hidden = !message;
    if (!message) return;
    const record = { kind: "message", error, pending, hideWhenEmpty, progress };
    records.set(element, record);
    schedule(element, record, pending ? 0 : error ? ERROR_FEEDBACK_DURATION_MS : FEEDBACK_DURATION_MS);
  }

  function settle(element) {
    const record = records.get(element);
    if (record?.kind === "message") show(element, element.textContent, { ...record, pending: false });
  }

  function revealRecovery(element) {
    cancel(element);
    element.open = true;
    const record = { kind: "recovery" };
    records.set(element, record);
    schedule(element, record, RECOVERY_ACTION_DURATION_MS);
  }

  function clearWithin(container) {
    for (const element of records.keys()) {
      if (container.contains(element) && !records.get(element)?.pending) clear(element);
    }
    for (const element of container.querySelectorAll("details.recovery-actions")) element.open = false;
  }

  return { show, clear, settle, revealRecovery, clearWithin };
}
