import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  SHARE_PREVIEW_FOUNDATION_FILENAME,
  SHARE_PREVIEW_HTML_FILENAME,
  SHARE_PREVIEW_MASONRY_FILENAME,
  SHARE_PREVIEW_RUNTIME_FILENAME,
  renderSharePreviewHtml,
  renderSharePreviewMasonryJs,
  renderSharePreviewRuntimeJs
} from "../share-preview.js";
import { createDefaultFacetCatalog } from "../facets.js";
import { CONTENT_IDS, createDefaultTaxonomy } from "../taxonomy.js";

const iconSprite = readFileSync(new URL("../assets/ui-icons.svg", import.meta.url), "utf8");
const previewOptions = Object.freeze({
  iconSprite,
  installUrl: "https://chromewebstore.google.com/detail/iahakaahijddcjjldidbclicedibgpjm",
  sourceUrl: "https://github.com/wchao6891/PromptDirector"
});

test("share preview uses the current visual foundation and exposes the read-only library path safely", () => {
  const html = renderSharePreviewHtml([
    {
      id: "case-one",
      title: "Fog <script>alert(1)</script>",
      text: "Tracking shot & warm light",
      url: "https://example.com/reference?id=1&view=full",
      savedAt: "2026-07-18T10:00:00.000Z",
      screenshotPath: "images/case-one.webp",
      classification: { pathIds: [CONTENT_IDS.promptVideo], status: "confirmed" },
      palette: { colors: ["#123456", "not-a-color"] }
    },
    {
      id: "case-two",
      title: "Unsafe source",
      text: "Keep the subject centered",
      url: "javascript:alert(1)",
      savedAt: "2026-07-19T10:00:00.000Z"
    }
  ], { libraryTitle: "Director <Archive>" }, createDefaultTaxonomy(), createDefaultFacetCatalog(), previewOptions);

  assert.match(html, /<!doctype html>/i);
  assert.match(html, new RegExp(`href="${SHARE_PREVIEW_FOUNDATION_FILENAME.replace(".", "\\.")}"`));
  assert.match(html, /<symbol id="icon-x"/);
  assert.match(html, /<use href="#icon-x">/);
  assert.match(html, /--visual-wall-gap:2px;--visual-card-radius:2px/);
  assert.match(html, /\.case-card:hover,\.related-card:hover\{box-shadow:none\}/);
  assert.match(html, /\.case-card::after,\.related-card::after\{[^}]*border:1px solid transparent/);
  assert.match(html, /\.case-card:focus-visible::after,\.related-card:focus-visible::after\{[^}]*border-width:2px/);
  assert.match(html, /\.fallback-cover\.audio\{background:linear-gradient\(160deg,var\(--ui-raised\),var\(--ui-surface\)\)\}/);
  assert.match(html, /\.eyebrow,\.fallback-cover small,[^}]*\{color:var\(--ui-text\)\}/);
  assert.match(html, /设置 → 界面与资料库 → 导入分享包/);
  assert.match(html, /data-zh="视觉创作灵感库" data-en="Visual Inspiration Library"/);
  assert.match(html, /提示词导演，你的视觉创作私人灵感库。/);
  assert.match(html, /class="app-footer"/);
  assert.match(html, /安装到 Chrome/);
  assert.match(html, /chromewebstore\.google\.com\/detail\/iahakaahijddcjjldidbclicedibgpjm/);
  assert.match(html, /查看源码/);
  assert.match(html, /github\.com\/wchao6891\/PromptDirector/);
  assert.match(html, /class="case-grid"/);
  assert.match(html, /id="detail-view"/);
  assert.match(html, /class="detail-image-frame"/);
  assert.doesNotMatch(html, /class="lightbox-link"|<button[^>]*disabled[^>]*>\s*<img/);
  assert.match(html, /data-copy-prompt=/);
  assert.match(html, /images\/case-one\.webp/);
  assert.match(html, /Fog &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /https:\/\/example\.com\/reference\?id=1&amp;view=full/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /not-a-color/);
  assert.match(html, /视频提示词/);
  assert.match(html, /data-en="Video prompt"/);
  assert.match(html, /id="search"/);
  assert.match(html, /id="content-type"/);
  assert.match(html, /id="locale"/);
  assert.match(html, /id="theme"/);
  assert.match(html, /media-src 'self'/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, new RegExp(`<script src="${SHARE_PREVIEW_MASONRY_FILENAME}" defer><\\/script>`));
  assert.match(html, new RegExp(`<script src="${SHARE_PREVIEW_RUNTIME_FILENAME}" defer><\\/script>`));
  assert.doesNotMatch(html, /<script>(?:.|\n)*<\/script>/);

  const runtime = renderSharePreviewRuntimeJs();
  assert.match(runtime, /applyFilters/);
  assert.match(runtime, /openDetail/);
  assert.match(runtime, /navigator\.clipboard/);
  assert.match(runtime, /createStableMasonry/);
  assert.match(runtime, /addEventListener/);
  assert.doesNotMatch(runtime, /fetch|XMLHttpRequest|WebSocket|sendBeacon/);
});

test("share preview can start in English dark mode without changing case text", () => {
  const html = renderSharePreviewHtml([
    { id: "case-one", title: "用户标题", text: "用户提示词", classification: { pathIds: [CONTENT_IDS.promptImage], status: "confirmed" } }
  ], { libraryTitle: "私人项目" }, createDefaultTaxonomy(), createDefaultFacetCatalog(), { ...previewOptions, locale: "en", theme: "dark" });
  assert.match(html, /<html lang="en" data-locale="en" data-theme="dark">/);
  assert.match(html, /This is a read-only package that works offline/);
  assert.match(html, />Visual Inspiration Library</);
  assert.match(html, />PromptDirector, your private visual inspiration library\.</);
  assert.match(html, /用户标题/);
  assert.match(html, /用户提示词/);
});

test("English share preview resolves only system library titles", () => {
  const systemHtml = renderSharePreviewHtml([], { libraryTitle: "视觉创作灵感库" }, createDefaultTaxonomy(), createDefaultFacetCatalog(), { ...previewOptions, locale: "en" });
  const customHtml = renderSharePreviewHtml([], { libraryTitle: "我的导演项目" }, createDefaultTaxonomy(), createDefaultFacetCatalog(), { ...previewOptions, locale: "en" });
  assert.match(systemHtml, /<h1>Visual Inspiration Library<\/h1>/);
  assert.match(customHtml, /<h1>我的导演项目<\/h1>/);
});

test("share preview renders every portable media kind and its time notes", () => {
  const html = renderSharePreviewHtml([{
    id: "mixed",
    title: "Mixed case",
    text: "Prompt",
    mediaAssets: [
      { id: "image", kind: "image", storageMode: "managed", mimeType: "image/webp", assetPath: "images/mixed/image.webp", width: 800, height: 1200 },
      { id: "video", kind: "video", storageMode: "managed", mimeType: "video/mp4", assetPath: "videos/mixed/video.mp4", posterAssetId: "poster" },
      { id: "poster", kind: "image", usage: "poster", storageMode: "managed", mimeType: "image/webp", assetPath: "images/mixed/poster.webp", derivedFromAssetId: "video" },
      { id: "audio", kind: "audio", storageMode: "managed", mimeType: "audio/mpeg", sourceFormat: "mp3", byteSize: 5242880, assetPath: "audio/mixed/theme.mp3", sourceTitle: "Theme.mp3" },
      { id: "document", kind: "document", storageMode: "managed", mimeType: "application/x-subrip", sourceFormat: "srt", byteSize: 2048, assetPath: "documents/mixed/subtitle.srt", sourceTitle: "Subtitle.srt" },
      { id: "source", kind: "attachment", storageMode: "managed", mimeType: "image/vnd.adobe.photoshop", sourceFormat: "psd", byteSize: 10485760, assetPath: "attachments/mixed/artwork.psd", sourceTitle: "Artwork.psd" },
      { id: "font", kind: "attachment", storageMode: "managed", mimeType: "font/otf", sourceFormat: "otf", byteSize: 4096, assetPath: "attachments/mixed/typeface.otf", sourceTitle: "Typeface.otf" }
    ],
    primaryMediaId: "video",
    timeNotes: [{ id: "note", assetId: "video", startMs: 1250, endMs: 3400, text: "镜头加速" }]
  }], { libraryTitle: "Archive" }, createDefaultTaxonomy(), createDefaultFacetCatalog(), previewOptions);

  assert.match(html, /<video controls preload="metadata" poster="images\/mixed\/poster\.webp">/);
  assert.match(html, /<audio controls preload="metadata">/);
  assert.match(html, /audio\/mixed\/theme\.mp3/);
  assert.match(html, /documents\/mixed\/subtitle\.srt/);
  assert.match(html, /attachments\/mixed\/artwork\.psd/);
  assert.match(html, /attachments\/mixed\/typeface\.otf/);
  assert.match(html, /SRT · 2 KiB/);
  assert.match(html, /PSD · 10\.0 MiB/);
  assert.match(html, /下载源文件/);
  assert.match(html, /href="attachments\/mixed\/artwork\.psd" download/);
  assert.match(html, /时间笔记/);
  assert.match(html, /0:01–0:03/);
  assert.match(html, /镜头加速/);
});

test("share preview shows reconstruction prompts without a redundant visual-description section", () => {
  const entries = ["one", "two"].map((id) => ({
    id,
    title: `Visual ${id}`,
    text: "",
    mediaAssets: [{
      id: `image-${id}`,
      kind: "image",
      storageMode: "managed",
      mimeType: "image/webp",
      assetPath: `images/${id}.webp`,
      palette: { colors: ["#123456", "#345678"] },
      visionAnalysis: {
        version: 2,
        reconstructionPrompt: id === "one" ? "青绿色雾气中的古代庭院，完整重建构图与光色。" : "青绿色夜色中的庭院，完整重建构图与光色。",
        tags: [{ tagId: "facet:style:cinematic", label: "电影感" }],
        imageFingerprint: `${id}-fingerprint`
      }
    }],
    primaryMediaId: `image-${id}`
  }));
  const html = renderSharePreviewHtml(entries, { libraryTitle: "Archive" }, createDefaultTaxonomy(), createDefaultFacetCatalog(), previewOptions);
  assert.doesNotMatch(html, /画面描述|Visual description/);
  assert.match(html, /青绿色雾气中的古代庭院，完整重建构图与光色/);
  assert.match(html, /data-copy-prompt="青绿色雾气中的古代庭院，完整重建构图与光色。"/);
  assert.match(html, /相关案例/);
  assert.match(html, /仅在本分享包内推荐/);
});

test("share preview adapts the current stable masonry implementation for offline classic scripts", () => {
  const source = readFileSync(new URL("../stable-masonry.js", import.meta.url), "utf8");
  const runtime = renderSharePreviewMasonryJs(source);
  assert.match(runtime, /globalThis\.createStableMasonry = function createStableMasonry/);
  assert.match(runtime, /\.case-card:not\(\[hidden\]\)/);
  assert.doesNotMatch(runtime, /export function createStableMasonry/);
});
