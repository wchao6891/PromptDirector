import { createMediaStage } from './staged-media.js';
import { saveMediaBlob } from './media-store.js';

// Local files use the same original-byte preparation and receipt path as Agents.
export async function prepareReviewFile(file, chromeApi = chrome) {
  const id = `review-${crypto.randomUUID()}`;
  const stage = createMediaStage(chromeApi);
  try {
    await stage.register([`agent-file:${id}`]);
    await saveMediaBlob(`agent-file:${id}`, file);
    const response = await chromeApi.runtime.sendMessage({ type: 'REVIEW_LOCAL_FILE', input: { id, name: file.name || 'frame.webp' } });
    if (!response || response.ok === false) throw new Error(response?.message || '文件准备失败');
    return response;
  } finally {
    await stage.release();
  }
}

export async function captureReviewFrame(player) {
  if (player.readyState < 2 || !player.videoWidth || !player.videoHeight) throw new Error('请先定位到可见画面');
  const canvas = document.createElement('canvas'); canvas.width = player.videoWidth; canvas.height = player.videoHeight;
  canvas.getContext('2d').drawImage(player, 0, 0);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp'));
  if (!blob) throw new Error('无法保存当前画面');
  return blob;
}
