import test from "node:test";
import assert from "node:assert/strict";
import { hasEnglishTranslation } from "../i18n.js";
import { normalizeMediaAsset } from "../media.js";
import {
  PAGE_CAPTURE_ADAPTERS,
  applyPageCaptureSelections,
  combinePageCaptureCandidates,
  collectPageCaptureSnapshot,
  detectPageCaptureAdapter,
  mergePageCaptureRegionEdit,
  normalizePageCaptureBatch,
  normalizePageCaptureCandidate,
  normalizePageCaptureSelection,
  normalizeSourceFacts,
  pageCaptureDefaultMediaIds,
  reconcilePageCaptureArticlePlacement,
  resolvePageCapturePageType,
  pageCaptureMediaDecisionsResolved,
  pageCaptureMediaFetchCandidates,
  pageCapturePermissionOrigins,
  pageCaptureStructureMatches,
  resolvePageCaptureImage
} from "../page-capture.js";

test("only media proven inside the article is proposed by default", () => {
  const candidate = normalizePageCaptureCandidate({
    title: "正文和素材区并存",
    canonicalUrl: "https://example.com/article",
    media: [
      { id: "article-image", kind: "image", url: "https://example.com/article.webp", placement: "inline" },
      { id: "asset-image", kind: "image", url: "https://example.com/asset.webp", placement: "unplaced" }
    ]
  });
  assert.deepEqual(pageCaptureDefaultMediaIds(candidate), ["article-image"]);
});

test("a social post keeps its post identity when the page also declares video and article data", () => {
  assert.equal(resolvePageCapturePageType({
    adapterPageType: "post",
    structuredTypes: ["VideoObject", "Article"],
    articleTextLength: 2_000,
    cardCount: 1,
    metadataType: "article"
  }), "post");
});

test("article placement only puts DOM-proven media into the reading order", () => {
  const result = reconcilePageCaptureArticlePlacement({
    articleDocument: {
      version: 1,
      blocks: [
        { id: "copy-a", kind: "paragraph", text: "第一段正文", sourceOrder: 0 },
        { id: "copy-b", kind: "paragraph", text: "第二段正文", sourceOrder: 1 }
      ]
    },
    media: [
      { id: "inline-image", kind: "image", url: "https://cdn.example.com/article.webp" },
      { id: "asset-image", kind: "image", url: "https://cdn.example.com/asset.webp" }
    ],
    contentTargets: [
      { id: "target-a", kind: "text", path: "main > p:nth-of-type(1)", articleBlockIds: ["copy-a"], mediaIds: [], sourceOrder: 0 },
      { id: "target-image", kind: "image", path: "main > img:nth-of-type(1)", articleBlockIds: [], mediaIds: ["inline-image"], sourceOrder: 1 },
      { id: "target-b", kind: "text", path: "main > p:nth-of-type(2)", articleBlockIds: ["copy-b"], mediaIds: [], sourceOrder: 2 }
    ]
  });

  assert.deepEqual(result.articleDocument.blocks.map((block) => block.id), ["copy-a", "article:image:inline-image", "copy-b"]);
  assert.deepEqual(result.articleDocument.blocks.map((block) => block.sourceOrder), [0, 1, 2]);
  assert.deepEqual(result.media.map((item) => [item.id, item.placement]), [
    ["inline-image", "inline"],
    ["asset-image", "unplaced"]
  ]);
});

test("candidate normalization preserves transient inline and unplaced media evidence", () => {
  const candidate = normalizePageCaptureCandidate({
    title: "有位置证据的文章",
    canonicalUrl: "https://example.com/article",
    media: [
      { id: "inline", kind: "image", url: "https://example.com/inline.webp", placement: "inline" },
      { id: "unplaced", kind: "image", url: "https://example.com/unplaced.webp", placement: "unplaced" }
    ]
  });
  assert.deepEqual(candidate.media.map((item) => item.placement), ["inline", "unplaced"]);
});

test("page capture quality evidence is complete in the English interface", () => {
  const labels = [
    "原网页选区",
    "智能正文",
    "结构化正文",
    "页面正文",
    "正文分段",
    "{count} 段 · 可逐段确认",
    "第 {count} 段",
    "候选 {count}px",
    "候选 {count}x",
    "picture 响应图",
    "延迟加载原图",
    "srcset 响应图",
    "站点原图",
    "结构化原图",
    "页面当前图",
    "页面可见画面",
    "CSS 背景图",
    "公开原图失败时，只会使用当前网页已有登录状态读取已确认主体内的相关媒体；不会读取或保存登录信息。",
    "预览不可用",
    "保存案例 · 含 {count} 项媒体",
    "保存 {cases} 个案例 · 含 {media} 项媒体",
    "只保存 {count} 个正文案例",
    "只保存正文",
    "保存时将确认 {count} 项媒体",
    "未识别到媒体，可返回网页补选",
    "可能遗漏媒体（{count}）"
  ];
  assert.deepEqual(labels.filter((label) => !hasEnglishTranslation(label)), []);
});

test("page capture adapter registry preserves first-wave routes and enables verified tool parsers", () => {
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
  assert.equal(detectPageCaptureAdapter("https://mp.weixin.qq.com/s/example").id, "wechat");
  assert.equal(detectPageCaptureAdapter("https://yesand.ai/prompt/example").id, "generic");
  assert.equal(PAGE_CAPTURE_ADAPTERS.every((adapter) => adapter.fields && adapter.support), true);
});

test("whole-page scanning accumulates each virtualized viewport before the page restores its scroll", () => {
  const source = collectPageCaptureSnapshot.toString();
  const scan = source.slice(source.indexOf("async function scanLoadedPage"), source.indexOf("function detectAdapter"));
  assert.match(scan, /collectVisible\(\)/);
  assert.match(scan, /window\.scrollY.*viewport/);
  assert.match(source, /accumulated\.set/);
  assert.match(scan, /waitForVisibleMedia\(\)/);
  assert.match(source, /image\.decode\(\)/);
  assert.match(source, /PAGE_CAPTURE_VIEWPORT_FALLBACKS/);
});

test("page capture ignores ordinary iframes while retaining supported video providers", () => {
  const source = collectPageCaptureSnapshot.toString();
  assert.match(source, /element\.matches\("iframe"\) && !isSupportedVideoFrame\(element\)/);
  assert.match(source, /player\.vimeo\.com/);
  assert.match(source, /player\.bilibili\.com/);
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

test("a video poster never becomes an independent article image", () => {
  const candidate = normalizePageCaptureCandidate({
    title: "视频文章",
    canonicalUrl: "https://example.com/video-article",
    media: [
      { id: "video", kind: "video", url: "https://video.example.com/watch", posterUrl: "https://cdn.example.com/poster.webp" },
      { id: "poster-copy", kind: "image", url: "https://cdn.example.com/poster.webp" },
      { id: "content-image", kind: "image", url: "https://cdn.example.com/content.webp" }
    ]
  });

  assert.deepEqual(candidate.media.map((item) => item.id), ["video", "content-image"]);
});

test("page capture selections preserve one ordered article document", () => {
  const batch = normalizePageCaptureBatch({
    candidates: [{
      id: "article",
      title: "完整文章",
      canonicalUrl: "https://example.com/article",
      textBlocks: [
        { id: "heading", kind: "section", text: "创作过程", sourceOrder: 0 },
        { id: "paragraph", kind: "section", text: "正文内容", sourceOrder: 2 }
      ],
      media: [{ id: "hero", kind: "image", url: "https://example.com/hero.webp" }],
      articleDocument: {
        version: 1,
        blocks: [
          { id: "heading", kind: "heading", level: 2, text: "创作过程", sourceOrder: 0 },
          { id: "hero-block", kind: "image", assetId: "hero", sourceUrl: "https://example.com/hero.webp", sourceOrder: 1 },
          { id: "paragraph", kind: "paragraph", text: "正文内容", sourceOrder: 2 }
        ]
      }
    }],
    selections: [{
      candidateId: "article",
      selectedTextBlockIds: ["heading", "paragraph"],
      selectedMediaIds: ["hero"],
      mediaDecision: "confirmed"
    }]
  });

  const [selected] = applyPageCaptureSelections(batch);
  assert.deepEqual(selected.articleDocument.blocks.map((block) => block.kind), ["heading", "image", "paragraph"]);
  assert.deepEqual(selected.articleDocument.blocks.map((block) => block.sourceOrder), [0, 1, 2]);
});

test("unconfirmed media never enters a saved article", () => {
  const copy = "这是一段已经确认属于创作主体的完整正文，用来验证文字可以正常保存，而图片、GIF、视频和文档仍需要独立确认。".repeat(4);
  const candidate = normalizePageCaptureCandidate({
    id: "article",
    title: "待确认媒体文章",
    canonicalUrl: "https://example.com/article",
    textBlocks: [{ id: "copy", kind: "paragraph", text: copy, sourceOrder: 0 }],
    media: [{ id: "hero", kind: "image", url: "https://example.com/hero.webp" }],
    articleDocument: {
      version: 1,
      blocks: [
        { id: "copy", kind: "paragraph", text: copy, sourceOrder: 0 },
        { id: "hero-block", kind: "image", assetId: "hero", sourceUrl: "https://example.com/hero.webp", sourceOrder: 1 }
      ]
    }
  });
  const batch = normalizePageCaptureBatch({
    candidates: [candidate],
    selections: [{
      candidateId: candidate.id,
      selectedTextBlockIds: candidate.textBlocks.map((block) => block.id),
      selectedMediaIds: ["hero"],
      mediaDecision: "pending"
    }]
  });

  assert.equal(batch.selections[0].mediaDecision, "pending");
  const [pending] = applyPageCaptureSelections(batch);
  assert.deepEqual(pending.media, []);
  assert.deepEqual(pending.articleDocument.blocks.map((block) => block.kind), ["paragraph"]);

  const [confirmed] = applyPageCaptureSelections(normalizePageCaptureBatch({
    ...batch,
    selections: [{ ...batch.selections[0], mediaDecision: "confirmed" }]
  }));
  assert.deepEqual(confirmed.media.map((media) => media.id), ["hero"]);
  assert.deepEqual(confirmed.articleDocument.blocks.map((block) => block.kind), ["paragraph", "image"]);

  const [withoutMedia] = applyPageCaptureSelections(normalizePageCaptureBatch({
    ...batch,
    selections: [{ ...batch.selections[0], mediaDecision: "none" }]
  }));
  assert.deepEqual(withoutMedia.media, []);
});

test("a case cannot be saved until the user resolves its media proposal", () => {
  const candidate = normalizePageCaptureCandidate({
    id: "proposal",
    title: "媒体待确认",
    canonicalUrl: "https://example.com/proposal",
    contentText: "已确认正文",
    media: [{ id: "preview", kind: "image", url: "https://example.com/preview.webp" }]
  });
  const selection = {
    candidateId: candidate.id,
    includeText: true,
    selectedMediaIds: ["preview"]
  };

  assert.equal(pageCaptureMediaDecisionsResolved(normalizePageCaptureBatch({
    candidates: [candidate], selections: [{ ...selection, mediaDecision: "pending" }]
  })), false);
  assert.equal(pageCaptureMediaDecisionsResolved(normalizePageCaptureBatch({
    candidates: [candidate], selections: [{ ...selection, mediaDecision: "confirmed" }]
  })), true);
  assert.equal(pageCaptureMediaDecisionsResolved(normalizePageCaptureBatch({
    candidates: [candidate], selections: [{ ...selection, mediaDecision: "none" }]
  })), true);
});

test("manual DOM correction keeps verified source facts and original media quality", () => {
  const revised = mergePageCaptureRegionEdit({
    id: "original",
    title: "原始标题",
    canonicalUrl: "https://example.com/article",
    region: {
      marker: "region:original",
      contentTargets: [{ id: "old", kind: "text", path: "body:nth-of-type(1) > main:nth-of-type(1) > p:nth-of-type(1)", articleBlockIds: ["old-text"], sourceOrder: 0 }]
    },
    sourceFacts: { provider: "verified-site", author: "作者", status: "complete" },
    media: [{ id: "verified-image", kind: "image", url: "https://cdn.example.com/image.webp", variants: [{ url: "https://cdn.example.com/image.webp", sourceKind: "site-original", width: 2400 }] }],
    articleDocument: { version: 1, blocks: [{ id: "image", kind: "image", assetId: "verified-image", sourceUrl: "https://cdn.example.com/image.webp", sourceOrder: 0 }] }
  }, {
    title: "临时 DOM 标题",
    canonicalUrl: "https://example.com/article",
    region: {
      marker: "region:revised",
      edits: [{ mode: "exclude", path: "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2)" }],
      contentTargets: [
        { id: "copy", kind: "text", path: "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(1)", articleBlockIds: ["text"], sourceOrder: 0 },
        { id: "media", kind: "image", path: "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(3) > img:nth-of-type(1)", mediaIds: ["revised-image"], groupId: "group", sourceOrder: 1 },
        { id: "group", kind: "group", path: "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(3)", mediaIds: ["revised-image"], sourceOrder: 1 }
      ]
    },
    contentText: "修正后的正文",
    textBlocks: [{ id: "text", kind: "section", text: "修正后的正文", sourceOrder: 0 }],
    media: [{ id: "revised-image", kind: "image", url: "https://cdn.example.com/image.webp", width: 320 }],
    articleDocument: { version: 1, blocks: [{ id: "image", kind: "image", assetId: "revised-image", sourceUrl: "https://cdn.example.com/image.webp", sourceOrder: 0 }] }
  });

  assert.equal(revised.id, "original");
  assert.equal(revised.title, "原始标题");
  assert.equal(revised.sourceFacts.provider, "verified-site");
  assert.equal(revised.media[0].id, "verified-image");
  assert.equal(revised.media[0].url, "https://cdn.example.com/image.webp");
  assert.equal(revised.articleDocument.blocks[0].assetId, "verified-image");
  assert.equal(revised.region.marker, "region:original");
  assert.deepEqual(revised.region.edits, [{ mode: "exclude", path: "body:nth-of-type(1) > main:nth-of-type(1) > div:nth-of-type(2)" }]);
  assert.deepEqual(revised.region.contentTargets.map((target) => target.kind), ["text", "image", "group"]);
  assert.deepEqual(revised.region.contentTargets[1].mediaIds, ["verified-image"]);
});

test("the generic capture exposes meaningful nested blocks without turning every DOM node into a choice", () => {
  const source = collectPageCaptureSnapshot.toString();
  const targets = source.slice(source.indexOf("function collectContentTargets"), source.indexOf("function collectTextBlocks"));
  assert.match(targets, /kind: "group"/);
  assert.match(targets, /articleBlockIds/);
  assert.match(targets, /mediaIds/);
  assert.match(targets, /div,section,figure/);
  assert.match(targets, /!element\.querySelector\?\.\(semanticSelector\)/);
  assert.match(source, /playerForCompanionPoster/);
  assert.match(source, /companionPosterForPlayer/);
});

test("one stable media selection keeps ranked original, lazy and current variants", () => {
  const candidate = normalizePageCaptureCandidate({
    title: "多清晰度作品",
    canonicalUrl: "https://example.com/work/variants",
    media: [{
      id: "hero-image",
      kind: "image",
      url: "https://cdn.example.com/thumb.jpg",
      sourceKind: "current",
      variants: [
        { url: "https://cdn.example.com/thumb.jpg", sourceKind: "current", width: 320 },
        { url: "https://cdn.example.com/lazy.jpg", sourceKind: "deferred-src", width: 1600 },
        { url: "https://origin.example.com/original.webp", sourceKind: "site-original", width: 2160, height: 3840 }
      ]
    }]
  });
  const [media] = candidate.media;
  assert.equal(media.id, "hero-image");
  assert.equal(media.url, "https://origin.example.com/original.webp");
  assert.deepEqual(pageCaptureMediaFetchCandidates(media), [
    "https://origin.example.com/original.webp",
    "https://cdn.example.com/lazy.jpg",
    "https://cdn.example.com/thumb.jpg"
  ]);
  assert.deepEqual(pageCapturePermissionOrigins([candidate]), ["https://cdn.example.com/*", "https://origin.example.com/*"]);
});

test("responsive URLs for one image merge without changing the first selection id", () => {
  const candidate = normalizePageCaptureCandidate({
    title: "同一作品的两个尺寸",
    canonicalUrl: "https://example.com/work/one-image",
    media: [
      { id: "visible-image", kind: "image", url: "https://cdn.example.com/photo.jpg?width=320&quality=70", sourceKind: "current", width: 320 },
      { id: "late-copy", kind: "image", url: "https://cdn.example.com/photo.jpg?width=2048&quality=90", sourceKind: "site-original", width: 2048 }
    ]
  });

  assert.equal(candidate.media.length, 1);
  assert.equal(candidate.media[0].id, "visible-image");
  assert.equal(candidate.media[0].url, "https://cdn.example.com/photo.jpg?width=2048&quality=90");
  assert.deepEqual(candidate.media[0].variants.map((item) => item.width), [2048, 320]);
});

test("the generic collector ranks an explicit full-image attribute above the visible thumbnail", async () => {
  const injected = (0, eval)(`(${collectPageCaptureSnapshot.toString()})`);
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    chrome: globalThis.chrome,
    Readability: globalThis.Readability,
    HTMLElement: globalThis.HTMLElement,
    HTMLCanvasElement: globalThis.HTMLCanvasElement,
    getComputedStyle: globalThis.getComputedStyle
  };
  class Element {}
  class Canvas extends Element {}
  const attributes = new Map([
    ["data-full-image", "https://cdn.example.com/work.jpg?width=2400"],
    ["src", "https://cdn.example.com/work.jpg?width=320"]
  ]);
  const image = new Element();
  Object.assign(image, {
    alt: "作品原图",
    src: attributes.get("src"),
    currentSrc: attributes.get("src"),
    srcset: "",
    naturalWidth: 320,
    naturalHeight: 480,
    complete: false,
    width: 320,
    height: 480,
    className: "work-image",
    matches: (selector) => selector === "img",
    closest: () => null,
    getAttribute: (name) => attributes.get(name) || "",
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 320, height: 480, top: 0, bottom: 480 })
  });
  const body = new Element();
  Object.assign(body, {
    innerText: "一张可以保存的公开作品。",
    scrollHeight: 800,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "img,video,iframe,canvas" ? [image] : []
  });
  globalThis.HTMLElement = Element;
  globalThis.HTMLCanvasElement = Canvas;
  globalThis.window = { scrollX: 0, scrollY: 0, innerWidth: 1200, innerHeight: 800, scrollTo: () => undefined };
  globalThis.document = {
    title: "Generic image fixture",
    body,
    documentElement: { scrollHeight: 800, clientWidth: 1200, clientHeight: 800 },
    baseURI: "https://example.com/work",
    images: [image],
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode: () => ({}),
    createElement: () => ({ width: 0, height: 0, getContext: () => null, toDataURL: () => "" })
  };
  globalThis.location = { hostname: "example.com", href: "https://example.com/work" };
  globalThis.getComputedStyle = () => ({ backgroundImage: "none" });
  globalThis.chrome = undefined;
  globalThis.Readability = undefined;
  try {
    const result = await injected({ adapters: PAGE_CAPTURE_ADAPTERS, maxCandidates: 10, maxMedia: 10 });
    assert.equal(result.candidates[0].media[0].url, "https://cdn.example.com/work.jpg?width=2400");
    assert.equal(result.candidates[0].media[0].sourceKind, "site-original");
  } finally {
    Object.assign(globalThis, original);
  }
});

test("page capture retries media variants and uses visible pixels only after every remote source fails", async () => {
  const attempts = [];
  const media = normalizePageCaptureCandidate({
    title: "回退作品",
    canonicalUrl: "https://example.com/work/fallback",
    media: [{
      id: "hero",
      dataUrl: "data:image/webp;base64,AAAA",
      variants: [
        { url: "https://origin.example.com/broken.webp", sourceKind: "site-original" },
        { url: "https://cdn.example.com/working.webp", sourceKind: "deferred-src" }
      ]
    }]
  }).media[0];
  const remote = await resolvePageCaptureImage(media, {
    fetchMedia: async (url) => {
      attempts.push(url);
      if (url.includes("broken")) throw new Error("HTTP 403");
      return new Blob(["remote"], { type: "image/webp" });
    },
    decodeDataUrl: async () => new Blob(["pixels"], { type: "image/webp" })
  });
  assert.deepEqual(attempts, ["https://origin.example.com/broken.webp", "https://cdn.example.com/working.webp"]);
  assert.equal(remote.usedPixelFallback, false);
  const pixels = await resolvePageCaptureImage(media, {
    fetchMedia: async () => { throw new Error("unavailable"); },
    decodeDataUrl: async () => new Blob(["pixels"], { type: "image/webp" })
  });
  assert.equal(pixels.usedPixelFallback, true);
  assert.equal(pixels.captureMethod, "pixel-fallback");
});

test("selected media uses the current page session only after public variants fail", async () => {
  const calls = [];
  const media = normalizePageCaptureCandidate({
    title: "登录后可见作品",
    canonicalUrl: "https://example.com/work/session",
    media: [{
      id: "session-image",
      dataUrl: "data:image/webp;base64,AAAA",
      variants: [{ url: "https://media.example.com/original.webp", sourceKind: "site-original" }]
    }]
  }).media[0];
  const resolved = await resolvePageCaptureImage(media, {
    fetchMedia: async (url) => { calls.push(`public:${url}`); throw new Error("HTTP 403"); },
    fetchSessionMedia: async (url) => {
      calls.push(`session:${url}`);
      return { blob: new Blob(["session"], { type: "image/webp" }), metadata: { width: 2048, height: 3072 } };
    },
    decodeDataUrl: async () => { calls.push("pixels"); return new Blob(["pixels"], { type: "image/webp" }); }
  });

  assert.deepEqual(calls, [
    "public:https://media.example.com/original.webp",
    "session:https://media.example.com/original.webp"
  ]);
  assert.equal(resolved.captureMethod, "page-session");
  assert.equal(resolved.usedPixelFallback, false);
  assert.deepEqual(resolved.metadata, { width: 2048, height: 3072 });
});

test("denied media-domain access skips the page session and keeps the pixel fallback", async () => {
  const calls = [];
  const media = normalizePageCaptureCandidate({
    title: "拒绝额外权限",
    canonicalUrl: "https://example.com/work/denied",
    media: [{ id: "image", url: "https://media.example.com/image.webp", dataUrl: "data:image/webp;base64,AAAA" }]
  }).media[0];
  const resolved = await resolvePageCaptureImage(media, {
    sessionMediaAllowed: false,
    fetchMedia: async () => { calls.push("public"); throw new Error("denied"); },
    fetchSessionMedia: async () => { calls.push("session"); return new Blob(["unexpected"]); },
    decodeDataUrl: async () => { calls.push("pixels"); return new Blob(["pixels"], { type: "image/webp" }); }
  });
  assert.deepEqual(calls, ["public", "pixels"]);
  assert.equal(resolved.captureMethod, "pixel-fallback");
  assert.equal(normalizePageCaptureBatch({ sessionMediaAllowed: false }).sessionMediaAllowed, false);
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
  assert.deepEqual(confirmed.selections, [{ candidateId: "one", includeText: false, selectedMediaIds: ["one-image"], mediaDecision: "pending" }]);
  assert.deepEqual(applyPageCaptureSelections(confirmed)[0].media, []);
  const selected = applyPageCaptureSelections(normalizePageCaptureBatch({
    ...confirmed,
    selections: confirmed.selections.map((selection) => ({ ...selection, mediaDecision: "confirmed" }))
  }));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].contentText, "");
  assert.deepEqual(selected[0].media.map((item) => item.id), ["one-image"]);
  assert.deepEqual(pageCapturePermissionOrigins(selected), ["https://img.example.com/*"]);
});

test("page capture requests download access only for verified safe documents", () => {
  const candidate = normalizePageCaptureCandidate({
    id: "downloads",
    title: "文章下载区",
    canonicalUrl: "https://example.com/article",
    media: [
      { id: "brief", kind: "document", url: "https://files.example.com/brief.pdf", mimeType: "application/pdf" },
      { id: "archive", kind: "document", url: "https://unsafe.example.com/skill.zip", mimeType: "application/zip" }
    ]
  });
  assert.deepEqual(pageCapturePermissionOrigins([candidate]), ["https://files.example.com/*"]);
});

test("page capture selection ignores unknown candidates and media", () => {
  const candidates = [normalizePageCaptureCandidate({
    id: "known", title: "作品", canonicalUrl: "https://example.com/work",
    contentText: "正文", media: [{ id: "known-image", url: "https://img.example.com/a.jpg" }]
  })];
  assert.equal(normalizePageCaptureSelection({ candidateId: "missing", includeText: true }, candidates), null);
  assert.deepEqual(normalizePageCaptureSelection({
    candidateId: "known", includeText: true, selectedMediaIds: ["missing", "known-image"]
  }, candidates), { candidateId: "known", includeText: true, selectedMediaIds: ["known-image"], mediaDecision: "pending" });
});

test("page capture saves only the article sections the user explicitly chose", () => {
  const batch = normalizePageCaptureBatch({
    candidates: [{
      id: "article",
      title: "长文章",
      canonicalUrl: "https://example.com/article",
      contentText: "开场段落\n\n需要保留的核心段落\n\n结尾段落",
      contentHtml: "<p>开场段落</p><p>需要保留的核心段落</p><p>结尾段落</p>",
      textBlocks: [
        { id: "intro", text: "开场段落", html: "<p>开场段落</p>" },
        { id: "core", text: "需要保留的核心段落", html: "<p>需要保留的核心段落</p>" },
        { id: "outro", text: "结尾段落", html: "<p>结尾段落</p>" }
      ]
    }],
    selections: [{
      candidateId: "article",
      selectedTextBlockIds: ["core"],
      selectedMediaIds: [],
      mediaDecision: "none"
    }]
  });

  assert.deepEqual(batch.selections, [{
    candidateId: "article",
    includeText: true,
    selectedTextBlockIds: ["core"],
    selectedMediaIds: [],
    mediaDecision: "none"
  }]);
  const [selected] = applyPageCaptureSelections(batch);
  assert.equal(selected.contentText, "需要保留的核心段落");
  assert.equal(selected.contentHtml, "<p>需要保留的核心段落</p>");
});

test("creative sections merge adjacent fragments, hide weak page chrome and restore source order when saving", () => {
  const candidate = normalizePageCaptureCandidate({
    id: "creative-brief",
    title: "Project Aurora",
    canonicalUrl: "https://example.com/projects/aurora",
    contentText: "Project Aurora\n\n首页\n\nBrief\n\n一部关于三名水下清理员的动作喜剧。\n\n他们试图证明自己，却意外卷入一场远超预期的深海危机。\n\n评论",
    textBlocks: [
      { id: "title", text: "Project Aurora", html: "<h1>Project Aurora</h1>", kind: "heading", sourceOrder: 0 },
      { id: "nav", text: "首页", html: "<p>首页</p>", kind: "noise", sourceOrder: 1 },
      { id: "brief", text: "Brief", html: "<h2>Brief</h2>", kind: "heading", sourceOrder: 2 },
      { id: "body-a", text: "一部关于三名水下清理员的动作喜剧。", html: "<p>一部关于三名水下清理员的动作喜剧。</p>", sourceOrder: 3 },
      { id: "body-b", text: "他们试图证明自己，却意外卷入一场远超预期的深海危机。", html: "<p>他们试图证明自己，却意外卷入一场远超预期的深海危机。</p>", sourceOrder: 4 },
      { id: "comment", text: "评论", html: "<p>评论</p>", kind: "noise", sourceOrder: 5 }
    ]
  });

  assert.equal(candidate.textBlocks.length, 1);
  assert.match(candidate.textBlocks[0].text, /^Brief\n/u);
  assert.doesNotMatch(candidate.textBlocks[0].text, /首页|评论|Project Aurora/u);
  assert.deepEqual(candidate.possibleOmissions.map((item) => item.text), ["首页", "评论"]);

  const [selected] = applyPageCaptureSelections(normalizePageCaptureBatch({
    candidates: [candidate],
    selections: [{ candidateId: candidate.id, selectedTextBlockIds: [candidate.textBlocks[0].id], selectedMediaIds: [] }]
  }));
  assert.equal(selected.contentText, candidate.textBlocks[0].text);
});

test("creative-section preview rank never changes the saved page order", () => {
  const candidate = normalizePageCaptureCandidate({
    id: "ordered-brief",
    title: "Ordered brief",
    canonicalUrl: "https://example.com/ordered",
    textBlocks: [
      { text: "Brief", kind: "heading", sourceOrder: 0 },
      { text: "第一部分很短。", kind: "paragraph", sourceOrder: 1 },
      { text: "Prompt", kind: "heading", sourceOrder: 2 },
      { text: "第二部分更长，用于确保预览相关性排序与网页原始顺序不同。", kind: "paragraph", sourceOrder: 3 }
    ]
  });
  assert.match(candidate.textBlocks[0].text, /^Prompt/u);

  const [selected] = applyPageCaptureSelections(normalizePageCaptureBatch({
    candidates: [candidate],
    selections: [{
      candidateId: candidate.id,
      selectedTextBlockIds: candidate.textBlocks.map((item) => item.id),
      selectedMediaIds: []
    }]
  }));
  assert.match(selected.contentText, /^Brief/u);
  assert.match(selected.contentText, /第一部分[\s\S]*Prompt/u);
});

test("structured site content stays one clean creative section instead of being resegmented from the page shell", async () => {
  const injected = (0, eval)(`(${collectPageCaptureSnapshot.toString()})`);
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    chrome: globalThis.chrome,
    Readability: globalThis.Readability
  };
  const body = {
    innerText: "首页 发现 项目 Brief 评论 推荐 下载 分享 以及大量页面壳文字",
    scrollHeight: 800,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = { scrollX: 0, scrollY: 0, scrollTo: () => undefined };
  globalThis.document = {
    title: "Cully Hill Boys",
    body,
    documentElement: { scrollHeight: 800 },
    baseURI: "https://higgsfield.ai/projects/cully-hill-boys",
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode: () => ({})
  };
  globalThis.location = { hostname: "higgsfield.ai", href: "https://higgsfield.ai/projects/cully-hill-boys" };
  globalThis.chrome = undefined;
  globalThis.Readability = undefined;
  const siteData = {
    adapter: "higgsfield",
    pageKind: "detail",
    completeness: "complete",
    canonicalUrl: globalThis.location.href,
    title: "Cully Hill Boys",
    contentText: "This is the project brief for the Cully Hill Boys, our feature-length AI film.",
    media: [],
    sourceFacts: { provider: "higgsfield", extractionMethod: "structured" }
  };
  try {
    const result = normalizePageCaptureBatch(await injected({
      adapters: PAGE_CAPTURE_ADAPTERS,
      siteData,
      maxCandidates: 10,
      maxMedia: 10
    }));
    assert.equal(result.candidates[0].textBlocks.length, 1);
    assert.equal(result.candidates[0].textBlocks[0].text, siteData.contentText);
    assert.doesNotMatch(result.candidates[0].contentText, /首页|评论|推荐/u);

    body.innerText = "A complete visible project description remains available when the optional site enhancement is unavailable.";
    const genericFallback = normalizePageCaptureBatch(await injected({
      adapters: PAGE_CAPTURE_ADAPTERS,
      siteData: { ...siteData, contentText: "", completeness: "partial", sourceFacts: {} },
      maxCandidates: 10,
      maxMedia: 10
    }));
    assert.match(genericFallback.candidates[0].contentText, /complete visible project description/u);
  } finally {
    Object.assign(globalThis, original);
  }
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

test("Jimeng home uses structured works and never falls back to application-shell text", async () => {
  const injected = (0, eval)(`(${collectPageCaptureSnapshot.toString()})`);
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    chrome: globalThis.chrome,
    Readability: globalThis.Readability
  };
  const body = {
    innerText: "发现 技能 上传参考图 输入文字 图片生成 二维码",
    scrollHeight: 800,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = { scrollX: 0, scrollY: 0, scrollTo: () => undefined };
  globalThis.document = {
    title: "即梦AI - 一站式AI创作平台",
    body,
    documentElement: { scrollHeight: 800 },
    baseURI: "https://jimeng.jianying.com/ai-tool/home",
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode: () => ({})
  };
  globalThis.location = { hostname: "jimeng.jianying.com", href: "https://jimeng.jianying.com/ai-tool/home" };
  globalThis.chrome = undefined;
  globalThis.Readability = undefined;
  const siteData = {
    adapter: "jimeng",
    pageKind: "feed",
    completeness: "complete",
    candidates: [{
      id: "jimeng:7490123456789012345",
      pageType: "artwork",
      title: "AIGC大叔 · 2026-05-30",
      canonicalUrl: "https://jimeng.jianying.com/ai-tool/work-detail/7490123456789012345",
      contentText: "真实作品提示词",
      media: [{
        id: "jimeng:7490123456789012345:1",
        kind: "image",
        placement: "inline",
        url: "https://p3-dreamina-sign.byteimg.com/7490123456789012345.webp"
      }],
      sourceFacts: { provider: "jimeng", itemId: "7490123456789012345", author: "AIGC大叔" },
      extraction: { scope: "document", method: "structured" }
    }]
  };
  try {
    const result = await injected({ adapters: PAGE_CAPTURE_ADAPTERS, siteData, maxCandidates: 10, maxMedia: 10 });
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].contentText, "真实作品提示词");
    assert.doesNotMatch(result.candidates[0].contentText, /上传参考图|二维码/u);
    assert.deepEqual(pageCaptureDefaultMediaIds(result.candidates[0]), ["jimeng:7490123456789012345:1"]);

    const missing = await injected({
      adapters: PAGE_CAPTURE_ADAPTERS,
      siteData: { ...siteData, completeness: "partial", candidates: [] },
      maxCandidates: 10,
      maxMedia: 10
    });
    assert.deepEqual(missing.candidates, []);

    const krea = await injected({
      adapters: PAGE_CAPTURE_ADAPTERS,
      siteData: {
        ...siteData,
        adapter: "krea",
        candidates: [{
          ...siteData.candidates[0],
          id: "krea:554bfb91-2a06-5e91-8a21-24a162f3b81f",
          title: "Krea public artwork",
          sourceFacts: { provider: "krea", itemId: "554bfb91-2a06-5e91-8a21-24a162f3b81f" }
        }]
      },
      maxCandidates: 10,
      maxMedia: 10
    });
    assert.equal(krea.candidates[0].title, "Krea public artwork");
  } finally {
    Object.assign(globalThis, original);
  }
});

test("generic JSON-LD provides author, identity, publication time, engagement and structured original media", async () => {
  const injected = (0, eval)(`(${collectPageCaptureSnapshot.toString()})`);
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    chrome: globalThis.chrome,
    Readability: globalThis.Readability
  };
  const structured = {
    "@type": "ImageObject",
    name: "Structured artwork",
    identifier: "work-77",
    author: [{ "@type": "Person", name: "Structured Author" }],
    datePublished: "2026-08-01T12:00:00Z",
    image: { contentUrl: "https://cdn.example.com/original.webp", width: 2048, height: 3072 },
    interactionStatistic: [{ interactionType: { "@type": "LikeAction" }, userInteractionCount: 91 }]
  };
  const body = {
    innerText: "Structured prompt body",
    scrollHeight: 800,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = { scrollX: 0, scrollY: 0, scrollTo: () => undefined };
  globalThis.document = {
    title: "Fallback title",
    body,
    documentElement: { scrollHeight: 800 },
    baseURI: "https://example.com/work/77",
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'script[type="application/ld+json"]' ? [{ textContent: JSON.stringify(structured) }] : [],
    cloneNode: () => ({})
  };
  globalThis.location = { hostname: "example.com", href: "https://example.com/work/77" };
  globalThis.chrome = undefined;
  globalThis.Readability = undefined;
  try {
    const result = await injected({ adapters: [], maxCandidates: 10, maxMedia: 10 });
    const [candidate] = result.candidates;
    assert.equal(candidate.sourceFacts.author, "Structured Author");
    assert.equal(candidate.sourceFacts.itemId, "work-77");
    assert.equal(candidate.sourceFacts.publishedAt, "2026-08-01T12:00:00Z");
    assert.deepEqual(candidate.sourceFacts.engagement, { likes: 91 });
    assert.equal(candidate.media[0].url, "https://cdn.example.com/original.webp");
    assert.equal(candidate.media[0].sourceKind, "structured");
  } finally {
    Object.assign(globalThis, original);
  }
});

test("page capture prefers the user's live page selection and preserves its HTML", async () => {
  const injected = (0, eval)(`(${collectPageCaptureSnapshot.toString()})`);
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    chrome: globalThis.chrome,
    Readability: globalThis.Readability
  };
  const selectedText = "只保存用户选中的这一段";
  const selectionContainer = {
    innerHTML: "",
    appendChild: () => { selectionContainer.innerHTML = `<p>${selectedText}</p>`; }
  };
  const body = {
    innerText: "页面上还有很多用户没有选择的正文内容。",
    scrollHeight: 800,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  globalThis.window = {
    scrollX: 0,
    scrollY: 0,
    scrollTo: () => undefined,
    getSelection: () => ({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => selectedText,
      getRangeAt: () => ({ cloneContents: () => ({}) })
    })
  };
  globalThis.document = {
    title: "Selection fixture",
    body,
    documentElement: { scrollHeight: 800 },
    baseURI: "https://example.com/article",
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode: () => ({}),
    createElement: () => selectionContainer
  };
  globalThis.location = { hostname: "example.com", href: "https://example.com/article" };
  globalThis.chrome = undefined;
  globalThis.Readability = undefined;
  try {
    const result = await injected({ adapters: [], maxCandidates: 10, maxMedia: 10 });
    assert.equal(result.candidates[0].contentText, selectedText);
    assert.equal(result.candidates[0].contentHtml, `<p>${selectedText}</p>`);
    assert.equal(result.candidates[0].extraction.scope, "selection");
    const wholePage = await injected({ adapters: [], mode: "whole", maxScrollSteps: 1, maxCandidates: 10, maxMedia: 10 });
    assert.equal(wholePage.candidates[0].contentText, body.innerText);
    assert.equal(wholePage.candidates[0].extraction.scope, "document");
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

test("list capture can combine cases without losing per-media provenance", () => {
  const batch = normalizePageCaptureBatch({
    captureMode: "list",
    saveMode: "combined",
    targetCount: 2,
    stopReason: "target-reached",
    candidates: [
      {
        id: "work-a", title: "作品 A", canonicalUrl: "https://example.com/work/a", contentText: "Prompt A",
        sourceFacts: { author: "作者 A" },
        media: [{ id: "media-a", url: "https://cdn.example.com/a.jpg" }]
      },
      {
        id: "work-b", title: "作品 B", canonicalUrl: "https://example.com/work/b", contentText: "Prompt B",
        sourceFacts: { author: "作者 B" },
        media: [{ id: "media-b", url: "https://cdn.example.com/b.jpg" }]
      }
    ]
  });
  assert.equal(batch.captureMode, "list");
  assert.equal(batch.targetCount, 2);
  assert.equal(batch.saveMode, "combined");

  const combined = combinePageCaptureCandidates(batch.candidates, {
    title: "本次列表灵感",
    canonicalUrl: "https://example.com/gallery"
  });
  assert.equal(combined.title, "本次列表灵感");
  assert.match(combined.contentText, /作品 A[\s\S]*Prompt A[\s\S]*作品 B[\s\S]*Prompt B/u);
  assert.deepEqual(combined.media.map((item) => ({ title: item.sourceTitle, author: item.sourceAuthor, url: item.originalWorkUrl })), [
    { title: "作品 A", author: "作者 A", url: "https://example.com/work/a" },
    { title: "作品 B", author: "作者 B", url: "https://example.com/work/b" }
  ]);
  const stored = normalizeMediaAsset({
    id: "stored-media", kind: "image", sourceUrl: combined.media[0].url,
    sourceTitle: combined.media[0].sourceTitle,
    sourceAuthor: combined.media[0].sourceAuthor,
    originalWorkUrl: combined.media[0].originalWorkUrl
  });
  assert.deepEqual({ title: stored.sourceTitle, author: stored.sourceAuthor, url: stored.originalWorkUrl }, {
    title: "作品 A", author: "作者 A", url: "https://example.com/work/a"
  });
});

test("list capture inherits a representative structure without auto-accepting a different content shape", () => {
  const reference = {
    title: "作品一",
    canonicalUrl: "https://example.com/1",
    textBlocks: [{ id: "prompt", kind: "section", text: "创作提示" }],
    media: [{ id: "image", kind: "image", url: "https://example.com/1.webp" }],
    articleDocument: { version: 1, blocks: [
      { id: "prompt", kind: "paragraph", text: "创作提示", sourceOrder: 0 },
      { id: "image-block", kind: "image", assetId: "image", sourceOrder: 1 }
    ] }
  };
  assert.equal(pageCaptureStructureMatches(reference, {
    ...reference,
    title: "作品二",
    canonicalUrl: "https://example.com/2",
    media: [{ id: "other", kind: "image", url: "https://example.com/2.webp" }],
    articleDocument: { version: 1, blocks: [
      { id: "prompt-2", kind: "paragraph", text: "另一条创作提示", sourceOrder: 0 },
      { id: "image-block-2", kind: "image", assetId: "other", sourceOrder: 1 }
    ] }
  }), true);
  assert.equal(pageCaptureStructureMatches(reference, {
    ...reference,
    title: "混入的视频模块",
    canonicalUrl: "https://example.com/3",
    media: [{ id: "video", kind: "video", url: "https://example.com/3.mp4" }],
    articleDocument: { version: 1, blocks: [{ id: "video-block", kind: "video", assetId: "video", sourceOrder: 0 }] }
  }), false);
});
