// Native Messaging permits 1 MiB from the host to Chrome. Chunk size is a
// transport boundary, not an asset/file limit; base64 and envelope fit below it.
export const AGENT_PROTOCOL_VERSION = 1;
export const AGENT_CHUNK_BYTES = 192 * 1024;
export const AGENT_HOST = "com.promptdirector.connector";
export const AGENT_SETTINGS_KEY = "agentConnection";
export const AGENT_JOB_PREFIX = "agentTask:";
export const AGENT_UPLOAD_PREFIX = "agentUpload:";

export function agentError(code, message) {
  return Object.assign(new Error(message), { code });
}

export function requireAgentId(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) {
    throw agentError("invalid_input", "请求编号只允许字母、数字、下划线和连字符，长度为 1–128。");
  }
  return value;
}

export function requireWebUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw agentError("invalid_url", "请提供完整 HTTP 或 HTTPS 网页地址。"); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
    throw agentError("invalid_url", "网页地址仅支持 HTTP/HTTPS，且不能包含账号密码。");
  }
  return url.href;
}

export function requireInteger(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw agentError("invalid_input", "读取位置或长度无效。");
  return value;
}

export function bytesToBase64(bytes) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function base64ToBytes(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw agentError("invalid_input", "文件分块编码无效。");
  }
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if (bytes.length > AGENT_CHUNK_BYTES) throw agentError("chunk_too_large", "请按连接器声明的分块长度传输，文件本身不需要缩小。");
  return bytes;
}
