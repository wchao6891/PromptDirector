import test from "node:test";
import assert from "node:assert/strict";

import { buildEntry } from "../lib.js";

test("a new case keeps source save time separate from when it joined this library", () => {
  const entry = buildEntry({
    text: "archived prompt",
    title: "Imported historical case",
    url: "https://example.com/source",
    savedAt: "2024-03-01T08:00:00.000Z",
    libraryAddedAt: "2026-08-08T08:00:00.000Z"
  });

  assert.equal(entry.savedAt, "2024-03-01T08:00:00.000Z");
  assert.equal(entry.libraryAddedAt, "2026-08-08T08:00:00.000Z");
});

test("a directly created case receives both current-time fields without requiring new callers", () => {
  const before = Date.now();
  const entry = buildEntry({ text: "new prompt", title: "New case", url: "" });
  const after = Date.now();

  assert.ok(Date.parse(entry.savedAt) >= before && Date.parse(entry.savedAt) <= after);
  assert.equal(entry.libraryAddedAt, entry.savedAt);
});
