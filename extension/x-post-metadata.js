import { operationBudget } from './resource-policy.js';
import { PAGE_CAPTURE_LIMITS } from './resource-limits.js';

// Read the site's delivered literals, never execute its serialized script.
// Public X pages currently serialize media_entities with $R[n]= references.
export function xVideoSourcesFromHtml(html, postUrl) {
  let expected;
  try { expected = new URL(postUrl); } catch { return null; }
  const postId = /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)/u.exec(expected.pathname)?.[1];
  if (!postId || expected.protocol !== 'https:' || expected.username || expected.password
    || !['x.com', 'twitter.com', 'www.x.com', 'www.twitter.com'].includes(expected.hostname)) return null;
  const keys = new Set(['expanded_url', 'id_str', 'media_url_https', 'video_info', 'variants', 'url', 'content_type', 'bitrate']);
  const media = new Map();
  for (const script of String(html).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)) {
    const tokens = script[1].match(/"(?:\\.|[^"\\])*"|\$R\[\d+\]=?|[a-zA-Z_$][\w$]*|\d+(?:\.\d+)?|[{}\[\]:,]/gu) || [];
    const stack = [];
    const assign = value => {
      const parent = stack.at(-1);
      if (!parent) return;
      if (parent.array) parent.value.push(value);
      else if (keys.has(parent.key)) parent.value[parent.key] = value;
      parent.key = '';
    };
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith('$R[')) continue;
      if (token === '{' || token === '[') {
        const value = token === '[' ? [] : Object.create(null);
        assign(value);
        stack.push({ value, array: token === '[', key: '' });
      } else if (token === '}' || token === ']') {
        const node = stack.pop()?.value;
        if (!node?.expanded_url || !Array.isArray(node.video_info?.variants)) continue;
        let url;
        try { url = new URL(node.expanded_url); } catch { continue; }
        if (url.origin !== expected.origin || !new RegExp(`^/(?:[^/]+/status|i/web/status)/${postId}/video/\\d+$`, 'u').test(url.pathname)) continue;
        const variants = node.video_info.variants.flatMap(value => {
          try {
            const url = new URL(value.url);
            return url.protocol === 'https:' && url.hostname === 'video.twimg.com' && !url.username && !url.password
              && ['video/mp4', 'application/x-mpegURL'].includes(value.content_type)
              && !/\/(?:vid|aud)\/[^/]+\/\d+\/\d+\//u.test(url.pathname)
              ? [{ url: url.href, mimeType: value.content_type, bitrate: Number(value.bitrate) || 0 }] : [];
          } catch { return []; }
        }).sort((a, b) => Number(b.mimeType === 'video/mp4') - Number(a.mimeType === 'video/mp4') || b.bitrate - a.bitrate);
        if (variants.length) media.set(node.id_str || node.expanded_url, { id: node.id_str || '', posterUrl: node.media_url_https || '', variants });
      } else if (tokens[i + 1] === ':' && stack.length) {
        stack.at(-1).key = token.startsWith('"') ? JSON.parse(token) : token;
        i++;
      } else if (token.startsWith('"') || /^\d/u.test(token)) {
        try { assign(JSON.parse(token)); } catch { /* Unrelated JavaScript literal. */ }
      }
    }
  }
  return { postId, media: [...media.values()] };
}

export async function readXPostHtml(url, { signal } = {}) {
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(PAGE_CAPTURE_LIMITS.navigationTimeoutMs)])
      : AbortSignal.timeout(PAGE_CAPTURE_LIMITS.navigationTimeoutMs) });
  if (!response.ok) throw new Error(`帖子原件信息读取失败（HTTP ${response.status}）`);
  const budget = operationBudget().maxTextBytes;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0, html = '';
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return html + decoder.decode();
      bytes += part.value.byteLength;
      if (bytes > budget) throw new Error('帖子原件信息超过本次文字处理预算，当前草稿已保留');
      html += decoder.decode(part.value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
