import { formatBytes } from './resource-limits.js';
import { startPhase } from './perf-trace.js';

// Match the shared progress transition; never send one extension event per chunk.
const PROGRESS_INTERVAL_MS = 160;
let sequence = 0;

export function createCaptureSaveProgress({ requestId, send, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  let current = {}, pending = null, timer = null, lastSent = -Infinity, closed = false, finishStage = null;
  const timeStage = (phase) => {
    finishStage?.();
    // Downloads and page transfers wait on the source site; the other stages are local work.
    finishStage = phase ? startPhase("capture", ["download", "transfer", "page"].includes(phase) ? `wait:${phase}` : phase) : null;
  };
  const emit = () => {
    if (timer !== null) cancel(timer);
    timer = null;
    if (!requestId || !pending || closed) return;
    const progress = pending; pending = null; lastSent = now();
    // A closed UI must not make a successful save fail.
    try { Promise.resolve(send({ type: 'CAPTURE_SAVE_PROGRESS', requestId, sequence: ++sequence, progress })).catch(() => undefined); }
    catch { /* Progress delivery is independent of the authoritative save receipt. */ }
  };
  return {
    stage(phase, context = {}) {
      timeStage(phase);
      current = { phase, ...context }; pending = current; emit();
    },
    update(value) {
      if (closed || !requestId) return;
      pending = { ...current, ...value };
      const remaining = PROGRESS_INTERVAL_MS - (now() - lastSent);
      if (remaining <= 0) emit();
      else if (timer === null) timer = schedule(emit, remaining);
    },
    close() { timeStage(null); closed = true; pending = null; if (timer !== null) cancel(timer); timer = null; }
  };
}

export function captureSaveProgressPresentation(progress = {}, t = value => value) {
  const action = {
    queued: '等待保存…', preparing: '准备保存…', download: '下载',
    page: '读取页面媒体…', transfer: '传输', verify: '校验媒体…',
    poster: '准备封面…', writing: '正在入库…', confirm: '等待提示词确认…'
  }[progress.phase] || '正在保存案例…';
  let message = t(action);
  if (['download', 'transfer'].includes(progress.phase)) {
    const media = t({ video: '视频', image: '图片', document: '资料', attachment: '附件', poster: '封面' }[progress.kind] || '媒体');
    message = t(progress.phase === 'download' ? '下载{media}' : '传输{media}').replaceAll('{media}', media);
  }
  if (progress.index > 0 && progress.count > 0) message += ` ${progress.index}/${progress.count}`;
  const completed = progress.receivedBytes;
  const total = progress.totalBytes;
  const known = ['download', 'transfer'].includes(progress.phase) && Number.isFinite(total) && total > 0
    && Number.isFinite(completed) && completed >= 0 && completed <= total;
  if (['download', 'transfer'].includes(progress.phase) && completed > 0) {
    message += known ? ` · ${formatBytes(completed)} / ${formatBytes(total)} · ${Math.floor(completed / total * 100)}%`
      : ` · ${formatBytes(completed)}`;
  }
  return { message, completed: known ? completed : undefined, total: known ? total : undefined };
}

export function createCaptureProgressGate() {
  let requestId = '', sequence = 0;
  return {
    begin(id) { requestId = id; sequence = 0; },
    end() { requestId = ''; },
    accept(message) {
      if (!requestId || message?.type !== 'CAPTURE_SAVE_PROGRESS' || message.requestId !== requestId
        || !Number.isSafeInteger(message.sequence) || message.sequence <= sequence) return false;
      sequence = message.sequence;
      return true;
    }
  };
}
