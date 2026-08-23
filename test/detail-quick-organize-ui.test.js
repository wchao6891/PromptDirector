import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../library.js", import.meta.url), "utf8");
const css = await readFile(new URL("../library.css", import.meta.url), "utf8");
const foundation = await readFile(new URL("../ui-foundation.css", import.meta.url), "utf8");
const tagEditor = await readFile(new URL("../tag-editor.js", import.meta.url), "utf8");

const quickOrganizer = source.slice(
  source.indexOf("function createDetailQuickOrganization"),
  source.indexOf("function createDetailDeleteAction")
);
const footerActions = source.slice(
  source.indexOf("function createDetailDeleteAction"),
  source.indexOf("function createComposerAction")
);
const editor = source.slice(
  source.indexOf("function createEntryEditor"),
  source.indexOf("function renderManager")
);
const attributes = source.slice(
  source.indexOf("function createDetailAttributes"),
  source.indexOf("function createDetailMetadata")
);

test("detail organization follows prompt and AI tags without an extra section title", () => {
  const detail = source.slice(source.indexOf("async function renderDetail"), source.indexOf("function createLocalDiscovery"));
  assert.ok(detail.indexOf("createDetailAttributes(entry)") < detail.indexOf("createDetailQuickOrganization(entry)"));
  assert.doesNotMatch(quickOrganizer, /"快捷整理"/);
  assert.match(quickOrganizer, /"项目"/);
  assert.match(quickOrganizer, /"添加标签"/);
  assert.doesNotMatch(quickOrganizer, /可选|任意输入|不用预先创建|还没有/);
  assert.match(quickOrganizer, /entry\.compoundCase\?\.customLabels \?\? entry\.customLabels/);
});

test("detail projects use a compact multi-project dropdown and can be created in place", () => {
  assert.match(quickOrganizer, /detail-project-menu/);
  assert.match(quickOrganizer, /"选择项目"/);
  assert.match(quickOrganizer, /t\("已加入 \{count\} 个项目", \{ count: selectedProjects\.length \}\)/);
  assert.match(quickOrganizer, /checkbox\.type = "checkbox"/);
  assert.match(quickOrganizer, /type: "REPLACE_COLLECTION_ENTRIES"/);
  assert.match(quickOrganizer, /type: "CREATE_COLLECTION"/);
  assert.match(quickOrganizer, /"新建并加入"/);
  assert.match(quickOrganizer, /expandLogicalCaseIds\(\[entry\.id\], compoundCases\)/);
});

test("detail uses the shared removable multi-tag editor", () => {
  assert.match(quickOrganizer, /createTagEditor/);
  assert.match(tagEditor, /\["Enter", ",", "，"\]\.includes\(event\.key\)/);
  assert.match(tagEditor, /splitTagInput/);
  assert.match(tagEditor, /删除标签/);
  assert.match(source, /type: "UPDATE_ENTRY_CUSTOM_LABELS"/);
  assert.match(source, /type: "UPDATE_COMPOUND_CASE"/);
  assert.match(foundation, /\.tag-editor-chip\s*\{/);
});

test("case deletion is a visible one-step recycle-bin action and no longer lives in the editor", () => {
  const detail = source.slice(source.indexOf("async function renderDetail"), source.indexOf("function createLocalDiscovery"));
  const metadata = source.slice(source.indexOf("function createDetailMetadata"), source.indexOf("function createFullAnalysis"));
  assert.doesNotMatch(quickOrganizer, /移入回收站|trash-2|deleteCaseIncrementally/);
  assert.match(footerActions, /"移入回收站"/);
  assert.match(footerActions, /createUiIcon\("trash-2"\)/);
  assert.match(footerActions, /案例及其媒体会移入回收站，可随时恢复/);
  assert.match(footerActions, /deleteCaseIncrementally\(deleteButton, entry\.id\)/);
  assert.match(detail, /createDetailMetadata\(entry, \{ includeDelete: true \}\)/);
  assert.match(detail, /else body\.append\(createDetailFooterActions\(entry\)\)/);
  assert.match(metadata, /if \(includeDelete\) actions\.append\(createDetailDeleteAction\(entry\)\)/);
  assert.doesNotMatch(detail, /content\.append\(createDetailFooterActions\(entry\)\)/);
  assert.doesNotMatch(editor, /DELETE_ENTRY|deleteCaseIncrementally|删除这个案例/);
});

test("single-image prompts have one editor while multi-image prompts separate current and shared text", () => {
  const prompt = source.slice(source.indexOf("function createPromptSection"), source.indexOf("async function analyzeEntryVisualSet"));
  assert.match(prompt, /const separatesCurrentAndShared = Boolean/);
  assert.match(prompt, /imageAssets\.length > 1 \|\| options\.compoundMember/);
  assert.match(prompt, /separatesCurrentAndShared \? "编辑当前图片" : "编辑"/);
  assert.match(prompt, /separatesCurrentAndShared && entry\.text \? textEl\("button", "button-secondary", "编辑共享提示词"\)/);
});

test("entry title editing keeps one visible heading and an inline save action", () => {
  assert.match(editor, /textEl\("h4", "", "案例标题"\)/);
  assert.match(editor, /textEl\("span", "sr-only", "案例标题"\)/);
  assert.match(editor, /el\("div", "entry-edit-row"\)/);
  assert.match(editor, /const saveTitle = textEl\("button", "button-secondary", "保存"\)/);
  assert.doesNotMatch(editor, /保存标题/);
});

test("checkboxes are not stretched by the global text-input rule", () => {
  assert.match(foundation, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\), select, textarea/);
  assert.match(css, /\.detail-project-option input\s*\{[^}]*width:\s*16px/);
});

test("AI tags show only leaf labels while preserving their full path for context", () => {
  assert.match(attributes, /"AI 标签"/);
  assert.match(attributes, /label: item\.name, path: item\.path/);
  assert.match(source, /function detailTag\(\{ facet, label, path = label \}\)[\s\S]*setAttribute\("aria-label", fullPath\)/);
  assert.doesNotMatch(attributes, /entry\.customLabels|customFacet|自定义标签/);
  assert.match(editor, /"已有 AI 标签"/);
  assert.match(editor, /"添加 AI 标签"/);
});
