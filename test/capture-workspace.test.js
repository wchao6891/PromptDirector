import test from "node:test";
import assert from "node:assert/strict";

import { createCaptureWorkspace } from "../capture-workspace.js";

test("capture workspace persists a selected fragment behind one dispatch interface", async () => {
  const stored = {};
  const chromeApi = fakeChrome(stored);
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined,
    deleteVisual: async () => undefined
  });

  const result = await workspace.dispatch("add-selection", {
    fragment: {
      text: "保留这段提示词",
      sourceUrl: "https://example.com/post",
      sourceTitle: "案例"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.added, true);
  assert.equal(result.wasEmpty, true);
  assert.equal(result.draft.fragments[0].text, "保留这段提示词");
  assert.equal(stored.captureDraft.fragments[0].sourceUrl, "https://example.com/post");
});

test("subsequent right-click additions report counts without treating the draft as empty", async () => {
  const stored = {};
  const workspace = createCaptureWorkspace({
    chromeApi: fakeChrome(stored), captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined, deleteVisual: async () => undefined
  });
  await workspace.dispatch("add-selection", { fragment: { text: "一", sourceUrl: "https://a.example" } });
  const result = await workspace.dispatch("add-selection", { fragment: { text: "二", sourceUrl: "https://b.example" } });
  assert.equal(result.wasEmpty, false);
  assert.equal(result.textCount, 2);
  assert.equal(result.imageCount, 0);
  assert.equal(result.message, "已加入 · 共 2 段文字 / 0 张图片");
});

test("automatic text capture reads only the active highlight", async () => {
  const stored = {};
  const chromeApi = fakeChrome(stored, {
    executeScript: async () => [{ result: "网页高亮文字" }]
  });
  const workspace = createCaptureWorkspace({
    chromeApi, captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined, deleteVisual: async () => undefined
  });

  const result = await workspace.dispatch("try-active-selection");

  assert.equal(result.added, true);
  assert.equal(result.candidateKind, "selection");
  assert.equal(result.draft.fragments[0].text, "网页高亮文字");
  assert.equal(result.draft.fragments[0].sourceKind, "selection");
  assert.equal(result.draft.fragments[0].sourceUrl, "https://example.com/");
});

test("automatic text capture stays empty when there is no highlight", async () => {
  const stored = {};
  const chromeApi = fakeChrome(stored, {
    executeScript: async () => [{ result: "   " }]
  });
  const workspace = createCaptureWorkspace({
    chromeApi, captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined, deleteVisual: async () => undefined
  });

  const result = await workspace.dispatch("try-active-selection");

  assert.equal(result.added, false);
  assert.equal(result.reason, "empty-selection");
  assert.equal(result.draft.fragments.length, 0);
});

test("automatic text capture never reads or overwrites a non-empty draft", async () => {
  const stored = { captureDraft: { fragments: [{ id: "keep", text: "用户正在编辑" }] } };
  let scriptCalls = 0;
  const chromeApi = fakeChrome(stored, {
    executeScript: async () => {
      scriptCalls += 1;
      return [{ result: "网页高亮文字" }];
    }
  });
  const workspace = createCaptureWorkspace({
    chromeApi, captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined, deleteVisual: async () => undefined
  });

  const result = await workspace.dispatch("try-active-selection");

  assert.equal(result.added, false);
  assert.equal(result.reason, "draft-not-empty");
  assert.equal(scriptCalls, 0);
  assert.equal(result.draft.fragments[0].text, "用户正在编辑");
});

test("explicit clipboard extraction can reuse saved text without inventing a web source", async () => {
  const stored = {};
  const chromeApi = fakeChrome(stored, {
    executeScript: async () => [{ result: "" }]
  });
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined,
    deleteVisual: async () => undefined
  });

  const first = await workspace.dispatch("add-clipboard-text", { text: "  第一段剪贴板文字  " });
  assert.equal(first.added, true);
  assert.equal(first.draft.fragments[0].sourceKind, "clipboard");
  assert.equal(first.draft.fragments[0].sourceTitle, "剪贴板");
  assert.equal(first.draft.fragments[0].sourceUrl, "");
  stored.captureDraft = {};

  const repeated = await workspace.dispatch("add-clipboard-text", { text: "第一段剪贴板文字" });
  assert.equal(repeated.added, true);
  assert.equal(repeated.draft.fragments[0].text, "第一段剪贴板文字");
});

test("cancelled region capture does not create a visual or call offscreen", async () => {
  const stored = {};
  const calls = [];
  const chromeApi = fakeChrome(stored, {
    executeScript: async () => {
      calls.push("select");
      return [{ result: null }];
    },
    sendMessage: async (message) => {
      if (message?.target === "offscreen") calls.push("offscreen");
      return { ok: true };
    }
  });
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    captureClipboardFingerprintStorageKey: "lastCommittedClipboardFingerprint",
    ensureOffscreenDocument: async () => calls.push("ensure-offscreen"),
    deleteVisual: async () => calls.push("delete")
  });

  const result = await workspace.dispatch("capture-tab", {
    tab: { id: 7, windowId: 3, url: "https://example.com", title: "Example" }
  });

  assert.equal(result.ok, true);
  assert.equal(result.message, "已取消截图，草稿没有改变");
  assert.equal(result.draft.visuals.length, 0);
  assert.deepEqual(calls, ["select"]);
});

test("smart visual capture verifies the active page, restores it, and persists the cropped result", async () => {
  const stored = {};
  const calls = [];
  let executeCount = 0;
  const chromeApi = fakeChrome(stored, {
    query: async () => {
      calls.push("active-tab");
      return [{ id: 7, windowId: 3, url: "https://example.com", title: "Example" }];
    },
    captureVisibleTab: async () => {
      calls.push("capture-visible-tab");
      return "data:image/png;base64,AA==";
    },
    executeScript: async () => {
      executeCount += 1;
      if (executeCount === 1) {
        calls.push("select-visual");
        return [{
          result: {
            captureToken: "capture-token",
            selections: [{ x: 10, y: 20, width: 600, height: 400 }]
          }
        }];
      }
      calls.push("restore-page");
      return [{ result: true }];
    },
    sendMessage: async (message) => {
      calls.push(message.type);
      return {
        ok: true,
        results: [{
          width: 600,
          height: 400,
          mimeType: "image/webp",
          byteSize: 1234,
          palette: { colors: ["#112233"] }
        }]
      };
    }
  });
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    captureClipboardFingerprintStorageKey: "lastCommittedClipboardFingerprint",
    ensureOffscreenDocument: async () => calls.push("ensure-offscreen"),
    deleteVisual: async () => calls.push("delete"),
    createId: () => "visual-1",
    now: () => "2026-07-28T10:00:00.000Z"
  });

  const result = await workspace.dispatch("capture-visible-visuals", { tabId: 7 });

  assert.equal(result.ok, true);
  assert.equal(result.draft.visuals[0].id, "visual-1");
  assert.equal(result.draft.visuals[0].capturedAt, "2026-07-28T10:00:00.000Z");
  assert.deepEqual(calls, [
    "active-tab",
    "select-visual",
    "active-tab",
    "capture-visible-tab",
    "restore-page",
    "ensure-offscreen",
    "CROP_AND_STORE_SCREENSHOTS"
  ]);
  assert.equal(stored.captureDraft.visuals.length, 1);
});

test("failed smart visual storage removes every partial visual and leaves the draft unchanged", async () => {
  const stored = {};
  const deleted = [];
  let executeCount = 0;
  const chromeApi = fakeChrome(stored, {
    executeScript: async () => {
      executeCount += 1;
      if (executeCount === 1) {
        return [{
          result: {
            captureToken: "capture-token",
            selections: [{ x: 10, y: 20, width: 600, height: 400 }]
          }
        }];
      }
      return [{ result: true }];
    },
    sendMessage: async () => ({ ok: false, message: "磁盘写入失败" })
  });
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    captureClipboardFingerprintStorageKey: "lastCommittedClipboardFingerprint",
    ensureOffscreenDocument: async () => undefined,
    deleteVisual: async (visualId) => deleted.push(visualId),
    createId: () => "visual-failed"
  });

  await assert.rejects(
    () => workspace.dispatch("capture-visible-visuals", { tabId: 7 }),
    { message: "磁盘写入失败" }
  );
  assert.deepEqual(deleted, ["visual-failed"]);
  assert.equal((await workspace.getDraft()).visuals.length, 0);
});

test("smart visual selection with no candidates preserves the draft and offers region capture recovery", async () => {
  const stored = { captureDraft: { fragments: [{ id: "fragment-1", text: "keep me" }], visuals: [] } };
  const chromeApi = fakeChrome(stored, {
    executeScript: async () => [{ result: { captureToken: "capture-token", selections: [] } }]
  });
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    captureClipboardFingerprintStorageKey: "lastCommittedClipboardFingerprint",
    ensureOffscreenDocument: async () => undefined,
    deleteVisual: async () => undefined
  });

  const result = await workspace.dispatch("capture-visible-visuals", { tabId: 7 });

  assert.equal(result.ok, true);
  assert.equal(result.fallbackAction, "capture-region");
  assert.deepEqual(result.draft.fragments.map(({ id, text }) => ({ id, text })), [{ id: "fragment-1", text: "keep me" }]);
  assert.deepEqual(result.draft.visuals, []);
});

test("side-panel smart selection starts without a page toolbar and confirms through the same session", async () => {
  const stored = {};
  const calls = [];
  const chromeApi = fakeChrome(stored, {
    executeScript: async (details) => {
      calls.push({ type: "execute", options: details.args?.[0] });
      return [{ result: {
        empty: false,
        candidateCount: 2,
        selectedCount: 0,
        geometryRevision: 1,
        fullscreen: false
      } }];
    },
    sendTabMessage: async (_tabId, message) => {
      calls.push({ type: "tab-message", message });
      return {
        ok: true,
        selections: [{ x: 10, y: 20, width: 600, height: 400, viewportWidth: 1200, viewportHeight: 800 }]
      };
    },
    sendMessage: async (message) => {
      calls.push({ type: "runtime-message", message });
      return {
        ok: true,
        results: [{ width: 600, height: 400, mimeType: "image/webp", byteSize: 1234, palette: { colors: [] } }]
      };
    },
    captureVisibleTab: async () => "data:image/png;base64,AA=="
  });
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined,
    deleteVisual: async () => undefined,
    createId: (() => {
      const ids = ["selection-session", "selection-visual"];
      return () => ids.shift();
    })(),
    now: () => "2026-08-08T10:00:00.000Z"
  });

  const started = await workspace.dispatch("start-visible-visual-selection", { tabId: 7 });
  assert.equal(started.session.sessionId, "selection-session");
  assert.equal(started.session.candidateCount, 2);
  assert.equal(calls[0].options.externalControls, true);
  assert.equal(calls[0].options.hideFloatingControls, true);

  const confirmed = await workspace.dispatch("confirm-visible-visual-selection", { sessionId: "selection-session" });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.draft.visuals[0].id, "selection-visual");
  const confirmCall = calls.find((call) => call.type === "tab-message");
  assert.deepEqual(confirmCall.message, {
    type: "PROMPTDIRECTOR_SMART_VISUAL_SELECTION",
    action: "confirm",
    sessionId: "selection-session"
  });
});

test("removing a visual never deletes its pixels before the updated draft is durable", async () => {
  const stored = {
    captureDraft: {
      visuals: [{ id: "visual-1", sourceUrl: "https://example.com", width: 600, height: 400 }]
    }
  };
  const calls = [];
  const chromeApi = fakeChrome(stored, {
    set: async () => {
      calls.push("persist");
      throw new Error("storage unavailable");
    }
  });
  const workspace = createCaptureWorkspace({
    chromeApi,
    captureDraftStorageKey: "captureDraft",
    captureClipboardFingerprintStorageKey: "lastCommittedClipboardFingerprint",
    ensureOffscreenDocument: async () => undefined,
    deleteVisual: async () => calls.push("delete")
  });

  await assert.rejects(
    () => workspace.dispatch("remove-visual", { visualId: "visual-1" }),
    { message: "storage unavailable" }
  );
  assert.deepEqual(calls, ["persist"]);
});

test("discard keeps only screenshots whose pixels could not be deleted", async () => {
  const stored = {
    captureDraft: {
      fragments: [{ id: "fragment-1", text: "discard" }],
      visuals: [
        { id: "visual-deleted", sourceUrl: "https://example.com/a", width: 600, height: 400 },
        { id: "visual-retained", sourceUrl: "https://example.com/b", width: 600, height: 400 }
      ]
    }
  };
  const workspace = createCaptureWorkspace({
    chromeApi: fakeChrome(stored),
    captureDraftStorageKey: "captureDraft",
    ensureOffscreenDocument: async () => undefined,
    deleteVisual: async (id) => {
      if (id === "visual-retained") throw new Error("storage busy");
    }
  });

  await assert.rejects(() => workspace.dispatch("cancel"), /1 张截图未能删除/);
  assert.deepEqual(stored.captureDraft.fragments, []);
  assert.deepEqual(stored.captureDraft.visuals.map((item) => item.id), ["visual-retained"]);
});

function fakeChrome(stored, overrides = {}) {
  return {
    storage: {
      local: {
        get: async (key) => ({ [key]: stored[key] }),
        set: overrides.set ?? (async (values) => Object.assign(stored, values))
      }
    },
    tabs: {
      query: overrides.query ?? (async () => [{ id: 7, windowId: 3, url: "https://example.com", title: "Example" }]),
      captureVisibleTab: overrides.captureVisibleTab ?? (async () => "data:image/png;base64,AA=="),
      sendMessage: overrides.sendTabMessage ?? (async () => ({ ok: true }))
    },
    scripting: {
      insertCSS: async () => undefined,
      removeCSS: async () => undefined,
      executeScript: overrides.executeScript ?? (async () => [{ result: null }])
    },
    runtime: {
      sendMessage: overrides.sendMessage ?? (async () => ({ ok: true }))
    },
    i18n: {
      getUILanguage: () => "zh-CN"
    }
  };
}
