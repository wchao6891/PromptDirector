export async function createTextCandidate({ selection, clipboard, page } = {}) {
  const selectedText = normalizeText(selection);
  const clipboardText = normalizeText(clipboard);
  const kind = selectedText ? "selection" : clipboardText ? "clipboard" : "";
  if (!kind) return null;
  const text = kind === "selection" ? selectedText : clipboardText;
  return {
    kind,
    text,
    sourceKind: kind,
    sourceUrl: kind === "selection" ? safeHttpUrl(page?.url) : "",
    sourceTitle: kind === "selection" ? clean(page?.title) : "剪贴板",
    textFingerprint: await sha256(text)
  };
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
