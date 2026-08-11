import test from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_CAPTURE_ADAPTERS,
  applyPageCaptureSelections,
  collectPageCaptureSnapshot,
  detectPageCaptureAdapter,
  normalizePageCaptureBatch,
  normalizePageCaptureCandidate,
  normalizePageCaptureSelection,
  normalizeSourceFacts,
  pageCapturePermissionOrigins
} from "../page-capture.js";

test("page capture adapter registry recognizes every first-wave public site", () => {
  const fixtures = new Map([
    ["https://jimeng.jianying.com/ai-tool/home", "jimeng"],
    ["https://www.liblib.art/modelinfo/example", "liblibai"],
    ["https://higgsfield.ai/feed", "higgsfield"],
    ["https://www.krea.ai/apps/image/realtime", "krea"],
    ["https://www.tapnow.ai/explore", "tapnow"],
    ["https://www.pinterest.com/pin/123", "pinterest"],
    ["https://www.artstation.com/artwork/example", "artstation"],
    ["https://x.com/user/status/123", "x"],
    ["https://www.reddit.com/r/art/comments/abc/work", "reddit"],
    ["https://www.youtube.com/watch?v=abc", "youtube"],
    ["https://www.bilibili.com/video/BV1xx", "bilibili"],
    ["https://store.steampowered.com/app/123/game", "steam"]
  ]);
  for (const [url, expected] of fixtures) assert.equal(detectPageCaptureAdapter(url).id, expected, url);
  assert.equal(detectPageCaptureAdapter("https://example.com/article").id, "generic");
  assert.equal(PAGE_CAPTURE_ADAPTERS.every((adapter) => adapter.fields && Object.keys(adapter.fields).length), true);
});

test("whole-page scanning accumulates each virtualized viewport before the page restores its scroll", () => {
  const source = collectPageCaptureSnapshot.toString();
  const scan = source.slice(source.indexOf("async function scanLoadedPage"), source.indexOf("function detectAdapter"));
  assert.match(scan, /collectVisible\(\)/);
  assert.match(scan, /window\.scrollY.*viewport/);
  assert.match(source, /accumulated\.set/);
});

test("page capture keeps source facts searchable without turning volatile metrics into labels", () => {
  const facts = normalizeSourceFacts({
    provider: "x",
    pageType: "post",
    itemId: "123",
    author: "Director",
    engagement: { likes: 42, invalid: "unknown" },
    capturedAt: "2026-08-09T00:00:00.000Z"
  }, "https://x.com/director/status/123");
  assert.equal(facts.provider, "x");
  assert.deepEqual(facts.engagement, { likes: 42 });
  assert.equal(facts.engagementObservedAt, "2026-08-09T00:00:00.000Z");
  assert.equal("labels" in facts, false);
});

test("page capture candidates deduplicate media and preserve partial extraction", () => {
  const candidate = normalizePageCaptureCandidate({
    title: "公开作品",
    canonicalUrl: "https://example.com/work/1",
    pageType: "artwork",
    media: [
      { kind: "image", url: "https://cdn.example.com/a.jpg", width: 1200, height: 800 },
      { kind: "image", url: "https://cdn.example.com/a.jpg", width: 300, height: 200 }
    ]
  });
  assert.equal(candidate.media.length, 1);
  assert.equal(candidate.completeness, "partial");
});

test("page capture requires explicit component confirmation and requests only chosen media origins", () => {
  const batch = normalizePageCaptureBatch({ candidates: [
    { id: "one", title: "一", canonicalUrl: "https://example.com/1", contentText: "正文一", media: [{ id: "one-image", url: "https://img.example.com/a.jpg" }] },
    { id: "two", title: "二", canonicalUrl: "https://example.com/2", contentText: "正文二", media: [{ id: "two-image", url: "https://media.example.net/b.jpg" }] }
  ] });
  assert.deepEqual(batch.selections, []);
  const confirmed = normalizePageCaptureBatch({
    ...batch,
    selections: [{ candidateId: "one", includeText: false, selectedMediaIds: ["one-image"] }]
  });
  assert.deepEqual(confirmed.selections, [{ candidateId: "one", includeText: false, selectedMediaIds: ["one-image"] }]);
  const selected = applyPageCaptureSelections(confirmed);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].contentText, "");
  assert.deepEqual(selected[0].media.map((item) => item.id), ["one-image"]);
  assert.deepEqual(pageCapturePermissionOrigins(selected), ["https://img.example.com/*"]);
});

test("page capture selection ignores unknown candidates and media", () => {
  const candidates = [normalizePageCaptureCandidate({
    id: "known", title: "作品", canonicalUrl: "https://example.com/work",
    contentText: "正文", media: [{ id: "known-image", url: "https://img.example.com/a.jpg" }]
  })];
  assert.equal(normalizePageCaptureSelection({ candidateId: "missing", includeText: true }, candidates), null);
  assert.deepEqual(normalizePageCaptureSelection({
    candidateId: "known", includeText: true, selectedMediaIds: ["missing", "known-image"]
  }, candidates), { candidateId: "known", includeText: true, selectedMediaIds: ["known-image"] });
});

test("the actual Chrome injection function is self-contained", async () => {
  const injected = (0, eval)(`(${collectPageCaptureSnapshot.toString()})`);
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    chrome: globalThis.chrome,
    Readability: globalThis.Readability
  };
  const body = {
    innerText: "A real article body that is long enough to become a capture candidate.",
    scrollHeight: 800,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = { scrollX: 0, scrollY: 0, scrollTo: () => undefined };
  globalThis.document = {
    title: "Injection fixture",
    body,
    documentElement: { scrollHeight: 800 },
    baseURI: "https://example.com/article",
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode: () => ({})
  };
  globalThis.location = { hostname: "example.com", href: "https://example.com/article" };
  globalThis.chrome = undefined;
  globalThis.Readability = undefined;
  try {
    const result = await injected({ adapters: [], maxCandidates: 10, maxMedia: 10 });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].title, "Injection fixture");
  } finally {
    Object.assign(globalThis, original);
  }
});

test("visible canvas pixels stay local to the capture payload and do not request a fake host permission", () => {
  const candidate = normalizePageCaptureCandidate({
    id: "canvas-work", title: "Canvas 作品", canonicalUrl: "https://example.com/work",
    media: [{ id: "canvas:1", kind: "image", dataUrl: "data:image/webp;base64,AAAA", captureMethod: "pixel-fallback", width: 800, height: 600 }]
  });
  assert.equal(candidate.media[0].captureMethod, "pixel-fallback");
  assert.equal(candidate.media[0].dataUrl, "data:image/webp;base64,AAAA");
  assert.deepEqual(pageCapturePermissionOrigins([candidate]), []);
});
