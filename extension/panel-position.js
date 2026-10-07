let positions = {}, loaded, revision = 0;
const pending = new Map();

export async function savedPanelPosition(key) {
  if (typeof chrome === 'undefined') return null;
  if (!loaded) {
    const readingRevision = revision;
    loaded = chrome.storage.local.get('uiPreferences').then(value => {
      if (readingRevision === revision) positions = value.uiPreferences?.floatingPanelPositions || {};
    });
  }
  await loaded;
  return pending.get(key) || positions[key] || null;
}

export async function savePanelPosition(key, panel, finalPosition) {
  const rect = finalPosition || panel.getBoundingClientRect();
  const position = { left: rect.left / window.innerWidth, top: rect.top / window.innerHeight };
  pending.set(key, position);
  try {
    await savedPanelPosition(key);
    const writingRevision = revision;
    const result = await chrome.runtime.sendMessage({ type: 'UPDATE_FLOATING_PANEL_POSITION', key, position });
    if (!result?.ok) throw new Error(result?.message || '保存失败');
    if (writingRevision === revision) positions = result.uiPreferences.floatingPanelPositions;
  } finally { if (pending.get(key) === position) pending.delete(key); }
}

if (typeof chrome !== 'undefined') chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.uiPreferences) {
    revision++;
    positions = changes.uiPreferences.newValue?.floatingPanelPositions || {};
  }
});
