import { downloadPageCaptureVideo } from './page-capture-video.js';

export function platformVideoWorkUrl(media, candidate) {
  for (const value of [media.originalWorkUrl, candidate.canonicalUrl, media.url]) {
    try {
      const url = new URL(value);
      if (/(^|\.)(douyin\.com|youtube\.com|youtu\.be|bilibili\.com)$/u.test(url.hostname)) return url.href;
    } catch { /* Not a platform work URL. */ }
  }
  return '';
}

// The sidebar, internal assistant and MCP all consume this same original-file
// contract. A page/player/manifest is never a successful local download.
export async function resolveCapturedVideoOriginal(media, candidate, {
  download = downloadPageCaptureVideo, downloadNative, downloadSession, signal, onProgress
} = {}) {
  const workUrl = platformVideoWorkUrl(media, candidate);
  let failure;
  if (!media.videoStreams) {
    const pixels = Number(media.width) * Number(media.height);
    const variants = (media.variants || []).filter(variant => !pixels || Number(variant.width) * Number(variant.height) >= pixels);
    const urls = [...new Set([media.url, ...variants.map(variant => variant.url)].filter(Boolean))];
    for (const url of urls) {
      signal?.throwIfAborted();
      try {
        const blob = await download(url, { signal, onProgress, mimeType: media.mimeType,
          declaredVideo: ['site-original', 'video-element'].includes(media.sourceKind) });
        if (blob) return blob;
      } catch (error) {
        signal?.throwIfAborted(); failure = error;
        if (downloadSession) {
          try { return await downloadSession(url); }
          catch (error) { signal?.throwIfAborted(); failure = new Error(`${failure.message}；${error.message}`); }
        }
      }
    }
  }
  if (workUrl && downloadNative) {
    let streams = media.videoStreams;
    // Pending captures can predate the CDN mirror adapter. Keep the work and
    // let the extractor refresh a PCDN hint the installed host cannot accept.
    if (streams && /(^|\.)bilibili\.com$/u.test(new URL(workUrl).hostname)
      && [streams.videoUrl, streams.audioUrl].filter(Boolean).some(value => {
        try { const url = new URL(value); return url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(bilivideo\.com|bilivideo\.cn)$/u.test(url.hostname); }
        catch { return true; }
      })) streams = undefined;
    const options = { signal, onProgress, minWidth: media.width, minHeight: media.height };
    try { return await downloadNative(workUrl, { ...options, streams }); }
    catch (error) {
      signal?.throwIfAborted();
      // Signed page URLs can be valid in Chrome but denied from the native
      // process. Refresh the same work once; setup, cancellation and disk errors
      // must keep their original outcome instead of starting another download.
      if (!streams || error.name === 'AbortError' || error.code === 'video_component_required'
        || !/(?:HTTP|Server returned)\s*(?:401|403|404|410|429|5\d\d)\b|timed?\s*out|Connection (?:refused|reset)/iu.test(error.message)) throw error;
      try { return await downloadNative(workUrl, options); }
      catch (refreshError) {
        signal?.throwIfAborted();
        if (refreshError.name === 'AbortError' || refreshError.code === 'video_component_required') throw refreshError;
        throw new Error(`页面视频地址不可用；从作品重新解析失败：${refreshError.message}`);
      }
    }
  }
  throw failure || new Error('尚未取得完整视频文件，请重新读取来源页面后重试');
}
