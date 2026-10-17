import { t, translateUiMessage } from './i18n.js';
import { formatBytes } from './resource-limits.js';
import { setTaskFeedbackState } from './task-feedback.js';

// One shared, inline next action in the collector and settings. Installation
// never changes the online-only preference or clears the pending capture.
export function createVideoComponentView(container, { send = message => chrome.runtime.sendMessage(message),
  permission = () => chrome.permissions.request({ permissions: ['nativeMessaging', 'downloads.open'] }),
  open = id => chrome.downloads.open(id), onReady = () => {},
  showDownloads = () => chrome.tabs.create({ url: 'chrome://downloads/' }),
  message = document.createElement('span'), button = document.createElement('button'), primary = false } = {}) {
  let state = {}, busy = false;
  button.type = 'button'; button.className = primary ? 'primary' : 'button-secondary';
  container.classList.add('video-component-setup'); container.setAttribute('role', 'status');
  if (!container.contains(button)) container.replaceChildren(message, button);
  function render(value = state) {
    state = value;
    const phase = state.phase;
    setTaskFeedbackState(message, { error: ['failed', 'permission'].includes(phase) });
    container.setAttribute('aria-busy', String(phase === 'downloading'));
    message.textContent = translateUiMessage(state.message || ({ update: '视频组件需要更新', downloading: '正在下载安装包…', review: '请在浏览器下载列表中查看安装包状态', installing: '打开安装包完成安装，随后自动继续',
      ready: '视频组件已就绪', paused: '安装尚未完成，完成后点继续即可' }[phase] || '此视频需要安装视频组件'));
    if (phase === 'downloading' && state.bytesReceived > 0) message.textContent += ` · ${formatBytes(state.bytesReceived)}${state.totalBytes > 0 ? ` / ${formatBytes(state.totalBytes)}` : ''}`;
    const action = { permission: '开启权限', update: '更新视频组件', review: '查看下载', paused: '继续',
      failed: state.downloadId ? '重新下载' : '重试' }[phase] || (phase === 'installing' && state.downloadId ? '打开安装包' : '安装视频组件');
    button.textContent = t(action);
    button.hidden = ['ready', 'downloading'].includes(phase); button.disabled = busy;
  }
  button.addEventListener('click', async () => {
    busy = true; render();
    try {
      if (state.phase === 'review') { await showDownloads(); return; }
      if (state.phase === 'installing' && state.downloadId) { await open(state.downloadId); return; }
      if (!await permission()) { render({ ...state, phase: 'permission', message: '未开启组件连接权限，待保存内容已保留' }); return; }
      const result = await send({ type: state.phase === 'paused' ? 'CONTINUE_VIDEO_COMPONENT_SETUP' : 'START_VIDEO_COMPONENT_SETUP', restart: state.phase === 'failed' });
      if (!result?.ok) throw new Error(result?.message || '视频组件安装未开始');
      render(result.state);
      if (result.state.phase === 'ready') onReady();
    } catch (error) {
      if (state.phase === 'installing') console.warn('Video installer could not be opened', error);
      render({ ...state, phase: 'failed', message: state.phase === 'installing' ? '安装包无法打开，请重新下载' : error.message });
    }
    finally { busy = false; render(); }
  });
  return { render, async refresh() { const result = await send({ type: 'GET_VIDEO_COMPONENT_SETUP' }); if (result?.ok) render(result.state); },
    async changed(value) { render(value); if (value.phase === 'ready') await onReady(); } };
}
