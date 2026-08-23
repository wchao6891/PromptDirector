import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY,
  CAPTURE_PERMISSION_ONBOARDING_VERSION,
  CLIPBOARD_READ_PERMISSIONS,
  CONTINUOUS_CAPTURE_ORIGINS,
  ensureClipboardReadPermission,
  hasClipboardReadPermission,
  readClipboardContentAfterFocus,
  ensureContinuousCapturePermission,
  ensurePagePermission,
  inspectCapturePermissionBundle,
  inspectPagePermission,
  normalizeCapturePermissionOnboarding,
  pageCapturePermissionFailureMessage,
  pagePermissionPattern,
  requestCapturePermissionBundle,
  RESTRICTED_PAGE_MESSAGE,
  resolveActivePage
} from "../capture-permissions.js";
import { runCaptureTransaction } from "../capture-workspace.js";

const projectRoot = new URL("../", import.meta.url);

test("explicit clipboard extraction uses one optional permission with a recoverable grant", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", projectRoot), "utf8"));
  const calls = [];
  const permissions = {
    contains: async (request) => {
      calls.push(["contains", request]);
      return false;
    },
    request: async (request) => {
      calls.push(["request", request]);
      return true;
    }
  };

  assert.ok(manifest.optional_permissions.includes("clipboardRead"));
  assert.ok(manifest.optional_permissions.includes("declarativeNetRequestWithHostAccess"));
  assert.equal(manifest.optional_permissions.length, 2);
  assert.equal(await hasClipboardReadPermission(permissions), false);
  assert.equal(await ensureClipboardReadPermission(permissions), true);
  assert.deepEqual(calls, [
    ["contains", { permissions: [...CLIPBOARD_READ_PERMISSIONS] }],
    ["contains", { permissions: [...CLIPBOARD_READ_PERMISSIONS] }],
    ["request", { permissions: [...CLIPBOARD_READ_PERMISSIONS] }]
  ]);
});

test("clipboard reading returns copied text and the first supported image after focus recovery", async () => {
  const calls = [];
  let reads = 0;
  const copiedImage = new Blob(["image-bytes"], { type: "image/png" });
  const content = await readClipboardContentAfterFocus({
    clipboardApi: {
      read: async () => {
        reads += 1;
        calls.push(`read-${reads}`);
        if (reads === 1) throw new DOMException("Document is not focused", "NotAllowedError");
        return [{
          types: ["text/plain", "image/png"],
          getType: async (type) => type === "image/png"
            ? copiedImage
            : new Blob(["已复制的提示词"], { type: "text/plain" })
        }];
      }
    },
    documentObject: { hasFocus: () => true },
    windowObject: {
      requestAnimationFrame(callback) {
        calls.push("frame");
        callback();
      }
    }
  });

  assert.equal(content.text, "已复制的提示词");
  assert.equal(content.image, copiedImage);
  assert.deepEqual(calls, ["frame", "frame", "read-1", "frame", "frame", "read-2"]);
});

test("cross-page capture uses one explicit all-sites grant instead of origin-by-origin access", async () => {
  const manifest = JSON.parse(await readFile(new URL("manifest.json", projectRoot), "utf8"));
  const calls = [];
  const chromeApi = {
    permissions: {
      request: async (request) => {
        calls.push(["permission", request]);
        return true;
      }
    },
    tabs: {
      query: async () => {
        calls.push(["tab"]);
        return [{ id: 17, url: "https://example.com/work" }];
      }
    },
    runtime: {
      sendMessage: async (message) => {
        calls.push(["message", message]);
        return { ok: true, message: "截图已加入草稿", draft: { id: "draft" } };
      }
    }
  };

  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  const result = await runCaptureTransaction({
    type: "CAPTURE_ACTIVE_TAB_TO_DRAFT",
    chromeApi
  });

  assert.equal(result.message, "截图已加入草稿");
  assert.deepEqual(calls, [
    ["permission", { origins: [...CONTINUOUS_CAPTURE_ORIGINS] }],
    ["tab"],
    ["message", { type: "CAPTURE_ACTIVE_TAB_TO_DRAFT", tabId: 17 }]
  ]);
});

test("denied screenshot permission stops before tab lookup and leaves the draft untouched", async () => {
  const calls = [];
  const chromeApi = {
    permissions: {
      request: async () => {
        calls.push("permission");
        return false;
      }
    },
    tabs: {
      query: async () => {
        calls.push("tab");
        return [];
      }
    },
    runtime: {
      sendMessage: async () => {
        calls.push("message");
        return { ok: true };
      }
    }
  };

  await assert.rejects(
    () => runCaptureTransaction({ type: "CAPTURE_VISIBLE_VISUALS_TO_DRAFT", chromeApi }),
    { message: "没有获得跨网页截图权限，当前草稿没有改变" }
  );
  assert.deepEqual(calls, ["permission"]);
});

test("continuous capture requests the declared all-sites permission from the user gesture", async () => {
  const requests = [];
  const granted = await ensureContinuousCapturePermission({
    contains: async () => false,
    request: async (request) => {
      requests.push(request);
      return true;
    }
  });

  assert.equal(granted, true);
  assert.deepEqual(requests, [{ origins: [...CONTINUOUS_CAPTURE_ORIGINS] }]);
});

test("first-use capture onboarding requests web capture and the default clipboard choice together", async () => {
  const requests = [];
  const permissions = {
    contains: async () => false,
    request: async (request) => {
      requests.push(request);
      return true;
    }
  };

  assert.equal(CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY, "capturePermissionOnboarding");
  assert.deepEqual(normalizeCapturePermissionOnboarding(null), {
    version: CAPTURE_PERMISSION_ONBOARDING_VERSION,
    acknowledgedAt: "",
    clipboardIncluded: true
  });
  const current = await inspectCapturePermissionBundle(permissions);
  assert.deepEqual(current, { webCaptureGranted: false, clipboardGranted: false });
  assert.deepEqual(await requestCapturePermissionBundle(permissions, { current }), {
    granted: true,
    requested: {
      origins: [...CONTINUOUS_CAPTURE_ORIGINS],
      permissions: [...CLIPBOARD_READ_PERMISSIONS]
    }
  });
  assert.deepEqual(requests, [{
    origins: [...CONTINUOUS_CAPTURE_ORIGINS],
    permissions: [...CLIPBOARD_READ_PERMISSIONS]
  }]);
});

test("first-use capture onboarding can omit clipboard without adding another request", async () => {
  const requests = [];
  const result = await requestCapturePermissionBundle({
    request: async (request) => {
      requests.push(request);
      return true;
    }
  }, {
    includeClipboard: false,
    current: { webCaptureGranted: false, clipboardGranted: false }
  });

  assert.deepEqual(result, {
    granted: true,
    requested: { origins: [...CONTINUOUS_CAPTURE_ORIGINS] }
  });
  assert.deepEqual(requests, [{ origins: [...CONTINUOUS_CAPTURE_ORIGINS] }]);
});

test("collector presents one compact first-use authorization and resumes only the pending capture action", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("collector.js", projectRoot), "utf8"),
    readFile(new URL("collector.html", projectRoot), "utf8")
  ]);
  assert.match(html, /id="capture-permission-onboarding"/);
  assert.match(html, /一次授权，之后直接采集/);
  assert.match(html, /统一开启网页读取与截图能力/);
  assert.match(html, /id="capture-permission-clipboard"[^>]*checked/);
  assert.match(html, /仅在你主动点击“提取文字\/图片”且网页没有高亮内容时读取/);
  assert.match(html, /不会自动保存案例/);
  assert.match(source, /pendingCaptureAction = \{ action, permissionStatus \}/);
  assert.match(source, /await pending\.action\(\{ clipboardPreferenceJustDeclined: !includeClipboard \}\)/);
  const cancelFlow = source.slice(source.indexOf("function cancelCapturePermissionOnboarding"), source.indexOf("async function confirmCapturePermissionOnboarding"));
  assert.doesNotMatch(cancelFlow, /storage\.local\.set|pending\.action/);
  const autoFlow = source.slice(source.indexOf("async function tryAutoSelection"), source.indexOf("async function extractClipboardOrSelection"));
  assert.doesNotMatch(autoFlow, /readClipboardContentAfterFocus|ensureClipboardReadPermission/);
});

test("declining clipboard is honored for the original action and later enablement stays explicit", async () => {
  const [source, html] = await Promise.all([
    readFile(new URL("collector.js", projectRoot), "utf8"),
    readFile(new URL("collector.html", projectRoot), "utf8")
  ]);
  const fallback = source.slice(
    source.indexOf("async function extractClipboardOrSelection"),
    source.indexOf("function cancelClipboardPermissionEnable")
  );
  assert.match(fallback, /clipboardPreferenceJustDeclined/);
  assert.match(fallback, /已按你的选择保持剪贴板关闭，未读取任何内容/);
  assert.match(fallback, /pendingClipboardButton = button/);
  assert.match(fallback, /clipboardPermissionDialog\.showModal\(\)/);
  const explicitEnable = source.slice(
    source.indexOf("async function confirmClipboardPermissionEnable"),
    source.indexOf("async function extractClipboardContent")
  );
  assert.match(explicitEnable, /ensureClipboardReadPermission\(chrome\.permissions\)/);
  assert.match(explicitEnable, /clipboardIncluded: true/);
  assert.match(html, /id="clipboard-permission-confirm"[^>]*>启用并提取/);
  assert.match(html, /打开侧栏、浏览或点击网页不会触发读取/);
});

test("text collection keeps its narrower per-site permission", async () => {
  const calls = [];
  const permissions = {
    contains: async (request) => {
      calls.push(["contains", request]);
      return false;
    },
    request: async (request) => {
      calls.push(["request", request]);
      return true;
    }
  };

  assert.equal(pagePermissionPattern("https://example.com/article"), "https://example.com/*");
  assert.equal(await ensurePagePermission("https://example.com/article", permissions), true);
  assert.deepEqual(calls, [
    ["contains", { origins: ["https://example.com/*"] }],
    ["request", { origins: ["https://example.com/*"] }]
  ]);
  await assert.rejects(() => ensurePagePermission("chrome://extensions", permissions), {
    message: RESTRICTED_PAGE_MESSAGE
  });
});

test("page capture permission preflight distinguishes granted, missing, and restricted pages without prompting", async () => {
  const calls = [];
  const permissions = {
    contains: async (request) => {
      calls.push(request);
      return request.origins[0].startsWith("https://allowed.example");
    }
  };

  assert.deepEqual(await inspectPagePermission("https://allowed.example/work", permissions), {
    status: "granted",
    origin: "https://allowed.example",
    pattern: "https://allowed.example/*"
  });
  assert.deepEqual(await inspectPagePermission("https://jimeng.jianying.com/ai-tool/work-detail/1", permissions), {
    status: "missing",
    origin: "https://jimeng.jianying.com",
    pattern: "https://jimeng.jianying.com/*"
  });
  assert.deepEqual(await inspectPagePermission("chrome://extensions", permissions), {
    status: "restricted",
    origin: "",
    pattern: ""
  });
  assert.equal(calls.length, 2);
});

test("page capture recovers the active URL after the toolbar action grants activeTab", async () => {
  const calls = [];
  const page = await resolveActivePage({
    query: async () => [{ id: 42, url: "", title: "作品详情页" }]
  }, {
    executeScript: async (request) => {
      calls.push(request);
      return [{ frameId: 0, result: "https://visual.example/work/42" }];
    }
  });

  assert.equal(page.url, "https://visual.example/work/42");
  assert.deepEqual(calls.map((request) => request.target), [{ tabId: 42 }]);
});

test("page capture keeps the actionable retry state when activeTab was not granted", async () => {
  const page = await resolveActivePage({
    query: async () => [{ id: 42, url: "", title: "作品详情页" }]
  }, {
    executeScript: async () => { throw new Error("Cannot access contents of url"); }
  });

  assert.equal(page.url, "");
  assert.equal(page.id, 42);
});

test("page capture permission failures distinguish Chrome site access from script startup failures", () => {
  assert.match(
    pageCapturePermissionFailureMessage(new Error("Cannot access contents of url https://example.com/")),
    /网站访问权限/
  );
  assert.match(
    pageCapturePermissionFailureMessage(new Error("Could not establish connection. Receiving end does not exist.")),
    /采集脚本没有成功启动/
  );
  assert.equal(pageCapturePermissionFailureMessage(new Error("页面结构无法识别")), "页面结构无法识别");
});

test("text capture resolves the active page before requesting only that page permission", async () => {
  const calls = [];
  const chromeApi = {
    permissions: {
      contains: async (request) => {
        calls.push(["contains", request]);
        return false;
      },
      request: async (request) => {
        calls.push(["request", request]);
        return true;
      }
    },
    tabs: {
      query: async () => {
        calls.push(["tab"]);
        return [{ id: 23, url: "https://example.com/article" }];
      }
    },
    runtime: {
      sendMessage: async (message) => {
        calls.push(["message", message]);
        return { ok: true, message: "高亮文字已加入当前草稿", draft: { id: "draft" } };
      }
    }
  };

  await runCaptureTransaction({
    type: "ADD_ACTIVE_SELECTION_TO_DRAFT",
    chromeApi
  });

  assert.deepEqual(calls, [
    ["tab"],
    ["contains", { origins: ["https://example.com/*"] }],
    ["request", { origins: ["https://example.com/*"] }],
    ["message", { type: "ADD_ACTIVE_SELECTION_TO_DRAFT", tabId: 23 }]
  ]);
});

test("page capture requests only the current site and continues in the same click", async () => {
  const source = await readFile(new URL("collector.js", projectRoot), "utf8");
  const start = source.indexOf("async function startPageCapture");
  const end = source.indexOf("async function savePageCapture", start);
  const flow = source.slice(start, end);
  assert.ok(flow.indexOf("resolveActivePage(chrome.tabs, chrome.scripting)") < flow.indexOf("inspectPagePermission(tab.url"));
  assert.ok(flow.indexOf("inspectPagePermission(tab.url") < flow.indexOf('type: "START_PAGE_CAPTURE"'));
  assert.ok(flow.indexOf("ensurePagePermission(tab.url") < flow.indexOf('type: "START_PAGE_CAPTURE"'));
  assert.match(flow, /status:\s*"granted"/);
  assert.match(flow, /你没有授予当前网站访问权限/);
});

test("toolbar authorization keeps the side panel open instead of toggling it closed", async () => {
  const source = await readFile(new URL("background.js", projectRoot), "utf8");
  assert.doesNotMatch(source, /openPanelOnActionClick:\s*true/);
  assert.match(source, /chrome\.action\.onClicked\.addListener/);
  const listenerStart = source.indexOf("chrome.action.onClicked.addListener");
  const listenerEnd = source.indexOf("chrome.runtime.onConnect.addListener", listenerStart);
  assert.match(source.slice(listenerStart, listenerEnd), /chrome\.sidePanel\.open\(\{\s*windowId:\s*tab\.windowId\s*\}\)/);
});

test("creative result capture and commit use one background transaction", async () => {
  const messages = [];
  const capturedDraft = { id: "captured", visuals: [{ id: "visual-1" }] };
  const chromeApi = {
    permissions: { request: async () => true },
    tabs: { query: async () => [{ id: 29, url: "https://example.com/result" }] },
    runtime: {
      sendMessage: async (message) => {
        messages.push(message);
        return {
          ok: true,
          message: "生成结果已保存",
          draft: capturedDraft,
          captured: { ok: true, draft: capturedDraft },
          committed: { ok: true }
        };
      }
    }
  };

  const result = await runCaptureTransaction({
    type: "CAPTURE_ACTIVE_TAB_TO_DRAFT",
    commitCreative: true,
    chromeApi
  });

  assert.equal(result.message, "生成结果已保存");
  assert.deepEqual(messages, [{
    type: "CAPTURE_CREATIVE_OUTPUTS",
    captureType: "CAPTURE_ACTIVE_TAB_TO_DRAFT",
    tabId: 29
  }]);
});

test("a failed creative commit exposes the captured draft instead of hiding the saved screenshot", async () => {
  const capturedDraft = { id: "captured", visuals: [{ id: "visual-1" }] };
  const chromeApi = {
    permissions: { request: async () => true },
    tabs: { query: async () => [{ id: 31, url: "https://example.com/result" }] },
    runtime: {
      sendMessage: async () => ({
        ok: false,
        message: "没有等待接收结果的提示词",
        draft: capturedDraft
      })
    }
  };

  await assert.rejects(
    () => runCaptureTransaction({
      type: "CAPTURE_ACTIVE_TAB_TO_DRAFT",
      commitCreative: true,
      chromeApi
    }),
    (error) => {
      assert.equal(error.message, "没有等待接收结果的提示词");
      assert.equal(error.draft, capturedDraft);
      return true;
    }
  );
});
