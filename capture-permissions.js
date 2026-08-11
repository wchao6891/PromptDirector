export const CONTINUOUS_CAPTURE_ORIGINS = Object.freeze(["<all_urls>"]);
export const CLIPBOARD_READ_PERMISSIONS = Object.freeze(["clipboardRead"]);

export function pagePermissionPattern(pageUrl) {
  const url = new URL(String(pageUrl ?? ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("请先切换到需要采集的普通网页");
  }
  return `${url.origin}/*`;
}

export async function ensureContinuousCapturePermission(permissionsApi) {
  return Boolean(await permissionsApi.request({
    origins: [...CONTINUOUS_CAPTURE_ORIGINS]
  }));
}

export async function ensurePagePermission(pageUrl, permissionsApi) {
  const permission = pagePermissionPattern(pageUrl);
  const request = { origins: [permission] };
  if (await permissionsApi.contains(request)) return true;
  return Boolean(await permissionsApi.request(request));
}

export async function hasClipboardReadPermission(permissionsApi) {
  return Boolean(await permissionsApi.contains({
    permissions: [...CLIPBOARD_READ_PERMISSIONS]
  }));
}

export async function ensureClipboardReadPermission(permissionsApi) {
  if (await hasClipboardReadPermission(permissionsApi)) return true;
  return Boolean(await permissionsApi.request({
    permissions: [...CLIPBOARD_READ_PERMISSIONS]
  }));
}

export async function readClipboardTextAfterFocus({
  clipboardApi = navigator.clipboard,
  documentObject = document,
  windowObject = window
} = {}) {
  if (!documentObject.hasFocus()) {
    await new Promise((resolve) => windowObject.addEventListener("focus", resolve, { once: true }));
  }
  await settleFocusedDocument(windowObject);
  try {
    return await clipboardApi.readText();
  } catch {
    await settleFocusedDocument(windowObject);
    return clipboardApi.readText();
  }
}

async function settleFocusedDocument(windowObject) {
  await new Promise((resolve) => windowObject.requestAnimationFrame(() => windowObject.requestAnimationFrame(resolve)));
}
