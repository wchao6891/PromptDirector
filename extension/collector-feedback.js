// Feedback occupies its own row above the active save buttons. It must not
// float over the fields or selection controls when the sidebar wraps.
export function anchorCollectorFeedback(feedback, anchors) {
  const update = () => {
    const anchor = anchors.find(element => element.getClientRects().length);
    if (anchor) {
      if (feedback.parentElement !== anchor) anchor.prepend(feedback);
      const controls = [...anchor.children].filter(element => element !== feedback && element.getClientRects().length)
        .map(element => element.getBoundingClientRect());
      const style = getComputedStyle(anchor);
      const controlsHeight = controls.length ? Math.max(...controls.map(rect => rect.bottom)) - Math.min(...controls.map(rect => rect.top)) : 0;
      const occupied = controlsHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
        + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) + (parseFloat(style.rowGap) || 0);
      feedback.style.setProperty('--collector-feedback-space', `${Math.max(0, innerHeight - occupied)}px`);
    } else if (feedback.parentElement !== anchors.at(-1).parentElement) anchors.at(-1).before(feedback);
    const footer = anchors.at(-1);
    document.body.style.setProperty('--collector-footer-space', `${footer.getClientRects().length ? footer.getBoundingClientRect().height : 0}px`);
  };
  const observer = new ResizeObserver(update);
  anchors.forEach(element => observer.observe(element));
  window.addEventListener('resize', update);
  update();
  return update;
}
