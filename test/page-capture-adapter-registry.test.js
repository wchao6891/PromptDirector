import test from "node:test";
import assert from "node:assert/strict";

import {
  PAGE_CAPTURE_ADAPTERS,
  pageCaptureSupportMatrix,
  resolvePageCaptureAdapter
} from "../page-capture-adapter-registry.js";

test("the capture registry covers the requested public-site families without duplicate adapters", () => {
  const fixtures = new Map([
    ["https://www.behance.net/gallery/1/project", "behance"],
    ["https://dribbble.com/shots/1-project", "dribbble"],
    ["https://www.deviantart.com/artist/art/work-1", "deviantart"],
    ["https://www.designspiration.com/save/1", "designspiration"],
    ["https://huaban.com/pins/1", "huaban"],
    ["https://www.zcool.com.cn/work/1.html", "zcool"],
    ["https://500px.com/photo/1/work", "500px"],
    ["https://www.instagram.com/p/example/", "instagram"],
    ["https://www.flickr.com/photos/artist/1", "flickr"],
    ["https://www.pexels.com/photo/example-1/", "pexels"],
    ["https://imgur.com/gallery/example", "imgur"],
    ["https://weibo.com/1/example", "weibo"],
    ["https://web.okjike.com/originalPost/1", "jike"],
    ["https://user.qzone.qq.com/1/photo/1", "qzone"],
    ["https://www.douban.com/photos/album/1/", "douban"],
    ["https://www.poco.cn/works/detail_id1", "poco"],
    ["https://mp.weixin.qq.com/s/example", "wechat"],
    ["https://www.liblib.art/imageinfo/example", "liblibai"],
    ["https://www.krea.ai/feed/example-00000000-0000-0000-0000-000000000000", "krea"],
    ["https://higgsfield.ai/@creator/projects/example", "higgsfield"],
    ["https://item.jd.com/1.html", "jd"],
    ["https://item.taobao.com/item.htm?id=1", "taobao"],
    ["https://detail.tmall.com/item.htm?id=1", "tmall"],
    ["https://detail.1688.com/offer/1.html", "1688"],
    ["https://shop.mogujie.com/detail/1", "mogujie"],
    ["https://www.architecturaldigest.com/story/example", "architectural-digest"],
    ["https://www.archiproducts.com/en/products/example", "archiproducts"],
    ["https://www.houzz.com/photos/example-phvw-vp~1", "houzz"],
    ["https://www.housebeautiful.com/design-inspiration/a1/example/", "house-beautiful"],
    ["https://officesnapshots.com/2026/01/01/example/", "officesnapshots"],
    ["https://www.archilovers.com/projects/1/example.html", "archilovers"],
    ["https://www.archdaily.com/1/example", "archdaily"],
    ["https://www.archdaily.cn/cn/1/example", "archdaily-cn"],
    ["https://www.dezeen.com/2026/01/01/example/", "dezeen"],
    ["https://interiordesign.net/projects/example/", "interior-design"]
  ]);

  for (const [url, expected] of fixtures) {
    assert.equal(resolvePageCaptureAdapter(url).id, expected, url);
  }
  assert.equal(new Set(PAGE_CAPTURE_ADAPTERS.map((item) => item.id)).size, PAGE_CAPTURE_ADAPTERS.length);
  assert.equal(resolvePageCaptureAdapter("https://yesand.ai/prompt/example").id, "generic");
});

test("platform adapters are detected from public page signals on custom domains", () => {
  assert.equal(resolvePageCaptureAdapter("https://studio.example/work", {
    metas: { generator: "WordPress 6.8" }
  }).id, "wordpress");
  assert.equal(resolvePageCaptureAdapter("https://portfolio.example/work", {
    scripts: ["https://static.parastorage.com/services/wix-thunderbolt/dist/main.js"]
  }).id, "wix");
  assert.equal(resolvePageCaptureAdapter("https://journal.example/work", {
    links: ["https://assets.squarespace.com/universal/scripts-compressed/common.js"]
  }).id, "squarespace");
  assert.equal(resolvePageCaptureAdapter("https://essay.example/work", {
    metas: { applicationName: "Medium" }
  }).id, "medium");
});

test("support matrix never promotes unverified selectors to dedicated support", () => {
  const matrix = pageCaptureSupportMatrix();
  assert.equal(matrix.find((item) => item.id === "jimeng").support, "verified-deep");
  assert.equal(matrix.find((item) => item.id === "liblibai").support, "verified-deep");
  assert.equal(matrix.find((item) => item.id === "krea").support, "verified-declarative");
  assert.equal(matrix.find((item) => item.id === "higgsfield").support, "verified-declarative");
  assert.equal(matrix.find((item) => item.id === "wechat").support, "verified-declarative");
  assert.equal(matrix.find((item) => item.id === "behance").support, "verified-declarative");
  assert.equal(matrix.find((item) => item.id === "pinterest").support, "verified-deep");
  assert.equal(matrix.find((item) => item.id === "dribbble").support, "generic");
  assert.equal(matrix.every((item) => ["generic", "verified-declarative", "verified-deep"].includes(item.support)), true);
});

test("X exposes a truthful status permalink and handle instead of using the first link", () => {
  const adapter = PAGE_CAPTURE_ADAPTERS.find((item) => item.id === "x");
  assert.deepEqual(adapter.fields.canonicalUrl, ["a[href*='/status/']"]);
  assert.deepEqual(adapter.fields.handle, ["[data-testid=User-Name] a[href^='/']"]);
});
