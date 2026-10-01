import test from "node:test";
import assert from "node:assert/strict";
import { sameUndoState, serializeUndoState } from "../extension/undo-state.js";
import { createEntrySaveUndo, assertCreatedEntryUndoSafe } from "../extension/save-history.js";

test("storage key order is ignored while case, label and media array order and edits remain significant", () => {
  const original = { id: "case", text: "original", mediaAssets: [{ id: "asset", kind: "image" }], customLabels: ["A", "B"] };
  const roundtrip = { customLabels: ["A", "B"], mediaAssets: [{ kind: "image", id: "asset" }], text: "original", id: "case" };
  assert.equal(sameUndoState(original, roundtrip), true);
  const undo = createEntrySaveUndo(original);
  assert.doesNotThrow(() => assertCreatedEntryUndoSafe(roundtrip, undo));
  assert.throws(() => assertCreatedEntryUndoSafe({ ...roundtrip, text: "manual edit" }, undo), /被修改/);
  assert.equal(sameUndoState(original, { ...roundtrip, customLabels: ["B", "A"] }), false);
  assert.equal(serializeUndoState(undefined), undefined);
});
