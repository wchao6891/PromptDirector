import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeMediaReference,
  detectMediaReferenceProvider,
  officialMediaEmbedUrl,
  parseOpenGraphMetadata,
  resolveMediaReference
} from "../media-reference-resolver.js";

test("common social video URLs are recognized and tracking parameters are removed", () => {
  const fixtures = [
    ["https://youtu.be/abc123?si=tracking", "youtube", "https://www.youtube.com/watch?v=abc123"],
    ["https://vimeo.com/12345?share=copy", "vimeo", "https://vimeo.com/12345"],
    ["https://www.bilibili.com/video/BV1abc/?spm_id_from=333&p=2", "bilibili", "https://www.bilibili.com/video/BV1abc/?p=2"],
    ["https://v.douyin.com/abc123/?utm_source=test", "douyin", "https://v.douyin.com/abc123/"],
    ["https://twitter.com/director/status/123?s=20", "x", "https://x.com/director/status/123"]
  ];
  for (const [url, provider, canonical] of fixtures) {
    assert.equal(detectMediaReferenceProvider(url), provider);
    assert.equal(canonicalizeMediaReference(url), canonical);
  }
});

test("Bilibili page and official player URLs normalize to one playable reference", () => {
  const fixtures = [
    ["https://player.bilibili.com/player.html?bvid=BV1B7411m7LV&p=3&autoplay=1", "https://www.bilibili.com/video/BV1B7411m7LV/?p=3"],
    ["https://www.bilibili.com/video/av170001?p=2", "https://www.bilibili.com/video/av170001/?p=2"],
    ["https://player.bilibili.com/player.html?aid=170001&cid=279786&p=2", "https://www.bilibili.com/video/av170001/?p=2"]
  ];
  for (const [input, canonical] of fixtures) assert.equal(canonicalizeMediaReference(input), canonical);
  assert.equal(
    officialMediaEmbedUrl("https://player.bilibili.com/player.html?bvid=BV1B7411m7LV&p=3", "bilibili"),
    "https://player.bilibili.com/player.html?bvid=BV1B7411m7LV&p=3&autoplay=0&poster=1"
  );
  assert.equal(
    officialMediaEmbedUrl("https://www.bilibili.com/video/av170001/?p=2", "bilibili"),
    "https://player.bilibili.com/player.html?aid=170001&p=2&autoplay=0&poster=1"
  );
  assert.equal(
    officialMediaEmbedUrl("https://x.com/director/status/123", "x"),
    "https://platform.twitter.com/embed/Tweet.html?id=123&dnt=true"
  );
});

test("media playback capability starts from honest provider state", async () => {
  const youtube = await resolveMediaReference("https://www.youtube.com/watch?v=SaFcBmd_r3M", {});
  assert.equal(youtube.playback.status, "permission-required");
  assert.equal(youtube.playback.embedUrl, "https://www.youtube-nocookie.com/embed/SaFcBmd_r3M?enablejsapi=1&playsinline=1");
  const bilibili = await resolveMediaReference("https://www.bilibili.com/video/BV1B7411m7LV", {});
  assert.equal(bilibili.playback.status, "loading");
  assert.match(bilibili.playback.embedUrl, /^https:\/\/player\.bilibili\.com\/player\.html\?/);
});

test("permission denial and metadata failure keep a saveable reference without invented fields", async () => {
  const denied = await resolveMediaReference("https://www.bilibili.com/video/BV1abc", {
    requestOrigins: async () => false,
    fetch: async () => { throw new Error("must not fetch"); }
  });
  assert.equal(denied.metadataStatus, "permission-denied");
  assert.equal(denied.title, "");
  assert.equal(denied.posterUrl, "");

  const unavailable = await resolveMediaReference("https://v.douyin.com/abc", {
    requestOrigins: async () => true,
    fetch: async () => { throw new Error("offline"); }
  });
  assert.equal(unavailable.metadataStatus, "unavailable");
  assert.equal(unavailable.canonicalUrl, "https://v.douyin.com/abc");
});

test("public metadata resolves title, author and poster while blocking cross-provider short-link redirects", async () => {
  const resolved = await resolveMediaReference("https://www.bilibili.com/video/BV1abc", {
    requestOrigins: async () => true,
    fetch: async () => new Response('<meta property="og:title" content="示例视频"><meta property="og:image" content="https://i.example/poster.jpg"><meta name="author" content="创作者">', {
      status: 200,
      headers: { "content-type": "text/html" }
    })
  });
  assert.equal(resolved.metadataStatus, "resolved");
  assert.equal(resolved.title, "示例视频");
  assert.equal(resolved.author, "创作者");
  assert.equal(resolved.posterUrl, "https://i.example/poster.jpg");
  assert.equal(resolved.playbackMode, "embed");

  const redirected = await resolveMediaReference("https://b23.tv/abc", {
    requestOrigins: async () => true,
    fetch: async () => ({
      ok: true,
      url: "https://evil.example/watch",
      headers: { get: () => null },
      text: async () => '<meta property="og:title" content="伪造">'
    })
  });
  assert.equal(redirected.metadataStatus, "unavailable");
  assert.equal(redirected.canonicalUrl, "https://b23.tv/abc");
});

test("Open Graph parser accepts property order variants", () => {
  assert.deepEqual(parseOpenGraphMetadata('<meta content="封面标题" property="og:title"><meta name="author" content="作者">'), {
    title: "封面标题", author: "作者", posterUrl: "", durationMs: 0
  });
});
