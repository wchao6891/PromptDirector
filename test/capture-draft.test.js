import test from "node:test";
import assert from "node:assert/strict";

import {
  addDraftFragment,
  addDraftVisual,
  captureTitleForSource,
  createCaptureDraft,
  draftSourcePages,
  draftParts,
  draftText,
  removeDraftFragment,
  reorderDraftFragments,
  setDraftPrimaryVisual
} from "../capture-draft.js";
import { normalizeEntryVisuals, primaryVisual } from "../visuals.js";

test("a capture draft combines ordered highlights across pages without duplicating the same selection", () => {
  let draft = createCaptureDraft();
  ({ draft } = addDraftFragment(draft, { text: "第一段", sourceUrl: "https://a.example/post", sourceTitle: "A" }));
  const duplicate = addDraftFragment(draft, { text: "第一段", sourceUrl: "https://a.example/post", sourceTitle: "A" });
  assert.equal(duplicate.added, false);
  ({ draft } = addDraftFragment(draft, { text: "第三段", sourceUrl: "https://b.example/work", sourceTitle: "B" }));
  ({ draft } = addDraftFragment(draft, { text: "第二段", sourceUrl: "https://a.example/post", sourceTitle: "A" }));
  draft = reorderDraftFragments(draft, [draft.fragments[0].id, draft.fragments[2].id, draft.fragments[1].id]);
  assert.equal(draftText(draft), "第一段\n\n第二段\n\n第三段");
  assert.deepEqual(draftSourcePages(draft), [
    { url: "https://a.example/post", title: "A" },
    { url: "https://b.example/work", title: "B" }
  ]);
  draft = removeDraftFragment(draft, draft.fragments[1].id);
  assert.equal(draftText(draft), "第一段\n\n第三段");
});

test("X capture uses a compact account title while preserving the original source title", () => {
  const original = "A very long post title copied from X / X";
  const fragment = { text: "提示词", sourceUrl: "https://x.com/PromptAuthor/status/123", sourceTitle: original };
  const { draft } = addDraftFragment(createCaptureDraft(), fragment);

  assert.equal(captureTitleForSource(fragment.sourceUrl, original), "X · @PromptAuthor");
  assert.equal(draft.title, "X · @PromptAuthor");
  assert.equal(draft.fragments[0].sourceTitle, original);
  assert.equal(captureTitleForSource("https://x.com/i/web/status/123", original), "X");
  assert.equal(captureTitleForSource("https://twitter.com/home", original), "X");
  assert.equal(captureTitleForSource("https://example.com/post", original), original);
});

test("capture draft v2 groups repeated selections from one source into one ordered part", () => {
  let draft = createCaptureDraft({ targetCaseId: "compound:target" });
  ({ draft } = addDraftFragment(draft, { text: "第一段", sourceUrl: "https://a.example/post", sourceTitle: "A" }));
  ({ draft } = addDraftFragment(draft, { text: "第二段", sourceUrl: "https://a.example/post", sourceTitle: "A" }));
  ({ draft } = addDraftFragment(draft, { text: "第三段", sourceUrl: "https://b.example/work", sourceTitle: "B" }));

  assert.equal(draft.version, 2);
  assert.equal(draft.targetCaseId, "compound:target");
  assert.deepEqual(draftParts(draft).map((part) => ({ url: part.sourceUrl, text: part.text })), [
    { url: "https://a.example/post", text: "第一段\n\n第二段" },
    { url: "https://b.example/work", text: "第三段" }
  ]);
});

test("a capture draft keeps multiple visuals and an explicit primary visual", () => {
  let draft = createCaptureDraft();
  draft = addDraftVisual(draft, { id: "visual-a", sourceUrl: "https://a.example", width: 800, height: 600 });
  draft = addDraftVisual(draft, { id: "visual-b", sourceUrl: "https://b.example", width: 1200, height: 700 });
  assert.equal(draft.primaryVisualId, "visual-a");
  draft = setDraftPrimaryVisual(draft, "visual-b");
  assert.equal(draft.primaryVisualId, "visual-b");
});

test("capture metadata keeps an optional manual type and free-form labels without affecting content", () => {
  const draft = createCaptureDraft({
    contentTypeId: "content:prompt:video",
    contentTypeExplicit: true,
    customLabels: ["待复刻", " 喜欢 ", "待复刻"],
    customLabelsExplicit: true
  });

  assert.equal(draft.contentTypeId, "content:prompt:video");
  assert.equal(draft.contentTypeExplicit, true);
  assert.deepEqual(draft.customLabels, ["待复刻", "喜欢"]);
  assert.equal(draft.customLabelsExplicit, true);
});

test("schema 12 visual normalization migrates one legacy screenshot without keeping singular screenshot fields", () => {
  const entry = normalizeEntryVisuals({
    id: "latest",
    title: "Latest",
    url: "https://example.com/latest",
    savedAt: "2026-07-23T10:01:00.000Z",
    hasScreenshot: true,
    screenshotWidth: 640,
    screenshotHeight: 480,
    screenshotMimeType: "image/webp",
    screenshotByteSize: 123,
    screenshotReviewStatus: "verified",
    palette: { colors: ["#112233"] }
  });
  assert.equal(entry.visuals.length, 1);
  assert.equal(entry.visuals[0].id, "latest");
  assert.equal(primaryVisual(entry).width, 640);
  assert.equal(Object.hasOwn(entry, "hasScreenshot"), false);
  assert.equal(Object.hasOwn(entry, "screenshotWidth"), false);
});

test("an explicit draft target never falls back to the previous screenshot case", () => {
  const previous = normalizeEntryVisuals({ id: "previous", hasScreenshot: true, savedAt: "2026-07-23T10:00:00.000Z" });
  const latest = normalizeEntryVisuals({ id: "latest", savedAt: "2026-07-23T10:01:00.000Z" });
  const draft = createCaptureDraft({ targetCaseId: latest.id });
  assert.equal(draft.targetCaseId, "latest");
  assert.equal(primaryVisual(previous)?.id, "previous");
  assert.equal(primaryVisual(latest), null);
});
