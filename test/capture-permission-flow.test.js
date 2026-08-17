import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CLIPBOARD_READ_PERMISSIONS,
  CONTINUOUS_CAPTURE_ORIGINS,
  ensureClipboardReadPermission,
  hasClipboardReadPermission,
  readClipboardContentAfterFocus,
  ensureContinuousCapturePermission,
  ensurePagePermission,
  inspectPagePermission,
  pageCapturePermissionFailureMessage,
  pagePermissionPattern
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
    request: async (request) => {
      requests.push(request);
      return true;
    }
  });

  assert.equal(granted, true);
  assert.deepEqual(requests, [{ origins: [...CONTINUOUS_CAPTURE_ORIGINS] }]);
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
    message: "请先切换到需要采集的普通网页"
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
  assert.ok(flow.indexOf("inspectPagePermission(tab.url") < flow.indexOf('type: "START_PAGE_CAPTURE"'));
  assert.ok(flow.indexOf("ensurePagePermission(tab.url") < flow.indexOf('type: "START_PAGE_CAPTURE"'));
  assert.match(flow, /status:\s*"granted"/);
  assert.match(flow, /你没有授予当前网站访问权限/);
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
