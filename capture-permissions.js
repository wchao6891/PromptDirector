export const CONTINUOUS_CAPTURE_ORIGINS = Object.freeze(["<all_urls>"]);
export const CLIPBOARD_READ_PERMISSIONS = Object.freeze(["clipboardRead"]);
const CLIPBOARD_IMAGE_MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

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

export async function readClipboardContentAfterFocus({
  clipboardApi = navigator.clipboard,
  documentObject = document,
  windowObject = window
} = {}) {
  if (!documentObject.hasFocus()) {
    await new Promise((resolve) => windowObject.addEventListener("focus", resolve, { once: true }));
  }
  await settleFocusedDocument(windowObject);
  try {
    return await readClipboardContent(clipboardApi);
  } catch {
    await settleFocusedDocument(windowObject);
    return readClipboardContent(clipboardApi);
  }
}

async function readClipboardContent(clipboardApi) {
  if (typeof clipboardApi?.read !== "function") {
    return {
      text: typeof clipboardApi?.readText === "function" ? await clipboardApi.readText() : "",
      image: null
    };
  }
  const items = await clipboardApi.read();
  let text = "";
  let image = null;
  for (const item of Array.isArray(items) ? items : []) {
    const types = (Array.isArray(item?.types) ? item.types : []).map((type) => String(type).toLocaleLowerCase("en-US"));
    if (!image) {
      const imageType = CLIPBOARD_IMAGE_MIME_TYPES.find((type) => types.includes(type));
      if (imageType) {
        const value = await item.getType(imageType);
        if (value instanceof Blob && value.size && value.type.toLocaleLowerCase("en-US") === imageType) image = value;
      }
    }
    if (!text && types.includes("text/plain")) {
      const value = await item.getType("text/plain");
      if (value instanceof Blob) text = await value.text();
    }
  }
  if (!text && !image && typeof clipboardApi.readText === "function") text = await clipboardApi.readText();
  return { text, image };
}

async function settleFocusedDocument(windowObject) {
  await new Promise((resolve) => windowObject.requestAnimationFrame(() => windowObject.requestAnimationFrame(resolve)));
}
