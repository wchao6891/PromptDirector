import test from "node:test";
import assert from "node:assert/strict";
import { collectPageCaptureSitePayload, normalizePageCaptureSitePayload, isTrustedPageCaptureMediaUrl } from "../extension/page-capture-site-adapters.js";

const options = { maxCandidates: 100, maxMedia: 24, maxTextCharacters: 100000 };
const workId = "7490123456789012345";
const imageUrl = "https://p26-dreamina-sign.byteimg.com/work-original.png";
const videoUrl = "https://v9-artist.vlabvod.com/work/video/";
const imageWork = (id = workId) => ({
  commonAttr: { id, createTime: 1786000000 },
  author: { name: "当前分类作者", uid: "public-author" },
  text2imageParams: { prompt: "第一段提示词\n第二段提示词" },
  modelInfo: { modelName: "图片 4.7" },
  statistic: { favoriteNum: 103, usageNum: 12 },
  image: { largeImages: [{ imageUrl, width: 1440, height: 2560 }] },
  permission: { privateToken: "not-part-of-capture" }
});
const fiberElement = (props) => ({ __reactFiber$fixture: { memoizedProps: props, return: null } });

function inPage({ path = "/ai-tool/explore", items = [], root, body = {}, initial = [] }, run) {
  const saved = { location: globalThis.location, document: globalThis.document,
    __get_explore_result: globalThis.__get_explore_result };
  const feed = root === undefined ? fiberElement({ pageState: { feedItems: items } }) : root;
  globalThis.location = { hostname: "jimeng.jianying.com", pathname: path };
  globalThis.document = { scripts: [], body,
    querySelector: () => feed,
    querySelectorAll: () => [] };
  globalThis.__get_explore_result = { data: { item_list: initial } };
  try { return run(globalThis.document); }
  finally { Object.assign(globalThis, saved); }
}

const read = () => (0, eval)(`(${collectPageCaptureSitePayload.toString()})`)(options);

test("redesigned explore captures the active category instead of stale initial recommendations", () => {
  const stale = { common_attr: { id: "7490123456789012346" }, author: { name: "旧分类" } };
  inPage({ items: [imageWork()], initial: [stale] }, () => {
    const payload = read();
    assert.equal(payload.pageKind, "feed");
    assert.deepEqual(payload.items.map(item => item.common_attr.id), [workId]);
    assert.equal(JSON.stringify(payload).includes("privateToken"), false);
    const result = normalizePageCaptureSitePayload(payload);
    assert.equal(result.candidates[0].contentText, "第一段提示词\n第二段提示词");
    assert.equal(result.candidates[0].sourceFacts.author, "当前分类作者");
    assert.equal(result.candidates[0].sourceFacts.model, "图片 4.7");
    assert.equal(result.candidates[0].media[0].url, imageUrl);
    assert.equal(result.candidates[0].media[0].width, 1440);
  });
});

test("empty or still-loading current category never falls back to another category", () => {
  for (const root of [fiberElement({ pageState: { feedItems: [] } }), {}]) {
    inPage({ root, initial: [{ common_attr: { id: workId }, author: { name: "旧分类" } }] }, () => {
      assert.equal(read().items.length, 0);
      assert.equal(read().status, "partial");
    });
  }
});

test("detail opened over a feed captures exactly the matching work and its full original image group", () => {
  const work = imageWork();
  work.image.largeImages.push({ imageUrl: "https://p11-dreamina-sign.byteimg.com/second.png", width: 2048, height: 2048 });
  inPage({ path: `/ai-tool/work-detail/${workId}`, items: [imageWork("7490123456789012346"), work] }, () => {
    const result = normalizePageCaptureSitePayload(read());
    assert.equal(result.candidates.length, 1);
    assert.equal(result.sourceFacts.itemId, workId);
    assert.equal(result.media.length, 2);
  });
});

test("short films keep original video and description without inventing an original prompt", () => {
  const work = imageWork();
  delete work.image;
  delete work.text2imageParams;
  work.commonAttr.title = "品牌短片";
  work.commonAttr.description = "第一段剧情介绍\n第二段剧情介绍";
  work.commonAttr.coverUrl = "https://p9-heycan-hgt-sign.byteimg.com/cover.webp";
  work.video = { duration: 90, originVideo: { videoUrl, width: 1920, height: 1080 } };
  inPage({ items: [work] }, () => {
    const candidate = normalizePageCaptureSitePayload(read()).candidates[0];
    assert.equal(candidate.contentText, work.commonAttr.description);
    assert.equal(candidate.sourceFacts.originalPromptAvailable, false);
    assert.equal(candidate.media[0].originalPrompt, "");
    assert.equal(candidate.media[0].kind, "video");
    assert.equal(candidate.media[0].url, videoUrl);
    assert.equal(candidate.media[0].sourceKind, "site-original");
    assert.equal(candidate.media[0].posterUrl, work.commonAttr.coverUrl);
  });
  assert.equal(isTrustedPageCaptureMediaUrl("jimeng", "https://v9-artist.vlabvod.com.evil.example/a.mp4"), false);
});

test("direct image detail reads only its visible dialog and does not collect hidden background works", () => {
  const picture = { currentSrc: imageUrl, naturalWidth: 1440, naturalHeight: 2560 };
  const dialog = { getClientRects: () => [{}],
    innerText: "当前作者\n关注\n103\n2026-07-12 内容由 AI 生成\n图片提示词\n当前作品提示词\n图片 4.7\n9:16\n做同款",
    querySelectorAll: selector => selector === "img" ? [picture] : [] };
  inPage({ path: `/ai-tool/work-detail/${workId}`, root: null, body: { innerText: "后台推荐污染" } }, (doc) => {
    doc.querySelectorAll = selector => selector === '[role="dialog"]' ? [dialog] : [{ currentSrc: "https://p3-dreamina-sign.byteimg.com/wrong.png", naturalWidth: 500, naturalHeight: 500 }];
    const candidate = normalizePageCaptureSitePayload(read());
    assert.equal(candidate.contentText, "当前作品提示词");
    assert.deepEqual(candidate.media.map(media => media.url), [imageUrl]);
  });
});

test("direct short-film detail reads exact player data without requiring a background feed", () => {
  const heading = fiberElement({ data: { id: workId, title: "品牌短片", author: { name: "作者" },
    videoUrl, durationMs: 90000 }, favoriteAction: { count: 12 } });
  const dialog = { getClientRects: () => [{}], querySelectorAll: selector => selector === "h1,h2" ? [heading] : [] };
  inPage({ path: `/ai-tool/work-detail/${workId}`, root: null }, doc => {
    doc.querySelectorAll = () => [dialog];
    const candidate = normalizePageCaptureSitePayload(read());
    assert.equal(candidate.title, "品牌短片");
    assert.equal(candidate.media[0].sourceKind, "video-element");
    assert.equal(candidate.media[0].duration, 90);
    assert.equal(candidate.completeness, "partial");
  });
});

test("batch scan scrolls the actual inner list and restores the user's reading position", async () => {
  const { collectPageCaptureSnapshot, PAGE_CAPTURE_ADAPTERS } = await import("../extension/page-capture.js");
  const original = Object.fromEntries(["window", "document", "location", "chrome", "Readability", "getComputedStyle", "requestAnimationFrame"].map(key => [key, globalThis[key]]));
  const positions = [];
  const body = { innerText: "探索", scrollHeight: 800, querySelector: () => null, querySelectorAll: () => [] };
  const scroller = { parentElement: body, scrollHeight: 4000, clientHeight: 600, scrollTop: 350, scrollLeft: 12,
    scrollTo({ top, left }) { if (top !== undefined) this.scrollTop = top; if (left !== undefined) this.scrollLeft = left; positions.push(this.scrollTop); } };
  const feed = { parentElement: scroller };
  globalThis.window = { scrollX: 0, scrollY: 0, innerHeight: 800, scrollTo: () => {} };
  globalThis.document = { body, title: "探索", images: [], documentElement: { scrollHeight: 800 },
    querySelector: selector => selector === '[aria-label="Explore content"]' ? feed : null,
    querySelectorAll: () => [], cloneNode: () => ({}) };
  globalThis.location = { hostname: "jimeng.jianying.com", href: "https://jimeng.jianying.com/ai-tool/explore" };
  globalThis.chrome = undefined;
  globalThis.Readability = undefined;
  globalThis.getComputedStyle = () => ({ overflowY: "auto" });
  globalThis.requestAnimationFrame = callback => callback();
  try {
    const result = await collectPageCaptureSnapshot({ mode: "whole", adapters: PAGE_CAPTURE_ADAPTERS,
      maxCandidates: 100, maxMedia: 24, maxScrollSteps: 30,
      siteData: { adapter: "jimeng", pageKind: "feed", candidates: [], completeness: "partial" } });
    assert.equal(result.adapter, "jimeng");
    assert.ok(positions.some(top => top === 3400), "must reach inner-list bottom, not the stationary window bottom");
    assert.equal(scroller.scrollTop, 350);
    assert.equal(scroller.scrollLeft, 12);
    assert.equal(positions.at(-1), 350);
  } finally { Object.assign(globalThis, original); }
});

test("direct detail restores original media from SSR after the router consumes its runtime data", () => {
  const work = imageWork();
  inPage({ path: `/ai-tool/work-detail/${workId}`, root: null }, doc => {
    doc.scripts = [{ textContent: `window._ROUTER_DATA = ${JSON.stringify({ loaderData: {
      "ai-tool/work-detail/(id$)/page": { workDetail: { ok: true, value: work } }
    } })};` }];
    const candidate = normalizePageCaptureSitePayload(read());
    assert.equal(candidate.media[0].url, imageUrl);
    assert.equal(candidate.media[0].width, 1440);
    assert.equal(candidate.media[0].height, 2560);
    assert.equal(candidate.media[0].sourceKind, "site-original");
    assert.equal(candidate.sourceFacts.author, work.author.name);
  });
});

test("stale SSR work never replaces the current detail ID", () => {
  inPage({ path: `/ai-tool/work-detail/${workId}`, root: null }, doc => {
    doc.scripts = [{ textContent: `window._ROUTER_DATA = ${JSON.stringify({ loaderData: {
      "ai-tool/work-detail/(id$)/page": { workDetail: { ok: true, value: imageWork("7490123456789012346") } }
    } })};` }];
    assert.deepEqual(read().items, []);
  });
});
