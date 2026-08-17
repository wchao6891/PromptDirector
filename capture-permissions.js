export const CONTINUOUS_CAPTURE_ORIGINS = Object.freeze(["<all_urls>"]);
export const CLIPBOARD_READ_PERMISSIONS = Object.freeze(["clipboardRead"]);
export const RESTRICTED_PAGE_MESSAGE = "当前页不可采集：Chrome 新标签页、设置页和扩展页不允许读取；普通网站请先点工具栏图标。";
const CLIPBOARD_IMAGE_MIME_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"]);

export function pagePermissionPattern(pageUrl) {
  const url = new URL(String(pageUrl ?? ""));
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(RESTRICTED_PAGE_MESSAGE);
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

export async function resolveActivePage(tabsApi, scriptingApi) {
  const [tab] = await tabsApi.query({ active: true, currentWindow: true });
  if (!tab || tab.url || !Number.isInteger(tab.id) || typeof scriptingApi?.executeScript !== "function") return tab || null;
  try {
    const results = await scriptingApi.executeScript({
      target: { tabId: tab.id },
      func: () => globalThis.location.href
    });
    const pageUrl = results.find((result) => result?.frameId === 0)?.result ?? results[0]?.result;
    return typeof pageUrl === "string" && pageUrl ? { ...tab, url: pageUrl } : tab;
  } catch {
    return tab;
  }
}

export async function inspectPagePermission(pageUrl, permissionsApi) {
  let pattern;
  try {
    pattern = pagePermissionPattern(pageUrl);
  } catch {
    return { status: "restricted", origin: "", pattern: "" };
  }
  return {
    status: await permissionsApi.contains({ origins: [pattern] }) ? "granted" : "missing",
    origin: new URL(pageUrl).origin,
    pattern
  };
}

export function pageCapturePermissionFailureMessage(error) {
  const message = String(error?.message || error || "").trim();
  if (/Cannot access contents|Missing host permission|not allowed to access|permission.{0,20}denied|extensions gallery/i.test(message)) {
    return "Chrome 已阻止 PromptDirector 访问当前网站。请在当前网页重新点击浏览器工具栏里的 PromptDirector 图标；如果仍被阻止，再到扩展详情的“网站访问权限”中允许当前网站。待保存内容没有改变。";
  }
  if (/Could not establish connection|Receiving end does not exist|No frame with id|frame.{0,20}removed|Cannot find context/i.test(message)) {
    return "已获得网站权限，但采集脚本没有成功启动。请刷新当前网页后重试；待保存内容没有改变。";
  }
  return message || "网页采集失败，待保存内容没有改变。";
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
