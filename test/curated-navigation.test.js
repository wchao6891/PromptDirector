import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function sources() {
  const [library, page, html, css] = await Promise.all([
    readFile(new URL("../library.js", import.meta.url), "utf8"),
    readFile(new URL("../curated-page.js", import.meta.url), "utf8"),
    readFile(new URL("../curated.html", import.meta.url), "utf8"),
    readFile(new URL("../curated.css", import.meta.url), "utf8")
  ]);
  return { library, page, html, css };
}

test("curated discovery stays in one extension tab and returns to the private library", async () => {
  const { library, page, html } = await sources();
  assert.match(library, /navigateWithinPromptDirector\("curated\.html"\)/);
  assert.match(html, /<button id="return-library"/);
  assert.match(html, /data-i18n="返回案例库"/);
  assert.match(page, /location\.assign\(chrome\.runtime\.getURL\("library\.html"\)\)/);
  assert.doesNotMatch(page, /chrome\.tabs\.(?:create|update|remove)|openerTabId/);
});

test("curated discovery keeps the pack wall concise and opens a separate read-only case detail", async () => {
  const { page, html, css } = await sources();
  assert.match(html, /id="curated-search"/);
  assert.match(html, /id="filter-button"/);
  assert.match(html, /data-sort="recommended"/);
  assert.match(html, /data-sort="latest"/);
  assert.match(html, /data-sort="downloads"/);
  assert.match(html, /<dialog id="detail-dialog"/);
  assert.match(html, /id="case-detail-drawer"/);
  assert.match(html, /id="case-detail-prev"/);
  assert.match(html, /id="case-detail-next"/);
  assert.doesNotMatch(html, /save-theme|theme-grid|themes-view|cases-view|更多|版本|更新日期|摘要/);
  assert.match(page, /element\("article", "pack-card"\)/);
  assert.match(page, /element\("h2", "", item\.title\)/);
  assert.match(page, /meta\.append\(element\("span", "", item\.author\), element\("span", "", `\$\{item\.caseCount\}/);
  assert.match(page, /actions\.append\(download, follow, copyLink\)/);
  assert.doesNotMatch(page, /Composer|composer|以此创作|openComposer|promptVersions/);
  const detail = page.slice(page.indexOf("function renderDetail"), page.indexOf("function createCaseCard"));
  assert.doesNotMatch(detail, /item\.summary|packageVersion|updatedAt/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) clamp\(360px, 31vw, 450px\)/);
  assert.match(css, /\.case-detail-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(380px, 34vw, 480px\)/);
});

test("package cases reuse the stable masonry and the whole image card opens detail", async () => {
  const { page, css } = await sources();
  assert.match(page, /import \{ createStableMasonry \} from "\.\/stable-masonry\.js"/);
  assert.match(page, /const CURATED_CASE_PAGE_SIZE = 24/);
  assert.match(page, /createStableMasonry\(list, \{\s*scrollContainer: elements\.detailDialog/);
  const card = page.slice(page.indexOf("function createCaseCard"), page.indexOf("function openCaseDetail"));
  assert.match(card, /card\.addEventListener\("click", open\)/);
  assert.match(card, /openCaseDetail\(item, entry, card\)/);
  assert.doesNotMatch(card, /case-footer|case-actions|iconButton/);
  assert.match(css, /\.case-list\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.case-card\s*\{[^}]*position:\s*absolute/);
  assert.doesNotMatch(css, /\.case-list\s*\{[^}]*display:\s*grid/);
});

test("case detail preserves real media ratio and isolates focus from the package", async () => {
  const { page, html, css } = await sources();
  assert.match(html, /id="case-detail-drawer"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(css, /\.case-detail-figure img\s*\{[^}]*width:\s*auto;[^}]*height:\s*auto;[^}]*max-width:\s*100%;[^}]*max-height:\s*100dvh;[^}]*object-fit:\s*contain/);
  assert.match(css, /\.case-detail-video\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*contain/);
  assert.match(page, /image\.width = entry\.width/);
  assert.match(page, /image\.height = entry\.height/);
  assert.match(page, /setPackageDetailInert\(true\)/);
  assert.match(page, /setPackageDetailInert\(false\)/);
  assert.match(page, /elements\.detailContent\.inert = inert/);
  assert.match(page, /t\("图片加载失败"\)/);
});

test("search, filters, ordering, following and public deep links use public metadata only", async () => {
  const { page } = await sources();
  assert.match(page, /loadAllPreviews\(\)/);
  assert.match(page, /entry\.title, entry\.author, entry\.text/);
  assert.match(page, /typeFilters\.includes\(item\.type\)/);
  assert.match(page, /state\.following\.has\(item\.authorId\)/);
  assert.match(page, /curatedFollowingAuthors/);
  assert.match(page, /right\.updatedAt/);
  assert.match(page, /state\.metrics\.downloads\[right\.id\]/);
  assert.match(page, /elements\.sortDownloads\.disabled = !state\.metrics/);
  assert.match(page, /url\.searchParams\.set\("pack", id\)/);
  assert.match(page, /new URL\(CURATED_PUBLIC_SITE_URL\)/);
  assert.match(page, /curatedSourceKey\(\{\s*curatedOrigin: \{ packageId: item\.packageId, sourceEntryId: previewEntry\.id \}/);
  assert.doesNotMatch(page, /粉丝|like|comment|浏览量/);
});

test("preview prompts stay inert and package bytes are verified before curated imports", async () => {
  const { page } = await sources();
  assert.match(page, /element\("pre", "case-detail-prompt", entry\.text/);
  assert.match(page, /copyCasePrompt\(entry, copy\)/);
  assert.doesNotMatch(page, /innerHTML|insertAdjacentHTML|eval\(|new Function/);
  const verifiedArchive = page.slice(page.indexOf("async function loadVerifiedArchive"), page.indexOf("async function loadPackageIndex"));
  assert.match(verifiedArchive, /verifyCuratedPackageBlob\(archive, item\.sha256\)/);
  const save = page.slice(page.indexOf("async function savePreviewCase"), page.indexOf("function openSavedCase"));
  assert.match(save, /saveCuratedSelection\(item, \[previewEntry\.id\]/);
  assert.match(save, /prepareCuratedEntriesPackage/);
  assert.match(save, /prepareCuratedEntryPackage/);
  assert.match(save, /reader\.read\(mediaPaths/);
  assert.match(page, /PREVIEW_CURATED_IMPORT/);
  assert.match(page, /APPLY_CURATED_IMPORT/);
  assert.match(page, /entriesBySourceEntryId/);
  assert.match(page, /readResponseBlobWithProgress/);
  assert.match(page, /stage: "downloading"/);
  assert.match(page, /stage: "verifying"/);
  assert.match(page, /stage: "saving"/);
});
