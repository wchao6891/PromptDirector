import test from "node:test";
import assert from "node:assert/strict";

import {
  collectPageCaptureSitePayload,
  installPageCaptureSiteObserver,
  isTrustedPageCaptureMediaUrl,
  normalizePageCaptureSitePayload
} from "../page-capture-site-adapters.js";

test("Jimeng structured payload restores author, prompt, model, time, metrics and original media", () => {
  const normalized = normalizePageCaptureSitePayload({
    adapter: "jimeng",
    workId: "7490123456789012345",
    modelNames: { jimeng_v40: "即梦 4.0" },
    item: {
      common_attr: { id: "7490123456789012345", title: "孟菲斯光线4", create_time: 1786000000 },
      author: { name: "金戈米良", uid: "creator-7" },
      aigc_image_params: { text2image_params: { prompt: "平面影像，低饱和度，动态模糊的光线。" } },
      aigc_draft: { content: JSON.stringify({ component_list: [{ abilities: { generate: { core_param: { model: "jimeng_v40" } } } }] }) },
      statistic: { favorite_num: 103, usage_num: 12 },
      image: { large_images: [{ image_url: "https://p3-dreamina-sign.byteimg.com/original.webp?x=1", width: 2160, height: 3840 }] }
    }
  }, "https://jimeng.jianying.com/ai-tool/work-detail/7490123456789012345");

  assert.equal(normalized.contentText, "平面影像，低饱和度，动态模糊的光线。");
  assert.equal(normalized.sourceFacts.author, "金戈米良");
  assert.equal(normalized.sourceFacts.model, "即梦 4.0");
  assert.equal(normalized.sourceFacts.itemId, "7490123456789012345");
  assert.equal(normalized.sourceFacts.dimensions, "2160×3840");
  assert.deepEqual(normalized.sourceFacts.engagement, { favorites: 103, uses: 12 });
  assert.equal(normalized.media[0].variants[0].sourceKind, "site-original");
  assert.equal(normalized.completeness, "complete");
});

test("Jimeng observer keeps a bounded sanitized feed without request credentials", () => {
  const injected = (0, eval)(`(${installPageCaptureSiteObserver.toString()})`);
  const original = {
    location: globalThis.location,
    fetch: globalThis.fetch,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    __get_explore_result: globalThis.__get_explore_result,
    __image_generate_model_config__: globalThis.__image_generate_model_config__
  };
  globalThis.location = { hostname: "jimeng.jianying.com", href: "https://jimeng.jianying.com/ai-tool/home" };
  globalThis.fetch = undefined;
  globalThis.XMLHttpRequest = undefined;
  globalThis.__get_explore_result = { data: { item_list: [
    { common_attr: { id: "7490123456789012345" }, private_token: "must-not-survive", image: { large_images: [] } },
    { common_attr: { id: "7490123456789012346" }, request_headers: { cookie: "must-not-survive" }, image: { large_images: [] } }
  ] } };
  try {
    const result = injected({ maxCandidates: 1, maxMedia: 1 });
    const state = globalThis.__PROMPTDIRECTOR_JIMENG_CAPTURE__;
    assert.equal(result.installed, true);
    assert.equal(state.items.length, 1);
    assert.equal(state.items[0].common_attr.id, "7490123456789012346");
    assert.equal("private_token" in state.items[0], false);
    assert.equal("request_headers" in state.items[0], false);
  } finally {
    delete globalThis.__PROMPTDIRECTOR_JIMENG_CAPTURE__;
    Object.assign(globalThis, original);
  }
});

test("Jimeng parser rejects lookalike media hosts and remains explicitly partial when page data is absent", () => {
  assert.equal(isTrustedPageCaptureMediaUrl("jimeng", "https://p3-dreamina-sign.byteimg.com/a.webp"), true);
  assert.equal(isTrustedPageCaptureMediaUrl("jimeng", "https://p3-dreamina-sign.byteimg.com.evil.example/a.webp"), false);
  assert.equal(isTrustedPageCaptureMediaUrl("krea", "https://gen.krea.ai/images/public.png"), true);
  assert.equal(isTrustedPageCaptureMediaUrl("krea", "https://gen.krea.ai.evil.example/public.png"), false);
  assert.equal(isTrustedPageCaptureMediaUrl("higgsfield", "https://d2ol7oe51mr4n9.cloudfront.net/public.webp"), true);
  assert.equal(isTrustedPageCaptureMediaUrl("higgsfield", "https://random.cloudfront.net/public.webp"), false);
  assert.equal(isTrustedPageCaptureMediaUrl("pinterest", "https://i.pinimg.com/originals/public.gif"), true);
  assert.equal(isTrustedPageCaptureMediaUrl("pinterest", "https://i.pinimg.com.evil.example/public.gif"), false);
  const partial = normalizePageCaptureSitePayload({ adapter: "jimeng", workId: "7490123456789012345", status: "partial" }, "https://jimeng.jianying.com/ai-tool/work-detail/7490123456789012345");
  assert.equal(partial.completeness, "partial");
  assert.equal(partial.sourceFacts.author, undefined);
});

test("the main-world Jimeng reader is self-contained and parses assigned JSON without evaluating scripts", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  globalThis.location = { hostname: "jimeng.jianying.com", pathname: "/ai-tool/work-detail/7490123456789012345" };
  globalThis.document = { scripts: [{ textContent: `window.__get_explore_result=${JSON.stringify({ data: { item_list: [{ common_attr: { id: "7490123456789012345" } }] } })};` }] };
  try {
    const result = injected();
    assert.equal(result.item.common_attr.id, "7490123456789012345");
    assert.doesNotMatch(collectPageCaptureSitePayload.toString(), /eval\(|new Function/u);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("Jimeng home is a feed, never a fake work named home", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  globalThis.location = { hostname: "jimeng.jianying.com", pathname: "/ai-tool/home" };
  globalThis.document = {
    scripts: [{ textContent: `window.__get_explore_result=${JSON.stringify({ data: { item_list: [
      { common_attr: { id: "7490123456789012345" } },
      { common_attr: { id: "7490123456789012346" } }
    ] } })};` }]
  };
  try {
    const result = injected();
    assert.equal(result.pageKind, "feed");
    assert.equal(result.workId, "");
    assert.deepEqual(result.items.map((item) => item.common_attr.id), ["7490123456789012345", "7490123456789012346"]);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("Jimeng feed normalization emits one real candidate per work", () => {
  const item = (id, author) => ({
    extra: { template_type: "image" },
    common_attr: { id, create_time: 1786000000 },
    author: { name: author, uid: `${id}-author` },
    aigc_image_params: { text2image_params: { prompt: `${author}的提示词` } },
    image: { large_images: [{ image_url: `https://p3-dreamina-sign.byteimg.com/${id}.webp`, width: 2048, height: 2048 }] }
  });
  const normalized = normalizePageCaptureSitePayload({
    adapter: "jimeng",
    pageKind: "feed",
    items: [item("7490123456789012345", "作者甲"), item("7490123456789012346", "作者乙")]
  }, "https://jimeng.jianying.com/ai-tool/home");

  assert.equal(normalized.pageKind, "feed");
  assert.equal(normalized.candidates.length, 2);
  assert.equal(normalized.candidates[0].sourceFacts.itemId, "7490123456789012345");
  assert.equal(normalized.candidates[0].sourceFacts.author, "作者甲");
  assert.equal(normalized.candidates[0].media[0].placement, "inline");
  assert.notEqual(normalized.candidates[0].title, "即梦AI - 一站式AI创作平台");
});

test("direct Jimeng detail falls back to the visible work panel without inventing site identity", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  globalThis.location = { hostname: "jimeng.jianying.com", pathname: "/ai-tool/work-detail/7490123456789012345" };
  globalThis.document = {
    scripts: [],
    body: {
      innerText: [
        "AIGC大叔",
        "+ 关注",
        "87",
        "2026-05-30 | 内容由 AI 生成",
        "图片提示词",
        "敦煌文化主题场景，全景，暗黑风。",
        "图片 4.7 | 9:16 | 更多",
        "做同款",
        "用作参考图"
      ].join("\n")
    },
    querySelectorAll: () => []
  };
  try {
    const payload = injected({ maxCandidates: 100, maxMedia: 24, maxTextCharacters: 16 * 1024 * 1024 });
    const normalized = normalizePageCaptureSitePayload(payload, "https://jimeng.jianying.com/ai-tool/work-detail/7490123456789012345");
    assert.equal(normalized.sourceFacts.author, "AIGC大叔");
    assert.equal(normalized.sourceFacts.model, "4.7");
    assert.equal(normalized.sourceFacts.publishedAt.slice(0, 10), "2026-05-30");
    assert.equal(normalized.sourceFacts.engagement.favorites, 87);
    assert.equal(normalized.contentText, "敦煌文化主题场景，全景，暗黑风。");
    assert.equal(normalized.title, "AIGC大叔 · 2026-05-30");
  } finally {
    Object.assign(globalThis, original);
  }
});

test("LiblibAI public work state keeps creator, prompts, model stack, metrics and original media", () => {
  const pageUrl = "https://www.liblib.art/imageinfo/f6c920410dd74d37b6680a1ad90dfd53";
  const mediaUrl = "https://liblibai-online.liblib.cloud/img/public/original.png";
  const normalized = normalizePageCaptureSitePayload({
    adapter: "liblibai",
    canonicalUrl: pageUrl,
    data: {
      uuid: "f6c920410dd74d37b6680a1ad90dfd53",
      title: "公开作品标题",
      createTime: "2024-10-23T08:47:54.000+00:00",
      counter: { likeCount: 23, commentCount: 4, hitCount: 208 },
      images: [{
        id: 5205767,
        originalImageUrl: mediaUrl,
        imageUrl: "https://images-wm.liblib.cloud/img/public/watermark.png",
        width: 1200,
        height: 2048,
        generateInfo: { prompt: "公开正向提示词", negativePrompt: "公开负向提示词" },
        models: [
          { modelName: "F.1 基础模型", versionName: "v1" },
          { modelName: "细节 LoRA", versionName: "v2" }
        ]
      }]
    },
    author: { nickname: "脱敏作者", uuid: "public-author-id" }
  }, pageUrl);

  assert.equal(normalized.adapter, "liblibai");
  assert.equal(normalized.contentText, "公开正向提示词");
  assert.equal(normalized.sourceFacts.author, "脱敏作者");
  assert.equal(normalized.sourceFacts.handle, "public-author-id");
  assert.equal(normalized.sourceFacts.model, "F.1 基础模型 v1 · 细节 LoRA v2");
  assert.equal(normalized.sourceFacts.dimensions, "1200×2048");
  assert.deepEqual(normalized.sourceFacts.engagement, { likes: 23, comments: 4, views: 208 });
  assert.equal(normalized.media[0].url, mediaUrl);
  assert.equal(normalized.media[0].sourceKind, "site-original");
  assert.equal(normalized.completeness, "complete");
});

test("LiblibAI collector reads only bounded public Next data from an image detail", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  const pageData = {
    props: { pageProps: {
      data: {
        uuid: "f6c920410dd74d37b6680a1ad90dfd53",
        title: "公开作品标题",
        createTime: "2024-10-23T08:47:54.000+00:00",
        counter: { likeCount: 23 },
        images: [{
          id: 5205767,
          originalImageUrl: "https://liblibai-online.liblib.cloud/img/public/original.png",
          imageUrl: "https://images-wm.liblib.cloud/img/public/watermark.png",
          width: 1200,
          height: 2048,
          generateInfo: { prompt: "公开正向提示词", metainformation: "must-not-survive" },
          models: [{ modelName: "F.1 基础模型", versionName: "v1", privatePath: "must-not-survive" }]
        }]
      },
      authorInfo: { userDetail: { nickname: "脱敏作者", uuid: "public-author-id", mobile: "must-not-survive" } }
    } }
  };
  globalThis.location = {
    hostname: "www.liblib.art",
    pathname: "/imageinfo/f6c920410dd74d37b6680a1ad90dfd53",
    href: "https://www.liblib.art/imageinfo/f6c920410dd74d37b6680a1ad90dfd53"
  };
  globalThis.document = {
    querySelector: (selector) => selector === "#__NEXT_DATA__" ? { textContent: JSON.stringify(pageData) } : null,
    querySelectorAll: () => [],
    scripts: []
  };
  try {
    const payload = injected({ maxCandidates: 20, maxMedia: 8, maxTextCharacters: 10000 });
    assert.equal(payload.adapter, "liblibai");
    assert.equal(payload.data.images.length, 1);
    assert.equal(payload.data.images[0].generateInfo.prompt, "公开正向提示词");
    assert.equal(JSON.stringify(payload).includes("must-not-survive"), false);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("Krea public gallery detail keeps the full prompt, UUID, date, dimensions and original image", () => {
  const pageUrl = "https://www.krea.ai/feed/vintage-film-portrait-554bfb91-2a06-5e91-8a21-24a162f3b81f";
  const mediaUrl = "https://gen.krea.ai/images/554bfb91-2a06-5e91-8a21-24a162f3b81f.png";
  const normalized = normalizePageCaptureSitePayload({
    adapter: "krea",
    pageKind: "detail",
    canonicalUrl: pageUrl,
    prompt: "A close-up vintage film portrait with warm sunlight and heavy grain.",
    jsonLd: [{
      "@type": "ImageObject",
      name: "A close-up vintage film portrait...",
      url: pageUrl,
      contentUrl: mediaUrl,
      datePublished: "2026-05-13T06:47:52.874Z",
      width: 768,
      height: 1376
    }]
  }, pageUrl);

  assert.equal(normalized.adapter, "krea");
  assert.equal(normalized.contentText, "A close-up vintage film portrait with warm sunlight and heavy grain.");
  assert.equal(normalized.sourceFacts.itemId, "554bfb91-2a06-5e91-8a21-24a162f3b81f");
  assert.equal(normalized.sourceFacts.publishedAt, "2026-05-13T06:47:52.874Z");
  assert.equal(normalized.sourceFacts.dimensions, "768×1376");
  assert.equal(normalized.media[0].url, mediaUrl);
  assert.equal(normalized.completeness, "complete");
});

test("Krea gallery feed emits bounded real artwork candidates instead of application-shell text", () => {
  const normalized = normalizePageCaptureSitePayload({
    adapter: "krea",
    pageKind: "feed",
    items: [{
      itemId: "72324387-04f9-526e-ae96-e132f34ab60c",
      canonicalUrl: "https://www.krea.ai/feed/a-vivid-green-praying-mantis-72324387-04f9-526e-ae96-e132f34ab60c",
      title: "a vivid green praying mantis",
      imageUrl: "https://gen.krea.ai/images/72324387-04f9-526e-ae96-e132f34ab60c.png"
    }]
  }, "https://www.krea.ai/feed");

  assert.equal(normalized.pageKind, "feed");
  assert.equal(normalized.candidates.length, 1);
  assert.equal(normalized.candidates[0].sourceFacts.itemId, "72324387-04f9-526e-ae96-e132f34ab60c");
  assert.equal(normalized.candidates[0].media[0].sourceKind, "site-original");
  assert.equal(normalized.candidates[0].completeness, "partial");
});

test("Krea collector reads a public detail prompt and ImageObject without application state", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  const pageUrl = "https://www.krea.ai/feed/vintage-film-portrait-554bfb91-2a06-5e91-8a21-24a162f3b81f";
  const imageObject = {
    "@context": "https://schema.org",
    "@type": "ImageObject",
    name: "Vintage film portrait",
    url: pageUrl,
    contentUrl: "https://gen.krea.ai/images/554bfb91-2a06-5e91-8a21-24a162f3b81f.png",
    datePublished: "2026-05-13T06:47:52.874Z",
    width: 768,
    height: 1376,
    privateSession: "must-not-survive"
  };
  globalThis.location = { hostname: "www.krea.ai", pathname: new URL(pageUrl).pathname, href: pageUrl };
  globalThis.document = {
    querySelector: (selector) => selector === "article h1" ? { textContent: "A complete public image prompt." } : null,
    querySelectorAll: (selector) => selector === 'script[type="application/ld+json"]'
      ? [{ textContent: JSON.stringify(imageObject) }]
      : []
  };
  try {
    const payload = injected({ maxCandidates: 20, maxMedia: 8, maxTextCharacters: 10000 });
    assert.equal(payload.adapter, "krea");
    assert.equal(payload.pageKind, "detail");
    assert.equal(payload.prompt, "A complete public image prompt.");
    assert.equal(payload.jsonLd[0].contentUrl, imageObject.contentUrl);
    assert.equal(JSON.stringify(payload).includes("must-not-survive"), false);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("Krea collector converts only observed gallery cards to their verified original URL", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  const itemId = "72324387-04f9-526e-ae96-e132f34ab60c";
  const href = `/feed/a-vivid-green-praying-mantis-${itemId}`;
  const imageNode = {
    style: { backgroundImage: `image-set(url("https://optim-images.krea.ai/https---gen-krea-ai-images-${itemId}-png-512.webp") 1x, url("https://optim-images.krea.ai/https---gen-krea-ai-images-${itemId}-png-1024.webp") 2x)` }
  };
  globalThis.location = { hostname: "www.krea.ai", pathname: "/feed", href: "https://www.krea.ai/feed" };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector.startsWith('script[type=')
      ? []
      : [{ href, querySelector: () => imageNode, getAttribute: () => href }]
  };
  try {
    const payload = injected({ maxCandidates: 1, maxMedia: 8, maxTextCharacters: 10000 });
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].itemId, itemId);
    assert.equal(payload.items[0].imageUrl, `https://gen.krea.ai/images/${itemId}.png`);
    assert.equal(payload.items[0].title, "a vivid green praying mantis");
  } finally {
    Object.assign(globalThis, original);
  }
});

test("Higgsfield project keeps public creator, project brief, date, metrics and artwork", () => {
  const pageUrl = "https://higgsfield.ai/@public-creator/projects/anime-production";
  const mediaUrl = "https://d2ol7oe51mr4n9.cloudfront.net/public/project-cover.webp";
  const normalized = normalizePageCaptureSitePayload({
    adapter: "higgsfield",
    pageKind: "detail",
    canonicalUrl: pageUrl,
    brief: "A cinematic anime production brief with deliberate lighting and motion.",
    jsonLd: [{
      "@type": "CreativeWork",
      name: "Anime Production",
      description: "Public project description",
      url: pageUrl,
      author: { "@type": "Person", name: "Public Creator", alternateName: "@public-creator", identifier: "creator-public-id" },
      datePublished: "2026-06-18T12:30:00.000Z",
      image: mediaUrl,
      interactionStatistic: [
        { interactionType: { "@type": "ViewAction" }, userInteractionCount: 812 },
        { interactionType: { "@type": "LikeAction" }, userInteractionCount: 37 }
      ]
    }]
  }, pageUrl);

  assert.equal(normalized.adapter, "higgsfield");
  assert.equal(normalized.title, "Anime Production");
  assert.equal(normalized.contentText, "A cinematic anime production brief with deliberate lighting and motion.");
  assert.equal(normalized.sourceFacts.author, "Public Creator");
  assert.equal(normalized.sourceFacts.handle, "public-creator");
  assert.equal(normalized.sourceFacts.itemId, "public-creator/anime-production");
  assert.equal(normalized.sourceFacts.publishedAt, "2026-06-18T12:30:00.000Z");
  assert.deepEqual(normalized.sourceFacts.engagement, { likes: 37, views: 812 });
  assert.equal(normalized.media[0].url, mediaUrl);
  assert.equal(normalized.completeness, "complete");
});

test("Higgsfield public community ItemList emits projects without page-shell copy", () => {
  const normalized = normalizePageCaptureSitePayload({
    adapter: "higgsfield",
    pageKind: "feed",
    canonicalUrl: "https://higgsfield.ai/community",
    jsonLd: [{
      "@type": "ItemList",
      itemListElement: [{
        position: 1,
        item: {
          "@type": "CreativeWork",
          name: "Fashion Motion Study",
          description: "A public motion project.",
          url: "https://higgsfield.ai/@public-creator/projects/fashion-motion-study",
          author: { name: "Public Creator", alternateName: "@public-creator" },
          image: "https://d2ol7oe51mr4n9.cloudfront.net/public/fashion-cover.webp"
        }
      }]
    }]
  }, "https://higgsfield.ai/community");

  assert.equal(normalized.pageKind, "feed");
  assert.equal(normalized.candidates.length, 1);
  assert.equal(normalized.candidates[0].sourceFacts.author, "Public Creator");
  assert.equal(normalized.candidates[0].sourceFacts.itemId, "public-creator/fashion-motion-study");
  assert.equal(normalized.candidates[0].title, "Fashion Motion Study");
  assert.doesNotMatch(normalized.candidates[0].contentText, /create|sign in|pricing/iu);
});

test("Higgsfield collector exposes only bounded public CreativeWork JSON-LD and the project brief", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  const pageUrl = "https://higgsfield.ai/@public-creator/projects/anime-production";
  const creativeWork = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: "Anime Production",
    description: "Public project description",
    url: pageUrl,
    author: { "@type": "Person", name: "Public Creator", alternateName: "@public-creator", privateToken: "must-not-survive" },
    datePublished: "2026-06-18T12:30:00.000Z",
    image: "https://d2ol7oe51mr4n9.cloudfront.net/public/project-cover.webp",
    interactionStatistic: [{ interactionType: { "@type": "ViewAction" }, userInteractionCount: 812 }],
    accountSession: "must-not-survive"
  };
  globalThis.location = { hostname: "higgsfield.ai", pathname: "/@public-creator/projects/anime-production", href: pageUrl };
  globalThis.document = {
    querySelector: (selector) => selector === '[aria-label^="Project brief:"]'
      ? { innerText: "A cinematic anime production brief." }
      : null,
    querySelectorAll: (selector) => selector === 'script[type="application/ld+json"]'
      ? [{ textContent: JSON.stringify(creativeWork) }]
      : []
  };
  try {
    const payload = injected({ maxCandidates: 20, maxMedia: 8, maxTextCharacters: 10000 });
    assert.equal(payload.adapter, "higgsfield");
    assert.equal(payload.pageKind, "detail");
    assert.equal(payload.brief, "A cinematic anime production brief.");
    assert.equal(payload.jsonLd[0].author.name, "Public Creator");
    assert.equal(JSON.stringify(payload).includes("must-not-survive"), false);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("Behance VisualArtwork keeps project owners, description, identity, metrics and cover media", () => {
  const pageUrl = "https://www.behance.net/gallery/252610351/Cantor8";
  const mediaUrl = "https://mir-s3-cdn-cf.behance.net/projects/404/e4dcec252610351.Y3JvcCwxODQwLDE0MzksMCww.jpg";
  const normalized = normalizePageCaptureSitePayload({
    adapter: "behance",
    pageKind: "detail",
    canonicalUrl: pageUrl,
    jsonLd: [{
      "@type": "VisualArtwork",
      name: "Cantor8",
      description: "A public digital-design project description.",
      url: pageUrl,
      identifier: 252610351,
      image: mediaUrl,
      creator: [
        { "@type": "Person", identifier: 173435329, name: "Public Owner One", url: "https://www.behance.net/publicownerone" },
        { "@type": "Person", identifier: 1443573125, name: "Public Owner Two", url: "https://www.behance.net/publicownertwo" }
      ],
      interactionStatistic: [
        { interactionType: "http://schema.org/LikeAction", userInteractionCount: 766 },
        { interactionType: "http://schema.org/WatchAction", userInteractionCount: 8565 }
      ]
    }]
  }, pageUrl);

  assert.equal(normalized.adapter, "behance");
  assert.equal(normalized.sourceFacts.itemId, "252610351");
  assert.equal(normalized.sourceFacts.author, "Public Owner One, Public Owner Two");
  assert.equal(normalized.sourceFacts.handle, "publicownerone");
  assert.deepEqual(normalized.sourceFacts.engagement, { likes: 766, views: 8565 });
  assert.equal(normalized.media[0].url, mediaUrl);
  assert.equal(normalized.media[0].sourceKind, "structured");
  assert.equal(normalized.completeness, "complete");
});

test("Behance collector reads only the public VisualArtwork schema from a project page", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  const pageUrl = "https://www.behance.net/gallery/252610351/Cantor8";
  const artwork = {
    "@context": "http://schema.org",
    "@type": "VisualArtwork",
    name: "Cantor8",
    description: "A public digital-design project description.",
    url: pageUrl,
    identifier: 252610351,
    image: "https://mir-s3-cdn-cf.behance.net/projects/404/e4dcec252610351.Y3JvcCwxODQwLDE0MzksMCww.jpg",
    creator: [{ "@type": "Person", identifier: 173435329, name: "Public Owner", url: "https://www.behance.net/publicowner", email: "must-not-survive" }],
    interactionStatistic: [{ "@type": "InteractionCounter", interactionType: "http://schema.org/LikeAction", userInteractionCount: 766 }],
    privateSession: "must-not-survive"
  };
  globalThis.location = { hostname: "www.behance.net", pathname: "/gallery/252610351/Cantor8", href: pageUrl };
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: (selector) => selector === 'script[type="application/ld+json"]'
      ? [{ textContent: JSON.stringify(artwork) }]
      : []
  };
  try {
    const payload = injected({ maxCandidates: 20, maxMedia: 8, maxTextCharacters: 10000 });
    assert.equal(payload.adapter, "behance");
    assert.equal(payload.jsonLd[0].creator[0].name, "Public Owner");
    assert.equal(JSON.stringify(payload).includes("must-not-survive"), false);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("Pinterest Pin keeps the public creator, timestamp, description and original media variants", () => {
  const pageUrl = "https://www.pinterest.com/pin/579205202062276414/";
  const originalUrl = "https://i.pinimg.com/originals/0d/d6/0c/public-pin.gif";
  const normalized = normalizePageCaptureSitePayload({
    adapter: "pinterest",
    pageKind: "detail",
    canonicalUrl: pageUrl,
    pin: {
      entityId: "579205202062276414",
      title: "2026 Web Design Trends to Watch For",
      description: "A public design-inspiration Pin description.",
      createdAt: "Sat, 21 Dec 2019 21:27:05 +0000",
      author: { fullName: "Public Pinner", username: "publicpinner" },
      repins: 14,
      images: {
        original: { url: originalUrl },
        large: { url: "https://i.pinimg.com/1200x/0d/d6/0c/public-pin.jpg", width: 1200, height: 592 },
        display: { url: "https://i.pinimg.com/736x/0d/d6/0c/public-pin.jpg", width: 600, height: 296 }
      }
    }
  }, pageUrl);

  assert.equal(normalized.adapter, "pinterest");
  assert.equal(normalized.sourceFacts.itemId, "579205202062276414");
  assert.equal(normalized.sourceFacts.author, "Public Pinner");
  assert.equal(normalized.sourceFacts.handle, "publicpinner");
  assert.equal(normalized.sourceFacts.publishedAt, "2019-12-21T21:27:05.000Z");
  assert.deepEqual(normalized.sourceFacts.engagement, { repins: 14 });
  assert.equal(normalized.media[0].url, originalUrl);
  assert.deepEqual(normalized.media[0].variants.map((variant) => variant.sourceKind), ["site-original", "responsive", "current"]);
  assert.equal(normalized.completeness, "complete");
});

test("Pinterest collector sanitizes one public Pin relay payload without retaining request context", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  const pageUrl = "https://www.pinterest.com/pin/579205202062276414/";
  const response = { data: { v3GetPinQueryv2: { data: {
    entityId: "579205202062276414",
    gridTitle: "2026 Web Design Trends to Watch For",
    gridDescription: "A public design-inspiration Pin description.",
    createdAt: "Sat, 21 Dec 2019 21:27:05 +0000",
    nativeCreator: { fullName: "Public Pinner", username: "publicpinner", websiteUrl: "must-not-survive" },
    images_orig: { url: "https://i.pinimg.com/originals/0d/d6/0c/public-pin.gif" },
    images_1200x: { url: "https://i.pinimg.com/1200x/0d/d6/0c/public-pin.jpg", width: 1200, height: 592 },
    images_736x: { url: "https://i.pinimg.com/736x/0d/d6/0c/public-pin.jpg", width: 600, height: 296 },
    trackingParams: "must-not-survive"
  } } } };
  globalThis.location = { hostname: "www.pinterest.com", pathname: "/pin/579205202062276414/", href: pageUrl };
  globalThis.document = {
    scripts: [{ textContent: `window.__PWS_RELAY_REGISTER_COMPLETED_REQUEST__("%7B%22pinId%22%3A%22579205202062276414%22%7D", ${JSON.stringify(response)});` }],
    querySelector: (selector) => selector.includes("pinterestapp:repins") ? { content: "14" } : null,
    querySelectorAll: () => []
  };
  try {
    const payload = injected({ maxCandidates: 20, maxMedia: 8, maxTextCharacters: 10000 });
    assert.equal(payload.adapter, "pinterest");
    assert.equal(payload.pin.author.username, "publicpinner");
    assert.equal(payload.pin.images.original.url, "https://i.pinimg.com/originals/0d/d6/0c/public-pin.gif");
    assert.equal(JSON.stringify(payload).includes("must-not-survive"), false);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("WeChat public article fields retain account, publication time, body and delayed originals", () => {
  const pageUrl = "https://mp.weixin.qq.com/s/example";
  const normalized = normalizePageCaptureSitePayload({
    adapter: "wechat",
    canonicalUrl: pageUrl,
    title: "视觉案例周刊",
    author: "AI Art Works",
    publishedAt: "2026-08-01T08:00:00+08:00",
    contentText: "第一段公开正文\n\n第二段公开正文",
    images: [{
      url: "https://mmbiz.qpic.cn/mmbiz_jpg/example/0?wx_fmt=jpeg",
      width: 1080,
      height: 1440,
      alt: "案例作品"
    }]
  }, pageUrl);

  assert.equal(normalized.pageType, "article");
  assert.equal(normalized.title, "视觉案例周刊");
  assert.equal(normalized.sourceFacts.author, "AI Art Works");
  assert.equal(normalized.sourceFacts.publishedAt, "2026-08-01T00:00:00.000Z");
  assert.equal(normalized.contentText, "第一段公开正文\n\n第二段公开正文");
  assert.equal(normalized.media[0].variants[0].sourceKind, "site-original");
});

test("site collectors expose only bounded public DOM and JSON-LD data outside Jimeng", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  const content = {
    innerText: "公开文章正文",
    querySelectorAll: () => [{
      currentSrc: "https://mmbiz.qpic.cn/mmbiz_jpg/example/0?wx_fmt=jpeg",
      src: "",
      naturalWidth: 1080,
      naturalHeight: 1440,
      alt: "案例作品",
      getAttribute: (name) => ({ "data-src": "https://mmbiz.qpic.cn/mmbiz_jpg/example/0?wx_fmt=jpeg", "data-w": "1080" })[name] || ""
    }]
  };
  globalThis.location = { hostname: "mp.weixin.qq.com", pathname: "/s/example", href: "https://mp.weixin.qq.com/s/example" };
  globalThis.document = {
    scripts: [],
    querySelector: (selector) => ({
      "#js_content": content,
      "#activity-name": { textContent: "视觉案例周刊" },
      "#js_name": { textContent: "AI Art Works" },
      "#publish_time": { textContent: "2026-08-01 08:00" }
    })[selector] || null
  };
  try {
    const payload = injected({ maxCandidates: 100, maxMedia: 24, maxTextCharacters: 16 * 1024 * 1024 });
    assert.equal(payload.adapter, "wechat");
    assert.equal(payload.images.length, 1);
    assert.equal(payload.title, "视觉案例周刊");
    assert.equal("cookie" in payload, false);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("YesAnd has no dedicated collector and falls through to the generic page engine", () => {
  const injected = (0, eval)(`(${collectPageCaptureSitePayload.toString()})`);
  const original = { location: globalThis.location, document: globalThis.document };
  globalThis.location = { hostname: "yesand.ai", pathname: "/prompt/example", href: "https://yesand.ai/prompt/example" };
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [], scripts: [] };
  try {
    assert.equal(injected({ maxCandidates: 20, maxMedia: 8, maxTextCharacters: 10000 }), null);
  } finally {
    Object.assign(globalThis, original);
  }
});
