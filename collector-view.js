export function collectorViewState(draftValue = {}, targetEntry = null, options = {}) {
  const fragments = Array.isArray(draftValue.fragments) ? draftValue.fragments : [];
  const visuals = Array.isArray(draftValue.visuals) ? draftValue.visuals : [];
  const hasContent = fragments.length > 0 || visuals.length > 0;
  return {
    hasContent,
    showStart: !hasContent,
    showPreview: hasContent,
    showOrganizer: hasContent && options.organizing === true,
    showFooter: hasContent,
    canReorderFragments: fragments.length > 1,
    canReorderVisuals: visuals.length > 1,
    canChoosePrimary: visuals.length > 1,
    summary: captureSummary(fragments.length, visuals.length),
    targetLabel: targetEntry ? `正在补充《${targetEntry.title}》` : "",
    saveLabel: targetEntry ? "保存到这个案例" : "保存案例"
  };
}

export function captureSummary(fragmentCount, visualCount) {
  return [
    fragmentCount ? `${fragmentCount} 段文字` : "",
    visualCount ? `${visualCount} 张图片` : ""
  ].filter(Boolean).join(" · ");
}

export function assignVisualPreviewSource(image, url) {
  if (image && url) image.src = url;
}
