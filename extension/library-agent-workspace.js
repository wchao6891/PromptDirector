import { observeImageTransparency } from "./image-transparency.js";
import { mountReviewFeedback, feedbackIcon, reviewTime } from './review-feedback.js';
import { prepareReviewFile, captureReviewFrame } from './review-file-transfer.js';
import { installReviewPlayerControls } from './review-player-controls.js';
import { installShortcutRouter, shortcutBindings, shortcutForEvent } from './keyboard-shortcuts.js';
import { saveMediaBlob } from './media-store.js';
import { sha256Blob } from './blob-digest.js';
import { agentDownloadChunkBytes, bytesToBase64 } from './agent-protocol.js';
import { getMediaBlob } from './media-store.js';
import { EMBED_PLAYER_RESPONSE_TIMEOUT_MS } from './media-playback.js';
import { createWorkspaceSession } from './workspace-session.js';
import { agentError } from './agent-protocol.js';
import { createUiIcon, setUiIcon } from './ui-icons.js';

export async function installLibraryAgentWorkspace({ chromeApi, readContext, openCase, selectCases, isDirty, libraryActions = {}, confirmDiscard = async () => false, t = value => value }) {
  const drawer = document.querySelector('#detail-drawer');
  const reviewButton = document.querySelector('#detail-review-toggle');
  const activity = document.querySelector('#workspace-agent-activity');
  const temporaryDialog = document.querySelector('#temporary-review-dialog');
  const temporaryMedia = document.querySelector('#temporary-review-media');
  const temporaryActions = document.querySelector('#temporary-review-actions');
  const temporarySave = document.querySelector('#temporary-review-save');
  const temporaryTools = document.createElement('div'); temporaryTools.className = 'detail-media-tools';
  temporaryTools.append(temporarySave); temporaryActions.append(temporaryTools);
  const readableDialogIds = ['manager-dialog', 'text-batch-dialog', 'vision-batch-dialog', 'share-dialog', 'import-dialog', 'library-package-import-dialog'];
  let temporaryFeedback = null, frameSaving = null, temporaryGroup = null, switchingTemporary = false;
  let bindings = shortcutBindings();
  let review = false, temporary = null, temporaryBlob = null, temporaryDigest = null, loop = null, source = 'human', saving = null;
  const pendingTemporary = new Map();
  let intent = 0, mediaIdentity = '', rangeStart = null, rangeEnd = null;
  for (const name of ['pointerdown', 'keydown', 'input', 'change']) document.addEventListener(name, event => { if (event.isTrusted) intent++; }, true);
  const video = () => temporary ? (temporaryDialog.open ? temporaryMedia.querySelector('video') : null) : drawer.querySelector('.detail-visual-stage video');
  function waitForMedia(player, eventName, ready) {
    if (ready()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); player.removeEventListener(eventName, onReady); player.removeEventListener('error', onError); error ? reject(error) : resolve(); };
      const onReady = () => finish();
      const onError = () => finish(agentError('playback_failed', '媒体无法加载或播放'));
      const timer = setTimeout(() => finish(agentError('media_not_ready', '播放器等待超时，请读取实际现场后重试')), EMBED_PLAYER_RESPONSE_TIMEOUT_MS);
      player.addEventListener(eventName, onReady); player.addEventListener('error', onError);
      if (eventName === 'loadedmetadata') player.load();
    });
  }
  function playback() {
    const player = video();
    if (!player) return { supported: false, reason: 'no_local_player' };
    return { supported: true, positionMs: player.currentTime * 1000, durationMs: Number.isFinite(player.duration) ? player.duration * 1000 : null,
      error: player.error ? { code: player.error.code, message: player.error.message } : null, seeking: player.seeking, range: { startMs: rangeStart, endMs: rangeEnd }, paused: player.paused, ended: player.ended, readyState: player.readyState, playbackRate: player.playbackRate, loop };
  }
  function readState() {
    const context = readContext();
    const identity = temporary?.id || `${context.viewedCaseId}:${context.viewedAssetId}`;
    if (identity !== mediaIdentity) { mediaIdentity = identity; loop = null; rangeStart = null; rangeEnd = null; }
    if (!context.viewedCaseId && review) { review = false; updateReviewButton(); }
    const selection = window.getSelection();
    const textSelected = selection?.toString() || '';
    const selectionInside = selection?.anchorNode && (drawer.contains(selection.anchorNode) || document.querySelector('#case-list')?.contains(selection.anchorNode));
    const active = document.activeElement;
    const editingInside = active && drawer.contains(active) && (active.matches('textarea,input') || active.isContentEditable);
    const dialogs = [...document.querySelectorAll('dialog[open]')].map(dialog => ({
      id: dialog.id || null,
      fieldsAvailable: readableDialogIds.includes(dialog.id),
      title: dialog.querySelector('h1,h2,h3')?.textContent || dialog.getAttribute('aria-label') || null,
      fields: readableDialogIds.includes(dialog.id)
        ? [...dialog.querySelectorAll('input:not([type=password]):not([type=file]),textarea,select')].filter(field => field.getClientRects().length)
          .map((field, index) => ({ id: field.id || field.name || `field-${index}`, value: field.type === 'checkbox' ? field.checked : field.value })) : []
    }));
    const mediaRead = temporaryDialog.open && temporary ? { operation: 'read_review_media', input: { tabId: tab?.id, temporaryId: temporary.id } }
      : context.viewedCaseId && context.viewedAssetId ? { operation: 'read_media', input: { caseId: context.viewedCaseId, assetId: context.viewedAssetId } } : null;
    const temporaryState = temporaryDialog.open && temporary ? { ...temporary, batch: { id: temporaryGroup.id, index: temporaryGroup.index,
      total: temporaryGroup.items.length, items: temporaryGroup.items.map(item => ({ assetId: item.assetId, name: item.name, kind: item.kind, saved: item.saved })) } } : null;
    return { ...context, dialogs, reviewFeedback: currentFeedback()?.getState() || null, screenshotSaving: Boolean(frameSaving), review, temporary: temporaryState, mediaRead, playback: playback(),
      textSelection: editingInside && typeof active.selectionStart === 'number' && active.selectionStart !== active.selectionEnd
        ? { text: active.value.slice(active.selectionStart, active.selectionEnd), start: active.selectionStart, end: active.selectionEnd, fieldId: active.id || active.name || active.getAttribute('aria-label'), caseId: context.viewedCaseId, assetId: context.viewedAssetId }
        : selectionInside ? { text: textSelected, anchorOffset: selection.anchorOffset, focusOffset: selection.focusOffset,
          blockId: selection.anchorNode.parentElement?.closest('[data-block-id]')?.dataset.blockId || null, caseId: context.viewedCaseId, assetId: context.viewedAssetId } : null,
      draft: { dirty: isDirty(), focusedField: editingInside ? active.id || active.name || active.getAttribute('aria-label') : null,
        text: editingInside ? active.value ?? active.textContent : null,
        fields: isDirty() ? [...drawer.querySelectorAll('textarea:not([readonly]),input:not([readonly]),[contenteditable=true]')].map((field, index) => ({ id: field.id || field.name || `field-${index}`, text: field.value ?? field.textContent })) : [] } };
  }
  function updateReviewButton() {
    const label = review ? '退出审片' : '审片';
    setUiIcon(reviewButton, review ? 'arrow-left' : 'clapperboard');
    reviewButton.title = t(label); reviewButton.setAttribute('aria-label', t(label));
    reviewButton.dataset.i18nTitle = label; reviewButton.dataset.i18nAriaLabel = label;
    reviewButton.setAttribute('aria-pressed', String(review));
  }
  async function preparePlayer(player) {
    player.preload = 'metadata'; await player.preparePlayback?.();
    await waitForMedia(player, 'loadedmetadata', () => player.readyState >= 1);
  }
  async function setReview(enabled) {
    if (!readContext().viewedCaseId) throw agentError('no_detail', '请先打开一个有媒体的案例');
    if (!drawer.querySelector('.detail-visual-gallery')) throw agentError('no_review_media', '此案例没有可审阅媒体');
    review = enabled;
    drawer.classList.toggle('is-reviewing', review);
    drawer.setAttribute('aria-modal', String(review || !drawer.classList.contains('detail-sidebar-mode')));
    updateReviewButton();
    drawer.querySelectorAll('.auxiliary-review-gallery').forEach(gallery => { gallery.hidden = !review; });
    const player = video();
    if (player) { player.controls = false; player.draggable = false; player.reviewTransport?.update(); if (enabled) await preparePlayer(player); }
  }
  async function perform(input) {
    const requireValue = key => { if (input[key] === undefined) throw agentError('invalid_input', `缺少${key}`); return input[key]; };
    if (document.querySelector('dialog[open]:not(#temporary-review-dialog)')) throw agentError('workspace_dialog', '用户正在处理当前弹窗，请先读取现场并等待用户完成');
    if (readContext().pendingAssetId) throw agentError('workspace_loading', '媒体正在切换，请读取就绪后的现场再操作');
    if (!readContext().ready) throw agentError('workspace_loading', '案例库尚未就绪');
    source = 'agent';
    const initialIntent = intent, initialLibraryRevision = readContext().libraryRevision;
    const assertIntent = () => { if (intent !== initialIntent || readContext().libraryRevision !== initialLibraryRevision) throw agentError('workspace_changed', '用户在执行期间进行了新操作，旧命令已停止'); };
    try {
      switch (input.action) {
        case 'open_case': {
          if (isDirty() || temporary) throw agentError('unsaved_workspace', '请先处理当前未保存编辑或临时审片');
          await openCase(requireValue('caseId'));
          if (readContext().viewedCaseId !== input.caseId || drawer.dataset.entryId !== input.caseId) throw agentError('display_failed', '案例详情未显示');
          break;
        }
        case 'select_media': {
          if (temporary) {
            if (isDirty() || temporaryFeedback?.getState().dirty || frameSaving || saving) throw agentError('unsaved_workspace', '当前编辑或审片反馈需要由用户处理');
            const index = temporaryGroup.items.findIndex(item => item.assetId === requireValue('assetId'));
            if (index < 0) throw agentError('media_not_found', '素材不在当前审片组中');
            await switchTemporary(index, assertIntent);
            if (temporary.assetId !== input.assetId) throw agentError('display_failed', '指定样片未显示');
            break;
          }
          if (isDirty() || temporary) throw agentError('unsaved_workspace', '当前编辑或临时审片需要由用户处理');
          const gallery = drawer.querySelector('.detail-visual-gallery');
          if (!gallery?.selectAsset) throw agentError('no_detail', '请先打开媒体详情');
          await gallery.selectAsset(requireValue('assetId'));
          if (readContext().viewedAssetId !== input.assetId) throw agentError('display_failed', '指定素材未显示');
          loop = null; break;
        }
        case 'set_selection': await selectCases(requireValue('caseIds')); break;
        case 'set_review': await setReview(requireValue('enabled')); break;
        case 'open_temporary': {
          if (isDirty() || temporaryFeedback?.getState().dirty || temporaryFeedback?.getState().saving) throw agentError('unsaved_workspace', '请先保存当前备注或案例编辑');
          if (saving || frameSaving) throw agentError('workspace_busy', '样片正在保存，请等待实际保存结果');
          const descriptor = pendingTemporary.get(input.requestId);
          if (!descriptor) throw agentError('invalid_review_media', '临时媒体未就绪');
          const blob = await getMediaBlob(descriptor.assetId); assertIntent();
          if (!blob) throw agentError('media_missing', '临时文件已不可用');
          openTemporary(blob, descriptor.name, descriptor); break;
        }
        case 'close_temporary': {
          if (frameSaving) throw agentError('workspace_busy', '截图正在保存');
          if (temporaryFeedback?.getState().dirty || temporaryFeedback?.getState().saving) throw agentError('unsaved_workspace', '请先保存当前备注');
          if (temporaryDialog.open) await new Promise(resolve => { temporaryDialog.addEventListener('close', resolve, { once: true }); temporaryDialog.close(); });
          break;
        }
        case 'clear_range': clearRange(); break;
        case 'save_temporary': {
          if (!temporary || temporary.id !== requireValue('temporaryId')) throw agentError('review_changed', '临时样片已切换或关闭');
          const saved = await saveTemporary();
          return { action: input.action, saved, foreground: document.visibilityState === 'visible' };
        }
        case 'play': case 'pause': case 'seek': case 'set_loop': {
          const player = video();
          if (!player) throw agentError('unsupported_playback', '当前媒体不是可控制的本地播放器，请使用来源播放器');
          if (input.action === 'pause') player.pause();
          else {
            await preparePlayer(player); assertIntent();
            if (input.action === 'play') { await player.play(); assertIntent(); }
            if (input.action === 'seek') {
              const target = requireValue('positionMs');
              if (Number.isFinite(player.duration) && target > player.duration * 1000) throw agentError('invalid_position', '定位超出视频时长');
              player.currentTime = target / 1000;
              await waitForMedia(player, 'seeked', () => !player.seeking); assertIntent();
            }
            if (input.action === 'set_loop') {
              if (requireValue('enabled')) {
                const startMs = requireValue('startMs'), endMs = requireValue('endMs');
                if (endMs <= startMs || !Number.isFinite(player.duration) || endMs > player.duration * 1000) throw agentError('invalid_range', '审片区间无效或时长未知');
                rangeStart = startMs; rangeEnd = endMs; loop = { startMs, endMs }; player.currentTime = startMs / 1000;
                await player.play(); assertIntent();
              } else loop = null;
            }
          }
          if (input.action === 'play' && player.paused) throw agentError('playback_failed', '播放器未开始播放');
          break;
        }
        default: throw agentError('invalid_action', '不支持的页面命令');
      }
      assertIntent(); syncRangeControls();
      return { action: input.action, foreground: document.visibilityState === 'visible' };
    } finally { source = 'human'; }
  }
  async function readTemporary(input) {
    if (!temporaryDialog.open && readContext().viewedCaseId) throw agentError('review_changed', '当前审片是库内案例，没有临时样片；请按现场mediaRead使用read_media读取库内原件');
    if (!temporaryDialog.open || !temporary || temporary.id !== input.temporaryId || !temporaryBlob) throw agentError('review_changed', '临时样片已切换或关闭');
    const blob = temporaryBlob, id = temporary.id;
    const sha256 = await (temporaryDigest ||= sha256Blob(blob));
    if (temporary?.id !== id) throw agentError('review_changed', '读取期间临时样片已切换');
    const offset = input.offset || 0;
    if (offset > blob.size) throw agentError('invalid_input', '读取位置超出文件');
    const length = Math.min(input.length || agentDownloadChunkBytes(), agentDownloadChunkBytes());
    const end = Math.min(blob.size, offset + length);
    const data = bytesToBase64(new Uint8Array(await blob.slice(offset, end).arrayBuffer()));
    if (!temporaryDialog.open || temporary?.id !== id) throw agentError('review_changed', '读取期间临时样片已切换或关闭');
    return { offset, byteSize: blob.size, name: temporary.name, mimeType: blob.type, sha256,
      data, nextOffset: end < blob.size ? end : null, temporaryId: id };
  }
  const session = createWorkspaceSession({ readState, perform, readControlState: state => ({
    ...state, humanIntent: intent,
    playback: { supported: state.playback.supported, loop: state.playback.loop, range: state.playback.range }
  }) });
  const tab = await chromeApi.tabs.getCurrent();
  chromeApi.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chromeApi.runtime.id || sender.url !== chromeApi.runtime.getURL('background.js')) return false;
    if (message?.type === 'AGENT_WORKSPACE_ACTIVITY') {
      activity.hidden = false;
      activity.textContent = `Agent：${t(message.label)}` + (message.state === 'running' ? '…' : message.state === 'accepted' ? ` · ${t('已接收')}` : message.state === 'failed' ? ` · ${t('失败')}` : ` · ${t('完成')}`);
      activity.title = message.message || activity.textContent; return false;
    }
    if (message?.type !== 'AGENT_LIVE_WORKSPACE' || message.tabId !== tab?.id) return false;
    const input = message.input || {};
    if (message.temporary) pendingTemporary.set(input.requestId, message.temporary);
    const work = message.operation === 'read_review_media' ? readTemporary(input) : message.operation === 'control_workspace' ? session.execute(input)
      : message.operation === 'wait_workspace_changes' ? session.wait(input) : Promise.resolve({ ...session.read(), ...(input.requestId ? { requestKnown: session.hasReceipt(input.requestId) } : {}) });
    work.finally(() => pendingTemporary.delete(input.requestId)).catch(() => {});
    work.then(result => respond({ ok: true, result }), error => respond({ ok: false, code: error.code || 'workspace_failed', message: error.message }));
    return true;
  });
  let pending = false, pendingSource = 'human';
  function scheduleObserve(eventOrSource) {
    const nextSource = typeof eventOrSource === 'string' ? eventOrSource
      : source === 'agent' ? 'agent'
      : ['play', 'pause', 'seeked', 'loadedmetadata', 'ended', 'timeupdate'].includes(eventOrSource?.type) ? 'playback' : 'human';
    if (pending) { if (nextSource !== 'playback') pendingSource = nextSource; return; }
    pending = true; pendingSource = nextSource;
    requestAnimationFrame(() => { pending = false; session.observe(pendingSource); });
  }
  for (const name of ['click', 'input', 'change', 'selectionchange', 'play', 'pause', 'seeked', 'loadedmetadata', 'ended', 'timeupdate']) {
    document.addEventListener(name, scheduleObserve, true);
  }
  document.addEventListener('timeupdate', event => {
    if (event.target === video() && loop && event.target.currentTime * 1000 >= loop.endMs) event.target.currentTime = loop.startMs / 1000;
  }, true);
  function clearRange() { rangeStart = null; rangeEnd = null; loop = null; currentFeedback()?.useCurrentTime(); }
  function syncRangeControls() {
    const text = rangeStart !== null && rangeEnd !== null ? `${reviewTime(rangeStart)} – ${reviewTime(rangeEnd)}` : '';
    video()?.reviewTransport?.update();
    for (const button of document.querySelectorAll('[data-review-loop]')) button.setAttribute('aria-pressed', String(Boolean(loop)));
    for (const button of document.querySelectorAll('[data-review-clear]')) button.disabled = rangeStart === null && rangeEnd === null;
    for (const bar of document.querySelectorAll('.review-range-controls')) {
      bar.title = text;
      const [start, end] = bar.querySelectorAll('button');
      start.title = `${t('入点')}${bindings.markIn ? ` · ${bindings.markIn}` : ''}${rangeStart === null ? '' : ` · ${reviewTime(rangeStart)}`}`;
      end.title = `${t('出点')}${bindings.markOut ? ` · ${bindings.markOut}` : ''}${rangeEnd === null ? '' : ` · ${reviewTime(rangeEnd)}`}`;
    }
  }
  function installRangeControls() {
    const player = video();
    if (!player) return;
    installReviewPlayerControls(player, { range: () => ({ startMs: rangeStart, endMs: rangeEnd }), review: () => setReview(!review), t, failed: error => showReviewFeedback(error.message, true) });
    const gallery = player.closest('.detail-visual-gallery');
    if (gallery) gallery.reviewRange = () => ({ startMs: rangeStart, endMs: rangeEnd });
    const toolbar = temporary ? temporaryActions : player.closest('.detail-visual-item')?.querySelector('.detail-visual-caption');
    if (!toolbar || toolbar.querySelector('.review-range-controls')) return;
    const bar = document.createElement('div'); bar.className = 'review-range-controls';
    for (const [name, icon, action] of [
      ['入点', 'mark-in', async () => { rangeStart = player.currentTime * 1000; loop = null; }],
      ['出点', 'mark-out', async () => { rangeEnd = player.currentTime * 1000; loop = null; }],
      ['清除入出点', 'eraser', async () => clearRange()],
      ['保存截图', 'camera', async () => {
        await preparePlayer(player); await waitForMedia(player, 'loadeddata', () => player.readyState >= 2); await waitForMedia(player, 'seeked', () => !player.seeking);
        if (player !== video()) throw agentError('review_changed', '截图期间媒体已切换');
        return temporaryDialog.open ? captureTemporaryFrame() : gallery.captureFrame();
      }],
      ['循环', 'repeat-2', async () => {
        if (loop) { loop = null; return; }
        if (rangeStart === null || rangeEnd === null || rangeEnd <= rangeStart) throw agentError('invalid_range', t('请先设置有效的入点和出点'));
        await preparePlayer(player);
        if (player !== video()) throw agentError('review_changed', '设置循环期间媒体已切换');
        loop = { startMs: rangeStart, endMs: rangeEnd }; player.currentTime = rangeStart / 1000;
        await player.play();
      }]
    ]) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'icon-button';
      button.title = t(name); button.setAttribute('aria-label', t(name)); button.dataset.i18nTitle = name; button.dataset.i18nAriaLabel = name;
      button.append(createUiIcon(icon));
      if (name === '循环') button.dataset.reviewLoop = '';
      else if (name === '清除入出点') button.dataset.reviewClear = '';
      else if (name === '保存截图') button.dataset.reviewCapture = '';
      else button.dataset.reviewPoint = name === '入点' ? 'in' : 'out';
      button.addEventListener('click', async () => {
        try { await action(); } catch (error) { showReviewFeedback(error.message, true); }
        syncRangeControls(); scheduleObserve();
      });
      bar.append(button);
    }
    const feedbackButton = toolbar.querySelector('[data-review-feedback]');
    if (feedbackButton) bar.append(feedbackButton);
    const tools = toolbar.querySelector('.detail-media-tools') || toolbar;
    tools.insertBefore(bar, temporary ? temporarySave : tools.querySelector('.detail-visual-actions'));
    updateShortcutHints();
    syncRangeControls();
  }
  function showReviewFeedback(message, failed = false) {
    if (temporaryDialog.open) {
      let feedback = temporaryActions.querySelector('[role=status]');
      if (!feedback) { feedback = document.createElement('span'); feedback.setAttribute('role', 'status'); feedback.className = 'review-save-feedback'; temporaryActions.append(feedback); }
      feedback.textContent = message; feedback.classList.toggle('is-error', failed);
    } else { activity.hidden = false; activity.textContent = message; }
  }
  async function saveTemporary() {
    if (frameSaving) throw agentError('workspace_busy', '截图正在保存');
    if (temporaryFeedback?.getState().dirty || temporaryFeedback?.getState().saving) throw agentError('unsaved_workspace', '请先保存当前备注');
    if (!temporaryDialog.open || !temporary?.transferId) throw agentError('review_changed', '临时样片已切换或关闭');
    if (temporary.saved) return temporary.savedCase;
    if (saving) return saving;
    const current = temporary;
    const group = temporaryGroup;
    group.saveInput ||= { requestId: `review-save-${group.id}`, transferIds: group.items.map(item => item.transferId),
      reviewRevisions: Object.fromEntries(group.items.map(item => [item.transferId, item.feedback?.revision || 0])),
      title: group.items[0].name.replace(/\.[^.]+$/, '') || group.items[0].name, ...(readContext().projectId ? { project: readContext().projectId } : {}) };
    temporarySave.disabled = true;
    saving = (async () => {
      const result = await chromeApi.runtime.sendMessage({ type: 'SAVE_REVIEW_MATERIAL', input: group.saveInput });
      if (result?.ok === false) throw agentError(result.code || 'save_failed', result.message || '保存失败');
      const saved = result?.results?.[0];
      if (!saved || !['saved', 'partial', 'duplicate'].includes(saved.status)) throw agentError('save_failed', '未取得实际保存回执');
      for (const item of group.items) { item.saved = true; item.savedCase = saved; } delete group.saveInput;
      if (temporary === current && temporaryDialog.open) {
        setUiIcon(temporarySave, 'check'); temporarySave.title = t('已保存'); temporarySave.setAttribute('aria-label', t('已保存'));
        showReviewFeedback(saved.warnings?.join('；') || t('已保存'));
      }
      return saved;
    })();
    try { return await saving; }
    finally { saving = null; if (temporary === current) temporarySave.disabled = current.saved; scheduleObserve('library'); }
  }
  function currentFeedback() { return temporaryDialog.open ? temporaryFeedback : drawer.querySelector('.detail-visual-gallery')?.reviewFeedback; }
  bindings = shortcutBindings((await chromeApi.storage.local.get('uiPreferences')).uiPreferences?.shortcuts);
  function updateShortcutHints() {
    for (const [selector, key, label] of [['[data-review-point=in]', 'markIn', '入点'], ['[data-review-point=out]', 'markOut', '出点'], ['[data-review-feedback]', 'addFeedback', '创作备注'], ['[data-review-capture]', 'captureFrame', '保存截图'], ['[data-review-clear]', 'clearRange', '清除入出点']]) {
      for (const button of document.querySelectorAll(selector)) {
        button.title = `${t(label)}${bindings[key] ? ` · ${bindings[key]}` : ''}`;
        bindings[key] ? button.setAttribute('aria-keyshortcuts', bindings[key]) : button.removeAttribute('aria-keyshortcuts');
      }
    }
    currentFeedback()?.setSaveShortcut(bindings.saveFeedback);
    for (const [selector, key] of [['[data-review-refresh-time]', 'refreshFeedbackTime'], ['[data-review-media=previous]', 'previousMedia'], ['[data-review-media=next]', 'nextMedia']]) {
      for (const button of document.querySelectorAll(selector)) bindings[key] ? button.setAttribute('aria-keyshortcuts', bindings[key]) : button.removeAttribute('aria-keyshortcuts');
    }
  }
  chromeApi.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.uiPreferences) { bindings = shortcutBindings(changes.uiPreferences.newValue?.shortcuts); updateShortcutHints(); }
  });
  installShortcutRouter({ bindings: () => bindings,
    scope: event => {
      if (document.fullscreenElement && event.key === 'Escape') return null;
      if (event.target.closest?.('.detail-project-selector,.prompt-source-tabs,.tag-editor-compact')) return null;
      if (event.target.closest?.('.review-feedback-panel')) return 'feedback';
      if (document.querySelector('dialog[open]:not(#temporary-review-dialog)')) return null;
      const visibleMedia = drawer.getAttribute('aria-hidden') !== 'true' && drawer.querySelector('.detail-visual-gallery');
      if (temporaryDialog.open || review || visibleMedia && (video() ||
        [shortcutForEvent(event), shortcutForEvent(event, true)].includes(bindings.addFeedback))) return 'review';
      return readContext().viewedCaseId ? 'detail' : 'library';
    },
    actions: { ...libraryActions,
      markIn: () => activeToolbar()?.querySelector('[data-review-point=in]')?.click(),
      markOut: () => activeToolbar()?.querySelector('[data-review-point=out]')?.click(),
      toggleLoop: () => activeToolbar()?.querySelector('[data-review-loop]')?.click(),
      clearRange: () => activeToolbar()?.querySelector('[data-review-clear]')?.click(),
      captureFrame: () => activeToolbar()?.querySelector('[data-review-capture]')?.click(),
      previousMedia: () => activeToolbar()?.querySelector('[data-review-media=previous]')?.click(),
      nextMedia: () => activeToolbar()?.querySelector('[data-review-media=next]')?.click(),
      refreshFeedbackTime: () => currentFeedback()?.refreshTime(),
      playPause: () => video()?.reviewTransport?.play.click(),
      addFeedback: () => { void currentFeedback()?.open(); updateShortcutHints(); },
      saveFeedback: () => { void currentFeedback()?.save(); }, closeFeedback: () => currentFeedback()?.hide(),
      newlineFeedback: () => currentFeedback()?.newline(),
      mute: () => video()?.reviewTransport?.mute.click(),
      toggleReview: () => { void setReview(!review); },
      closeReview: () => { if (temporaryDialog.open) void closeTemporary(); else if (review) void setReview(false); else libraryActions.closeDetail?.(); }
    }
  });
  const activeToolbar = () => temporaryDialog.open ? temporaryActions : drawer.querySelector('.detail-visual-caption');
  async function closeTemporary() {
    if (saving || frameSaving || temporaryFeedback?.getState().saving) return showReviewFeedback(t('正在保存…'));
    if (temporaryFeedback?.getState().dirty && !await confirmDiscard()) return;
    if (document.fullscreenElement && temporaryDialog.contains(document.fullscreenElement)) {
      try { await document.exitFullscreen(); }
      catch (error) { showReviewFeedback(error.message, true); return; }
    }
    temporaryDialog.close();
  }
  function mountTemporaryFeedback() {
    const current = temporary;
    const player = temporaryMedia.querySelector('video');
    const call = async message => {
      const result = await chromeApi.runtime.sendMessage(message);
      if (result?.ok === false) throw new Error(result.message || t('保存失败'));
      return result;
    };
    const persist = async (note, removeId) => {
      if (saving) throw new Error('样片正在保存');
      if (temporary !== current) throw new Error('样片已切换');
      if (current.saved) {
        const result = await call(removeId ? { type: 'DELETE_TIME_NOTE', entryId: current.savedCase.entryId, noteId: removeId }
          : { type: 'ADD_TIME_NOTE', entryId: current.savedCase.entryId, note: { ...note, assetId: current.assetId } });
        current.feedback.notes = result.entry.timeNotes.filter(item => item.assetId === current.assetId); scheduleObserve('library'); return current.feedback.notes;
      }
      const result = await call({ type: 'REVIEW_FEEDBACK', input: { id: current.transferId, expectedRevision: current.feedback?.revision || 0,
        ...(note ? { note } : { removeId }) } });
      current.feedback = result.feedback; scheduleObserve(); return result.feedback.notes;
    };
    temporaryFeedback = mountReviewFeedback({ container: document.querySelector('#temporary-review-notes'), notes: current.feedback?.notes || [], timed: Boolean(player), t,
      getPosition: async () => player ? player.currentTime * 1000 : 0, getRange: () => ({ startMs: rangeStart, endMs: rangeEnd }),
      seek: ms => { if (player) player.currentTime = ms / 1000; },
      saveNote: note => persist(note), removeNote: id => persist(null, id), changed: () => scheduleObserve()
    });
    const button = feedbackIcon('创作备注', 'message-square', t); button.dataset.reviewFeedback = '';
    button.addEventListener('click', () => { void temporaryFeedback.open(); updateShortcutHints(); });
    temporaryActions.querySelector('[data-review-feedback]')?.remove(); temporaryTools.insertBefore(button, temporarySave);
  }
  async function renderTemporaryFrames() {
    const current = temporary;
    let shelf = temporaryDialog.querySelector('.temporary-review-frames');
    if (!shelf) { shelf = document.createElement('section'); shelf.className = 'temporary-review-frames'; shelf.hidden = true; temporaryDialog.append(shelf); }
    for (const image of shelf.querySelectorAll('img')) URL.revokeObjectURL(image.src);
    shelf.replaceChildren();
    for (const frame of current?.feedback?.frames || []) {
      const blob = await getMediaBlob(frame.assetId);
      if (temporary !== current || !shelf.isConnected) return;
      if (!blob) continue;
      const row = document.createElement('div'); row.className = 'temporary-review-frame';
      const image = document.createElement('img'); image.src = URL.createObjectURL(blob); image.alt = t('截图'); image.title = reviewTime(frame.positionMs || 0);
      const remove = feedbackIcon('删除截图', 'trash-2', t);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        try {
          const response = await chromeApi.runtime.sendMessage(current.saved
            ? { type: 'DELETE_ENTRY_MEDIA', entryId: current.savedCase.entryId, assetId: frame.assetId }
            : { type: 'REVIEW_FEEDBACK', input: { id: current.transferId, expectedRevision: current.feedback.revision, removeFrameId: frame.assetId } });
          if (response?.ok === false) throw new Error(response.message);
          if (current.saved) current.feedback.frames = current.feedback.frames.filter(item => item.assetId !== frame.assetId);
          else current.feedback = response.feedback;
          if (temporary === current) await renderTemporaryFrames(); scheduleObserve('library');
        } catch (error) { showReviewFeedback(error.message, true); remove.disabled = false; }
      });
      row.append(image, remove); shelf.append(row);
    }
    let toggle = temporaryActions.querySelector('[data-review-frames]');
    if (!toggle) {
      toggle = feedbackIcon('查看截图', 'images', t); toggle.dataset.reviewFrames = ''; toggle.setAttribute('aria-expanded', 'false');
      toggle.addEventListener('click', () => { const frames = temporaryDialog.querySelector('.temporary-review-frames'); frames.hidden = !frames.hidden; toggle.setAttribute('aria-expanded', String(!frames.hidden)); });
      temporaryTools.insertBefore(toggle, temporarySave);
    }
    toggle.disabled = !current?.feedback?.frames?.length;
    toggle.title = `${t('查看截图')} · ${current?.feedback?.frames?.length || 0}`;
  }
  async function captureTemporaryFrame() {
    if (frameSaving) return frameSaving;
    if (saving) throw new Error('样片正在保存');
    const current = temporary, player = video();
    const positionMs = Math.round(player.currentTime * 1000), width = player.videoWidth, height = player.videoHeight;
    const button = temporaryActions.querySelector('[data-review-capture]'); button.disabled = true;
    frameSaving = (async () => {
      const blob = await captureReviewFrame(player);
      const prepared = await prepareReviewFile(new File([blob], 'frame.webp', { type: blob.type }), chromeApi);
      const result = await chromeApi.runtime.sendMessage(current.saved
        ? { type: 'ADD_VIDEO_KEYFRAME', entryId: current.savedCase.entryId,
            asset: { id: prepared.assetId, kind: 'image', storageMode: 'managed', mimeType: blob.type, byteSize: blob.size,
              width, height, derivedFromAssetId: current.assetId, frameTimeMs: positionMs, sourceTitle: current.name } }
        : { type: 'REVIEW_FEEDBACK', input: { id: current.transferId, expectedRevision: current.feedback?.revision || 0,
            frameTransferId: prepared.transferId, positionMs } });
      if (result?.ok === false) throw new Error(result.message || t('保存失败'));
      if (current.saved) current.feedback.frames.push({ transferId: prepared.transferId, assetId: prepared.assetId, positionMs });
      else current.feedback = result.feedback;
      if (temporary === current) { await renderTemporaryFrames(); showReviewFeedback(t('截图已保存')); }
      scheduleObserve('library');
    })();
    try { return await frameSaving; } finally { frameSaving = null; if (button.isConnected) button.disabled = false; }
  }
  document.querySelector('#open-temporary-review').addEventListener('click', () => {
    document.querySelector('#add-menu').open = false; document.querySelector('#temporary-review-file').click();
  });
  document.querySelector('#temporary-review-file').addEventListener('change', async event => {
    const files = [...(event.target.files || [])]; event.target.value = ''; if (!files.length) return;
    const initialIntent = intent, current = temporary;
    try {
      if (saving || frameSaving || temporaryFeedback?.getState().saving) throw new Error('正在保存…');
      if (isDirty() || temporaryFeedback?.getState().dirty) throw new Error('请先保存当前备注或编辑');
      const descriptors = [];
      for (const file of files) {
        showReviewFeedback(`${t('正在准备…')} ${descriptors.length + 1}/${files.length}`);
        descriptors.push(await prepareReviewFile(file, chromeApi));
      }
      const descriptor = descriptors[0];
      const blob = await getMediaBlob(descriptor.assetId); if (!blob) throw new Error('样片不可用');
      if (intent !== initialIntent || temporary !== current || isDirty() || temporaryFeedback?.getState().dirty || saving || frameSaving) throw new Error('审片现场已变化，请重新选择样片');
      temporaryGroup = { id: crypto.randomUUID(), items: descriptors.map(item => ({ ...item, saved: false })), index: 0 };
      openTemporary(blob, descriptor.name, temporaryGroup.items[0], true);
    } catch (error) { showReviewFeedback(error.message, true); }
  });
  new MutationObserver(() => { installRangeControls(); scheduleObserve(); }).observe(temporaryMedia, { childList: true });
  new MutationObserver(() => { installRangeControls(); scheduleObserve(); }).observe(drawer, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  reviewButton.addEventListener('click', () => { void setReview(!review).catch(error => showReviewFeedback(error.message, true)); });
  drawer.addEventListener('enter-media-review', () => { void setReview(true).catch(error => showReviewFeedback(error.message, true)); });
  drawer.addEventListener('toggle-media-review', () => { void setReview(!review).catch(error => showReviewFeedback(error.message, true)); });
  temporarySave.addEventListener('click', () => { void saveTemporary().catch(error => showReviewFeedback(error.message, true)); });
  function openTemporary(blob, name, descriptor = {}, keepGroup = false) {
    temporaryFeedback?.dispose();
    temporaryMedia.querySelector('video')?.pause();
    const oldMedia = temporaryMedia.querySelector('video,img'); if (oldMedia) URL.revokeObjectURL(oldMedia.src);
    for (const image of temporaryDialog.querySelectorAll('.temporary-review-frames img')) URL.revokeObjectURL(image.src);
    temporaryActions.querySelector('.review-range-controls')?.remove(); temporaryActions.querySelector('[role=status]')?.remove();
    setUiIcon(temporarySave, 'save'); temporarySave.disabled = false; temporarySave.title = t('保存入库'); temporarySave.setAttribute('aria-label', t('保存入库'));
    temporaryBlob = blob; temporaryDigest = null;
    if (!keepGroup) temporaryGroup = { id: crypto.randomUUID(), items: [{ ...descriptor, saved: false }], index: 0 };
    temporary = temporaryGroup.items[temporaryGroup.index];
    Object.assign(temporary, { id: crypto.randomUUID(), name, byteSize: blob.size, mimeType: blob.type });
    const player = document.createElement(descriptor.kind === 'video' || blob.type.startsWith('video/') ? 'video' : 'img');
    if (player instanceof HTMLVideoElement) player.controls = false;
    else observeImageTransparency(player, transparent => player.classList.toggle('has-alpha-channel', transparent));
    player.src = URL.createObjectURL(blob); temporaryMedia.replaceChildren(player);
    const previousPosition = temporary.positionMs;
    if (player instanceof HTMLVideoElement && previousPosition) player.addEventListener('loadedmetadata', () => { player.currentTime = previousPosition / 1000; }, { once: true });
    temporaryFeedback = null; document.querySelector('#temporary-review-notes').replaceChildren();
    mountTemporaryFeedback();
    if (temporary.saved) { setUiIcon(temporarySave, 'check'); temporarySave.disabled = true; temporarySave.setAttribute('aria-label', t('已保存')); temporarySave.title = t('已保存'); }
    installTemporaryNavigation();
    temporaryDialog.querySelector('.temporary-review-frames')?.remove(); temporaryActions.querySelector('[data-review-frames]')?.remove();
    void renderTemporaryFrames();
    if (!temporaryDialog.open) temporaryDialog.showModal(); loop = null; session.observe(source);
  }
  async function switchTemporary(index, assertCurrent) {
    if (switchingTemporary || saving || frameSaving || temporaryFeedback?.getState().saving) return;
    if (index < 0 || index >= temporaryGroup.items.length || index === temporaryGroup.index) return;
    if (temporaryFeedback?.getState().dirty) return showReviewFeedback(t('请先保存当前备注'));
    switchingTemporary = true;
    try {
      const group = temporaryGroup, target = group.items[index];
      const blob = await getMediaBlob(target.assetId);
      if (group !== temporaryGroup || !temporaryDialog.open) return;
      if (!blob) throw new Error('样片不可用');
      // Reading an original yields to new input and saves in the current panel.
      if (isDirty() || temporaryFeedback?.getState().dirty || temporaryFeedback?.getState().saving || saving || frameSaving) {
        throw agentError('unsaved_workspace', t('请先保存当前备注'));
      }
      assertCurrent?.();
      temporary.positionMs = video()?.currentTime * 1000 || 0;
      group.index = index; openTemporary(blob, target.name, target, true);
    } catch (error) { if (assertCurrent) throw error; showReviewFeedback(error.message, true); }
    finally { switchingTemporary = false; }
  }
  function installTemporaryNavigation() {
    temporaryActions.querySelector('.detail-media-navigation')?.remove();
    temporaryActions.classList.toggle('has-media-navigation', temporaryGroup.items.length > 1);
    if (temporaryGroup.items.length < 2) return;
    const nav = document.createElement('nav'); nav.className = 'detail-media-navigation'; nav.setAttribute('aria-label', t('切换案例内媒体'));
    const previous = feedbackIcon('上一项媒体', 'chevron-left', t), next = feedbackIcon('下一项媒体', 'chevron-right', t);
    previous.dataset.reviewMedia = 'previous'; next.dataset.reviewMedia = 'next';
    previous.disabled = temporaryGroup.index === 0; next.disabled = temporaryGroup.index === temporaryGroup.items.length - 1;
    previous.addEventListener('click', () => { void switchTemporary(temporaryGroup.index - 1); });
    next.addEventListener('click', () => { void switchTemporary(temporaryGroup.index + 1); });
    const position = document.createElement('span'); position.className = 'detail-media-position'; position.textContent = `${temporaryGroup.index + 1}/${temporaryGroup.items.length}`; position.title = temporary.name;
    nav.append(previous, position, next); temporaryActions.prepend(nav);
  }
  document.querySelector('#temporary-review-close').addEventListener('click', () => { void closeTemporary(); });
  temporaryDialog.addEventListener('cancel', event => { event.preventDefault(); void closeTemporary(); });
  temporaryDialog.addEventListener('close', () => {
    temporaryFeedback?.dispose();
    temporaryMedia.querySelector('video')?.pause();
    const oldMedia = temporaryMedia.querySelector('video,img'); if (oldMedia) URL.revokeObjectURL(oldMedia.src);
    for (const image of temporaryDialog.querySelectorAll('.temporary-review-frames img')) URL.revokeObjectURL(image.src);
    temporaryMedia.replaceChildren(); temporaryDialog.querySelector('.temporary-review-frames')?.remove(); temporary = null; temporaryGroup = null; temporaryBlob = null; temporaryDigest = null; temporaryFeedback = null; document.querySelector('#temporary-review-notes').replaceChildren(); loop = null; session.observe();
  });
  return { observe: scheduleObserve };
}
