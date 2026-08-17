import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fieldless confirmations do not render an empty body or permanent status band", async () => {
  const source = await readFile(new URL("../ui-dialogs.js", import.meta.url), "utf8");
  assert.match(source, /if \(controls\.size \|\| body\.childElementCount\) form\.append\(body\)/);
  assert.match(source, /typeof options\.renderBody === "function"/);
  assert.match(source, /const ensureStatus = \(\) =>/);
  assert.doesNotMatch(source, /body\.append\(status\);\s*const footer/);
});

test("AI settings use full-width task and service views instead of a cramped split pane", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("../library.html", import.meta.url), "utf8"),
    readFile(new URL("../library.css", import.meta.url), "utf8")
  ]);

  assert.match(html, /data-ai-routing-tab="tasks"[^>]*aria-selected="true"/);
  assert.match(html, /data-ai-routing-tab="providers"[^>]*aria-selected="false"/);
  assert.match(html, /data-ai-routing-panel="tasks"/);
  assert.match(html, /data-ai-routing-panel="providers"[^>]*hidden/);
  assert.match(css, /\.settings-dialog\s*\{[^}]*width:\s*min\(1040px, calc\(100vw - 40px\)\)/s);
  assert.match(css, /\.ai-routing-regions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.doesNotMatch(css, /\.ai-routing-regions\s*\{[^}]*1\.35fr/s);
});

test("AI configuration dialogs keep dirty credentials open until the user explicitly confirms discard", async () => {
  const source = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const providerDialog = source.slice(
    source.indexOf("async function openAiProviderDialog"),
    source.indexOf("function providerCategoryLabel")
  );
  assert.match(providerDialog, /dismissOnBackdrop:\s*false/);
  assert.match(providerDialog, /confirmDismissWhenDirty:\s*true/);
});

test("every model catalog refresh applies the complete AI configuration response", async () => {
  const source = await readFile(new URL("../library.js", import.meta.url), "utf8");
  const refreshOne = source.slice(
    source.indexOf("async function refreshAiProviderModels"),
    source.indexOf("async function refreshAiModelCatalogsForSession")
  );
  const refreshSession = source.slice(
    source.indexOf("async function refreshAiModelCatalogsForSession"),
    source.indexOf("function permissionPatternForProvider")
  );
  assert.match(refreshOne, /applyAiConfigurationResponse\(response\)/);
  assert.match(refreshSession, /applyAiConfigurationResponse\(response\)/);
  assert.doesNotMatch(refreshOne, /aiProviderRegistry\s*=\s*response/);
  assert.doesNotMatch(refreshSession, /aiProviderRegistry\s*=\s*response/);
});

test("video detail sizes from media dimensions and separates native controls from app actions", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../library.js", import.meta.url), "utf8"),
    readFile(new URL("../library.css", import.meta.url), "utf8")
  ]);
  assert.match(source, /localVideo\.videoWidth/);
  assert.match(css, /is-video-detail\.is-immersive \{ height: auto/);
  assert.match(css, /border-top: 16px solid var\(--viewer-bg\)/);
  assert.match(css, /detail-visual-actions button \{ min-height: 36px/);
  const mobile = css.slice(css.lastIndexOf("@media (max-width: 390px)"));
  assert.match(mobile, /detail-visual-actions[\s\S]*min-height:\s*44px/);
  assert.match(css, /button-danger-secondary/);
});
