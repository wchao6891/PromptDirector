import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("composer combines cases and Skills in one reference workspace while keeping assembly separate", async () => {
  const [composerHtml, skillsHtml, libraryHtml, libraryJs] = await Promise.all([
    readFile(new URL("../composer.html", import.meta.url), "utf8"),
    readFile(new URL("../skills.html", import.meta.url), "utf8"),
    readFile(new URL("../library.html", import.meta.url), "utf8"),
    readFile(new URL("../library.js", import.meta.url), "utf8")
  ]);

  assert.match(composerHtml, /id="composer-timeline"/);
  assert.match(composerHtml, /id="composer-reference-workspace"/);
  assert.match(composerHtml, /id="composer-project-list"/);
  assert.match(composerHtml, /id="composer-reference-feedback"/);
  assert.match(composerHtml, /id="composer-applied-skills"/);
  assert.match(composerHtml, /id="composer-skill-menu"/);
  assert.match(composerHtml, /id="composer-reference-open"/);
  assert.match(composerHtml, /id="composer-reference-tab-cases"/);
  assert.match(composerHtml, /id="composer-reference-tab-skills"/);
  assert.match(composerHtml, /id="composer-attachment-local"/);
  assert.doesNotMatch(composerHtml, /id="composer-attachment-menu"|id="composer-attachment-library"|id="composer-skill-open"/);
  assert.match(composerHtml, /id="composer-assembly-dialog"/);
  assert.match(skillsHtml, /id="skill-save"/);
  assert.match(skillsHtml, /id="skill-test"/);
  assert.match(skillsHtml, /id="skill-import"/);
  assert.match(composerHtml, /id="composer-diagnostic-export"/);
  assert.match(composerHtml, /id="composer-action"/);
  assert.match(composerHtml, /id="composer-model-trigger"/);
  assert.match(composerHtml, /id="composer-thinking"/);
  assert.match(composerHtml, /id="composer-create-image"/);
  assert.match(composerHtml, /id="composer-generation-settings"/);
  assert.match(composerHtml, /id="composer-image-size"/);
  assert.match(composerHtml, /id="composer-image-quality"/);
  assert.match(composerHtml, /id="composer-model-openai"/);
  assert.match(composerHtml, /id="composer-model-compatible"/);
  assert.doesNotMatch(libraryHtml, /id="vision-image-protocol"|id="vision-image-endpoint"|id="vision-image-api-key"/);
  assert.match(libraryJs, /provider_\$\{key\}_imageProtocol/);
  assert.match(libraryJs, /能力声明，不是本轮输出值/);
  assert.match(composerHtml, /id="composer-production-review"[^>]*checked/);
  assert.doesNotMatch(composerHtml, /id="composer-output"/);
  assert.doesNotMatch(composerHtml, /id="composer-delete"/);
  assert.doesNotMatch(composerHtml, /id="composer-drawer-backdrop"/);
  assert.doesNotMatch(composerHtml, /深度体检/);
  assert.doesNotMatch(libraryHtml, /id="composer-dialog"/);
  assert.match(libraryJs, /new URL\(chrome\.runtime\.getURL\("composer\.html"\)\)/);
  assert.match(libraryJs, /navigateWithinPromptDirector\(url\)/);
});

test("composer reference selection is visual while Skill management stays on its own page", async () => {
  const [composerJs, composerCss, skillsJs, i18nJs] = await Promise.all([
    readFile(new URL("../composer-page.js", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.css", import.meta.url), "utf8"),
    readFile(new URL("../skills-page.js", import.meta.url), "utf8"),
    readFile(new URL("../i18n.js", import.meta.url), "utf8")
  ]);
  assert.match(composerJs, /getScreenshotBlob/);
  assert.match(composerJs, /renderMarkdownDocument/);
  assert.match(composerJs, /renderFinalAssistantText/);
  assert.match(composerJs, /composer-case-image/);
  assert.match(composerJs, /composer-input-reference-card/);
  assert.match(composerJs, /entry \? primaryVisual\(entry\) : null/);
  assert.match(composerJs, /reference\.alias/);
  assert.match(composerJs, /reference\.title/);
  const referenceCard = composerJs.slice(
    composerJs.indexOf("function referenceAliasButton"),
    composerJs.indexOf("function referenceTypeLabel")
  );
  assert.match(referenceCard, /insertComposerAlias\(reference\.alias\)/);
  assert.doesNotMatch(referenceCard, /openReferenceWorkspace/);
  assert.match(composerCss, /\.composer-input-reference-card\s*\{/);
  assert.match(composerCss, /\.composer-shell\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s);
  assert.match(composerCss, /\.composer-nav\s*\{[^}]*min-height:\s*0/s);
  assert.match(composerJs, /function activeComposerFeedbackElement\(\)/);
  assert.doesNotMatch(composerJs, /extractProjectMethod/);
  assert.match(skillsJs, /extractCreativeSkillDraft/);
  assert.match(skillsJs, /parseSkillArchive/);
  assert.match(skillsJs, /exportGeneratedSkillPackage|skillDetailExport/);
  assert.match(composerJs, /findCreativeSkillsBySlashQuery/);
  assert.match(composerJs, /createAppliedSkillSnapshot/);
  assert.match(composerJs, /replaceComposerSessionUrl\(response\.session\.id\)/);
  assert.match(composerCss, /\.composer-workspace-feedback\s*\{/);
  assert.match(composerJs, /const payload = plannerRequestPayload\(composerSession, "", composerSettings\)/);
  assert.match(composerJs, /const layers = composerAssemblyLayers\(/);
  assert.match(composerJs, /layers\.map\(\(layer\) =>/);
  assert.match(composerJs, /retrieveComposerSources\(/);
  assert.match(composerJs, /function renderRetrievedSources\(\)/);
  assert.doesNotMatch(composerJs, /planSnapshot|currentPlan|dimensionUses/);
  assert.match(composerJs, /routeOperationLabel\(activeOperation\?\.executionRoute/);
  assert.doesNotMatch(composerJs, /type:\s*["']plan["']/);
  assert.match(composerJs, /previousOutputLanguage === elements\.composerOutputLanguage\.value/);
  assert.match(composerJs, /previousTargetPlatform === elements\.composerPlatform\.value\.trim\(\)/);
  assert.match(composerJs, /composerSession = working;\s*renderComposer\(\)/);
  assert.match(composerJs, /composerDiagnosticExport\.hidden = response\.uiPreferences\?\.analysisDiagnostics !== true/);
  assert.match(composerJs, /retryComposerTurn/);
  assert.doesNotMatch(composerJs, /deepReviewComposerOutput|runSemanticReview/);
  assert.doesNotMatch(composerJs, /reviewComposedPrompt|requestPhase = "reviewing"/);
  assert.match(composerJs, /prepareSelectedReferenceImages/);
  assert.match(composerJs, /REGISTER_GENERATED_OUTPUTS/);
  assert.match(composerJs, /createComposerImageWorkspace/);
  assert.doesNotMatch(composerJs, /composer-result-more/);
  assert.doesNotMatch(composerJs, /按当前来源重新生成/);
  assert.match(composerJs, /composerSession\.outputMode === "create_image"/);
  assert.match(composerJs, /composerServiceCapabilities\(/);
  assert.match(composerJs, /normalizeImageGenerationRequest\(/);
  assert.match(composerJs, /previousReviewEnabled === elements\.composerProductionReview\.checked/);
  assert.match(composerCss, /\.composer-review-toggle input\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0/s);
  assert.match(composerCss, /\.composer-review-toggle input:focus-visible \+ span/);
  assert.match(composerCss, /\.composer-review-toggle input:checked \+ span/);
  assert.match(composerCss, /\.composer-reference-workspace\s*\{/);
  assert.doesNotMatch(i18nJs, /querySelectorAll\("\[data-i18n-title\]"\).*\.title\s*=/);
});

test("composer temporary references share one attachment entry and block text-only sends before the draft is consumed", async () => {
  const [composerHtml, composerJs] = await Promise.all([
    readFile(new URL("../composer.html", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.js", import.meta.url), "utf8")
  ]);

  assert.match(composerHtml, /id="composer-attachment-files"[^>]*multiple/);
  assert.match(composerHtml, /id="composer-attachment-local"/);
  assert.doesNotMatch(composerHtml, /id="composer-attachment-menu"|id="composer-attachment-library"/);
  assert.match(composerHtml, /id="composer-temp-references"/);
  assert.match(composerHtml, /id="composer-temp-reference-save-all"/);
  assert.match(composerHtml, /id="composer-image-blocker"/);
  assert.match(composerHtml, /id="composer-image-blocker-choose-service"/);
  assert.match(composerHtml, /id="composer-image-blocker-analyze"/);
  assert.match(composerHtml, /id="composer-image-blocker-cancel"/);

  assert.match(composerJs, /type:\s*"ADD_TEMP_REFERENCES"/);
  assert.match(composerJs, /type:\s*"REMOVE_TEMP_REFERENCE"/);
  assert.match(composerJs, /type:\s*"SAVE_TEMP_REFERENCE_AS_CASE"/);
  assert.match(composerJs, /type:\s*"ANALYZE_TEMP_REFERENCES"/);
  assert.match(composerJs, /composerPasteFiles\(event\.clipboardData\)/);
  assert.match(composerJs, /if \(!files\.length\) return;\s*event\.preventDefault\(\)/s);
  const sendTurn = composerJs.slice(composerJs.indexOf("async function sendComposerTurn"), composerJs.indexOf("async function retryComposerTurn"));
  assert.ok(sendTurn.indexOf("showImageTempReferenceBlock") < sendTurn.indexOf("appendComposerMessage"));
  assert.ok(sendTurn.indexOf("showImageTempReferenceBlock") < sendTurn.indexOf("composerInstruction.value = \"\""));
  assert.doesNotMatch(composerJs, /removeAllImageTempReferences/);
});

test("composer internal Skill and settings navigation stays in the current tab", async () => {
  const composerJs = await readFile(new URL("../composer-page.js", import.meta.url), "utf8");
  const openSkill = composerJs.slice(composerJs.indexOf("async function openSkillCenter"), composerJs.indexOf("function openAssemblyDialog"));
  assert.match(openSkill, /location\.assign\(url\.href\)/);
  assert.match(openSkill, /url\.searchParams\.set\("session", composerSession\.id\)/);
  assert.doesNotMatch(openSkill, /chrome\.tabs\.create|openerTabId/);
  const assembly = composerJs.slice(composerJs.indexOf("function openAssemblyDialog"), composerJs.indexOf("function assemblyLayer"));
  assert.match(assembly, /location\.assign\(url\.href\)/);
  assert.doesNotMatch(assembly, /chrome\.tabs\.create/);
});

test("composer keeps one stable creation toolbar and separates result action levels", async () => {
  const [composerHtml, composerJs, composerCss] = await Promise.all([
    readFile(new URL("../composer.html", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.js", import.meta.url), "utf8"),
    readFile(new URL("../composer-page.css", import.meta.url), "utf8")
  ]);
  const footer = composerHtml.slice(
    composerHtml.indexOf('<div class="composer-input-footer">'),
    composerHtml.indexOf('<div class="composer-status-line">')
  );
  for (const id of ["composer-attachment-local", "composer-reference-open", "composer-options", "composer-model-trigger", "composer-action"]) {
    assert.match(footer, new RegExp(`id="${id}"`));
  }
  assert.ok(footer.indexOf("composer-attachment-local") < footer.indexOf("composer-type-switch"));
  assert.ok(footer.indexOf("composer-type-switch") < footer.indexOf("composer-reference-open"));
  assert.ok(footer.indexOf("composer-reference-open") < footer.indexOf("composer-options"));
  assert.ok(footer.indexOf("composer-options") < footer.indexOf("composer-model-trigger"));
  assert.ok(footer.indexOf("composer-model-trigger") < footer.indexOf("composer-action"));
  assert.match(composerJs, /composer-result-primary-actions/);
  assert.match(composerJs, /composer-result-secondary-actions/);
  assert.match(composerJs, /useCreativeOutputAsReference\(run, output\)/);
  assert.match(composerCss, /\.composer-message\.status \.composer-message-content\s*\{[^}]*display:\s*inline-grid[^}]*\}/s);
  assert.match(composerCss, /composer-page-paused[\s\S]*animation-play-state:\s*paused/);
});
