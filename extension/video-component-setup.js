import { videoComponentDownload } from './video-component-config.js';
import { operationBudget } from './resource-policy.js';

export const VIDEO_SETUP_KEY = 'videoComponentSetup';
// Checks exist only during an explicitly requested installation, and stop on
// success, failure or the existing operation budget. No startup polling.
export function createVideoComponentSetup({ storage, inspect, platform, homepage, downloads, resume,
  fetchImpl = fetch, notify = () => {}, now = Date.now, schedule = setTimeout, cancel = clearTimeout }) {
  let timer, starting, checking = false;
  const publish = async state => { await storage.set({ [VIDEO_SETUP_KEY]: state }); await notify(state); return state; };
  const get = async () => (await storage.get(VIDEO_SETUP_KEY))[VIDEO_SETUP_KEY] || { phase: 'idle' };
  const stop = () => { if (timer) cancel(timer); timer = null; };
  const arm = () => { stop(); timer = schedule(() => void check(), 2000); };
  async function check() {
    if (checking) return get();
    checking = true;
    try {
      const state = await get();
      if (!['downloading', 'review', 'installing'].includes(state.phase)) return state;
      try {
        const result = await inspect();
        if (result.available) {
          stop(); await publish({ phase: 'ready', versions: result.versions });
          await resume(); return get();
        }
      } catch { /* A host is unavailable until the system installer finishes. */ }
      if (now() - state.startedAt >= operationBudget().maxDurationMs) {
        stop(); return publish({ ...state, phase: 'paused', message: '安装尚未完成，完成后点继续即可' });
      }
      if (['downloading', 'review'].includes(state.phase)) {
        const [download] = await downloads.search({ id: state.downloadId });
        if (!download || download.state === 'interrupted') {
          stop(); return publish({ ...state, phase: 'failed', message: '安装包下载中断，请重试' });
        }
        if (download.state === 'complete') await publish({ ...state, phase: 'installing' });
        else if (download.danger && !['safe', 'accepted', 'allowlistedByPolicy', 'deepScannedSafe', 'asyncScanning', 'asyncLocalPasswordScanning'].includes(download.danger)) {
          if (state.phase !== 'review') await publish({ ...state, phase: 'review' });
        } else if (download.bytesReceived !== state.bytesReceived || state.phase === 'review') await publish({ ...state, phase: 'downloading', bytesReceived: download.bytesReceived, totalBytes: download.totalBytes });
      }
      arm(); return get();
    } catch (error) {
      stop(); return publish({ ...(await get()), phase: 'failed', message: error.message });
    } finally { checking = false; }
  }
  return {
    get, check,
    async start({ restart = false } = {}) {
      if (starting) return starting;
      starting = (async () => {
        stop();
        try {
          const current = await get();
          try {
            if ((await inspect()).available) { await publish({ phase: 'ready' }); await resume(); return get(); }
          } catch { /* Offer the complete installer. */ }
          if (!restart && ['downloading', 'review', 'installing'].includes(current.phase)) { arm(); return current; }
          const url = videoComponentDownload((await platform()).os, homepage);
          const response = await fetchImpl(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
          if (!response.ok) throw new Error(response.status === 404 ? '视频组件安装包尚未发布，待保存内容已保留' : '暂时无法下载安装包，请稍后重试');
          const downloadId = await downloads.download({ url, saveAs: false });
          const state = await publish({ phase: 'downloading', downloadId, startedAt: now() });
          arm(); return state;
        } catch (error) { return publish({ phase: 'failed', message: ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name) ? '暂时无法下载安装包，请稍后重试' : error.message }); }
      })();
      try { return await starting; } finally { starting = null; }
    },
    async continue() {
      const state = await get();
      await publish({ ...state, phase: state.downloadId ? 'installing' : 'paused', startedAt: now() });
      if (!state.downloadId) {
        if ((await inspect()).available) { await publish({ phase: 'ready' }); await resume(); }
        return get();
      }
      return check();
    },
    stop
  };
}
