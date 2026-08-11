import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("copy stays local while an explicit image action activates result capture", async () => {
  const composer = await readFile(new URL("composer-page.js", root), "utf8");
  const collector = await readFile(new URL("collector.js", root), "utf8");
  const copyStart = composer.indexOf("async function copyPrompt(");
  const captureStart = composer.indexOf("async function prepareCreativeResult(");
  const cardsStart = composer.indexOf("function createCreativeOutputCards(");
  assert.ok(copyStart >= 0 && captureStart > copyStart && cardsStart > captureStart);
  assert.match(composer.slice(copyStart, captureStart), /navigator\.clipboard\.writeText/);
  assert.doesNotMatch(composer.slice(copyStart, captureStart), /ACTIVATE_CREATIVE_RESULT/);
  assert.match(composer.slice(captureStart, cardsStart), /ACTIVATE_CREATIVE_RESULT/);
  assert.match(composer, /添加生成图片/);
  assert.match(collector, /runCaptureTransaction/);
  assert.match(collector, /resultScreenshot[\s\S]*captureFromActivePage\([\s\S]*true/);
  assert.match(collector, /activeCreativePrompt/);
  assert.match(collector, /changes\.activeCreativeResult/);
  assert.ok(collector.indexOf("chrome.storage.onChanged.addListener") < collector.indexOf("await refresh()"));
  assert.doesNotMatch(collector, /rating|评分|满意度/);
});

test("result cards stay under prompt versions and advanced controls remain collapsed in existing settings", async () => {
  const composer = await readFile(new URL("composer-page.js", root), "utf8");
  const html = await readFile(new URL("library.html", root), "utf8");
  assert.match(composer, /createCreativeOutputCards\(session\.id, version\.id\)/);
  assert.match(composer, /保存到灵感库/);
  assert.match(composer, /继续优化/);
  assert.match(html, /<details class="creative-experiment-settings">/);
  assert.doesNotMatch(html, /data-manager-tab="creative-experiment"/);
});

test("normal result linking and advanced visual evaluation are separate background actions", async () => {
  const source = await readFile(new URL("background.js", root), "utf8");
  const commitStart = source.indexOf("async function commitCreativeOutputsTransaction()");
  const settingsStart = source.indexOf("async function updateCreativeExperimentSettings", commitStart);
  const commitBlock = source.slice(commitStart, settingsStart);
  assert.match(commitBlock, /creativeExperimentSettings\.enabled && state\.creativeExperimentSettings\.autoAnalyze/);
  assert.match(commitBlock, /createCreativeRun/);
  assert.match(commitBlock, /analyzeCommittedCreativeOutputs/);
});
