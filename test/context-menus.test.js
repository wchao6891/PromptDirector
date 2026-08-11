import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CONTEXT_MENU_ITEMS,
  MENU_IDS,
  handleContextMenuCapture,
  syncContextMenus,
  waitForStablePageLayout
} from "../context-menus.js";

test("context menus expose one PromptDirector action for each right-click context", async () => {
  const created = [];
  let removals = 0;
  const chromeApi = {
    contextMenus: {
      async removeAll() { removals += 1; },
      create(item) { created.push(item); }
    },
    i18n: { getMessage: (key) => key }
  };

  await syncContextMenus(chromeApi);
  await syncContextMenus(chromeApi);

  assert.equal(removals, 2);
  assert.equal(created.length, CONTEXT_MENU_ITEMS.length * 2);
  assert.deepEqual(CONTEXT_MENU_ITEMS, [
    { id: MENU_IDS.addSelectionToDraft, messageKey: "menuSaveSelectionToPromptDirector", contexts: ["selection"] },
    { id: MENU_IDS.smartVisualsToDraft, messageKey: "menuSmartVisualsToPromptDirector", contexts: ["image", "video"] },
    { id: MENU_IDS.openSidePanel, messageKey: "menuOpenPromptDirectorSidePanel", contexts: ["page"] }
  ]);
  assert.equal(new Set(CONTEXT_MENU_ITEMS.flatMap((item) => item.contexts)).size, 4);
});

test("a failed startup sync does not prevent the next extension restart from rebuilding menus", async () => {
  let failOnce = true;
  let created = 0;
  const chromeApi = {
    contextMenus: {
      async removeAll() {
        if (failOnce) {
          failOnce = false;
          throw new Error("temporary menu failure");
        }
      },
      create() { created += 1; }
    },
    i18n: { getMessage: (key) => key }
  };

  await assert.rejects(syncContextMenus(chromeApi), /temporary menu failure/);
  await syncContextMenus(chromeApi);
  assert.equal(created, CONTEXT_MENU_ITEMS.length);
});

test("right-click selection requests the side panel before asynchronous storage begins", async () => {
  let releaseCapture;
  let openCalls = 0;
  const capturePending = new Promise((resolve) => { releaseCapture = resolve; });
  const handled = handleContextMenuCapture({
    menuItemId: MENU_IDS.addSelectionToDraft,
    selectionText: "selected prompt",
    pageUrl: "https://example.com"
  }, {
    id: 4,
    windowId: 7,
    title: "Example"
  }, {
    chromeApi: { sidePanel: { open: async () => { openCalls += 1; } } },
    enqueueCapture: (task) => task(),
    dispatch: () => capturePending,
    showResult: async () => undefined
  });

  assert.equal(handled, true);
  assert.equal(openCalls, 1, "sidePanel.open must run during the original context-menu gesture");
  releaseCapture({ ok: true, added: true, message: "saved" });
  await capturePending;
});

test("right-click image waits for the side panel layout before starting smart visual selection", async () => {
  let releasePanel;
  let dispatchCalls = 0;
  const calls = [];
  const panelPending = new Promise((resolve) => { releasePanel = resolve; });
  const handled = handleContextMenuCapture({
    menuItemId: MENU_IDS.smartVisualsToDraft,
    srcUrl: "https://example.com/image.jpg"
  }, {
    id: 4,
    windowId: 7,
    title: "Example"
  }, {
    chromeApi: { sidePanel: { open: () => { calls.push("open-panel"); return panelPending; } } },
    waitForLayout: async (tabId) => {
      calls.push(`stable-layout:${tabId}`);
    },
    enqueueCapture: (task) => task(),
    dispatch: async (action, payload) => {
      calls.push("dispatch-picker");
      dispatchCalls += 1;
      assert.equal(action, "capture-visible-visuals");
      assert.deepEqual(payload, { tabId: 4 });
      return { ok: true, message: "selected" };
    },
    showResult: async () => undefined
  });

  assert.equal(handled, true);
  assert.equal(dispatchCalls, 0);
  assert.deepEqual(calls, ["open-panel"]);
  releasePanel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(dispatchCalls, 1);
  assert.deepEqual(calls, ["open-panel", "stable-layout:4", "dispatch-picker"]);
});

test("right-click page only opens the side panel and never changes the capture draft", async () => {
  let openCalls = 0;
  let enqueueCalls = 0;
  const handled = handleContextMenuCapture({
    menuItemId: MENU_IDS.openSidePanel,
    pageUrl: "https://example.com"
  }, {
    id: 4,
    windowId: 7,
    title: "Example"
  }, {
    chromeApi: { sidePanel: { open: async () => { openCalls += 1; } } },
    enqueueCapture: () => { enqueueCalls += 1; },
    dispatch: () => { throw new Error("must not dispatch"); },
    showResult: async () => undefined
  });

  assert.equal(handled, true);
  assert.equal(openCalls, 1);
  assert.equal(enqueueCalls, 0);
});

test("non-text selection never opens the side panel as a text capture", () => {
  let openCalls = 0;
  const handled = handleContextMenuCapture({
    menuItemId: MENU_IDS.addSelectionToDraft,
    selectionText: "   ",
    pageUrl: "https://example.com"
  }, { id: 4, windowId: 7 }, {
    chromeApi: { sidePanel: { open: async () => { openCalls += 1; } } },
    enqueueCapture: () => { throw new Error("must not enqueue"); },
    dispatch: () => { throw new Error("must not dispatch"); },
    showResult: async () => undefined
  });

  assert.equal(handled, false);
  assert.equal(openCalls, 0);
});

test("background startup only uses Chromium context-menu events", async () => {
  const background = await readFile(new URL("../background.js", import.meta.url), "utf8");
  assert.doesNotMatch(background, /contextMenus\.onShown/);
  assert.match(background, /contextMenus\.onClicked\.addListener/);
});

test("layout stabilization observes the resized page before the picker measures candidates", async () => {
  const originalWindow = globalThis.window;
  const originalAnimationFrame = globalThis.requestAnimationFrame;
  const widths = [1000, 900, 900, 900, 900];
  let observedFrames = 0;
  globalThis.window = { innerWidth: 1200, innerHeight: 800 };
  globalThis.requestAnimationFrame = (callback) => {
    globalThis.window.innerWidth = widths[observedFrames] ?? 900;
    observedFrames += 1;
    queueMicrotask(callback);
  };
  try {
    const stable = await waitForStablePageLayout({
      scripting: {
        executeScript: async ({ func, args }) => [{ result: await func(...args) }]
      }
    }, 4);
    assert.equal(stable, true);
    assert.equal(observedFrames, 8);
  } finally {
    globalThis.window = originalWindow;
    globalThis.requestAnimationFrame = originalAnimationFrame;
  }
});
