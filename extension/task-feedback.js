// Presentation only: completion comes from the task's own receipt/counters.
export function setTaskFeedbackState(element, { pending = false, error = false } = {}) {
  element.classList.toggle("ui-task-feedback", true);
  element.classList.toggle("error", error);
  element.setAttribute?.("aria-busy", String(pending && !error));
}

export function setTaskProgress(element, { completed, total, pending = false, error = false, visible = true } = {}) {
  element.hidden = !visible;
  element.classList.toggle("ui-task-progress", true);
  element.classList.toggle("error", error);
  element.setAttribute("aria-busy", String(pending && !error));
  if (Number.isFinite(total) && total > 0 && Number.isFinite(completed)) {
    element.max = total;
    element.value = Math.min(total, Math.max(0, completed));
  } else {
    // Unknown checking/saving progress must not reuse a previous phase's 100%.
    element.removeAttribute("value");
  }
}
