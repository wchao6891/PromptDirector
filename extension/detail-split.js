// The existing narrow text panel is 340px; keep both panes usable while dragging.
const MIN_PANEL_WIDTH = 340;
const KEYBOARD_STEP = 16;

export function attachDetailSplit(primary, { label, readRatio, saveRatio }) {
  const separator = document.createElement("div");
  separator.className = "detail-split-resizer";
  separator.tabIndex = 0;
  separator.setAttribute("role", "separator");
  separator.setAttribute("aria-label", label);
  separator.setAttribute("aria-orientation", "vertical");
  primary.append(separator);
  let ratio = readRatio();
  let pointer = null;
  let startX = 0;
  let startWidth = 0;
  function bounds() {
    const total = primary.clientWidth;
    const min = Math.min(MIN_PANEL_WIDTH, total / 2);
    return { total, min, max: total - min };
  }
  function apply(width) {
    const { total, min, max } = bounds();
    if (!total) return;
    const value = Math.min(max, Math.max(min, width));
    primary.style.setProperty("--detail-panel-width", `${value}px`);
    separator.setAttribute("aria-valuemin", String(Math.round(min)));
    separator.setAttribute("aria-valuemax", String(Math.round(max)));
    separator.setAttribute("aria-valuenow", String(Math.round(value)));
    return value / total;
  }
  const body = primary.querySelector(":scope > .detail-body");
  const observer = new ResizeObserver(() => {
    if (!separator.getClientRects().length) return;
    apply(ratio == null ? body.getBoundingClientRect().width : primary.clientWidth * ratio);
  });
  observer.observe(primary);
  separator.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    startX = event.clientX;
    startWidth = body.getBoundingClientRect().width;
    separator.setPointerCapture(pointer);
    separator.classList.add("is-resizing");
  });
  separator.addEventListener("pointermove", event => {
    if (pointer !== event.pointerId) return;
    ratio = apply(startWidth + startX - event.clientX);
  });
  const finish = async event => {
    if (pointer !== event.pointerId) return;
    pointer = null;
    separator.classList.remove("is-resizing");
    if (separator.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId);
    if (ratio != null) await saveRatio(ratio);
  };
  separator.addEventListener("pointerup", finish);
  separator.addEventListener("pointercancel", finish);
  separator.addEventListener("keydown", async event => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    ratio = apply(body.getBoundingClientRect().width + (event.key === "ArrowLeft" ? KEYBOARD_STEP : -KEYBOARD_STEP));
    await saveRatio(ratio);
  });
  return () => { observer.disconnect(); separator.remove(); };
}
