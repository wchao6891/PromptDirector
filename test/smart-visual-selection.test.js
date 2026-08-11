import test from "node:test";
import assert from "node:assert/strict";

import {
  SMART_VISUAL_SELECTION_STATUS,
  createSmartVisualSelectionSession,
  shouldClearSmartVisualSelection,
  updateSmartVisualSelectionSession
} from "../smart-visual-selection.js";

test("smart visual selection keeps cross-context identity geometry and selections explicit", () => {
  const started = createSmartVisualSelectionSession({
    sessionId: "session-1",
    tabId: 42,
    windowId: 7,
    candidateCount: 5,
    geometryRevision: 2,
    fullscreen: true,
    startedAt: "2026-08-08T10:00:00.000Z"
  });
  assert.equal(started.status, SMART_VISUAL_SELECTION_STATUS.selecting);
  assert.equal(started.selectedCount, 0);
  assert.equal(started.fullscreen, true);

  const confirmed = updateSmartVisualSelectionSession(started, {
    status: SMART_VISUAL_SELECTION_STATUS.completed,
    selectedCount: 1,
    selections: [{ rect: { x: 10, y: 20, width: 300, height: 200 }, viewportWidth: 1200, viewportHeight: 800 }]
  });
  assert.deepEqual(confirmed.selections[0].rect, { x: 10, y: 20, width: 300, height: 200 });
  assert.equal(confirmed.startedAt, started.startedAt);
});

test("smart visual selection clears on refresh tab switch removal and terminal states", () => {
  const session = createSmartVisualSelectionSession({ sessionId: "session-2", tabId: 9 });
  assert.equal(shouldClearSmartVisualSelection(session, { type: "tab-loading", tabId: 9 }), true);
  assert.equal(shouldClearSmartVisualSelection(session, { type: "tab-activated", tabId: 10 }), true);
  assert.equal(shouldClearSmartVisualSelection(session, { type: "tab-removed", tabId: 9 }), true);
  assert.equal(shouldClearSmartVisualSelection(session, { type: "tab-activated", tabId: 9 }), false);
  assert.equal(shouldClearSmartVisualSelection({ ...session, status: SMART_VISUAL_SELECTION_STATUS.cancelled }, {}), true);
});
