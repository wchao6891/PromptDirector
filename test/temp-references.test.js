import test from "node:test";
import assert from "node:assert/strict";

import {
  composerPasteFiles,
  createTempReference,
  extractTempReferenceText,
  imageTempReferenceBlock,
  namePastedTempReferenceFile,
  unreadReferenceImageAssets,
  validateTempReferenceFile
} from "../temp-references.js";
import { createComposerSession } from "../composer.js";

const supportedFiles = [
  ["frame.png", "image/png"],
  ["frame.jpg", "image/jpeg"],
  ["frame.webp", "image/webp"],
  ["motion.gif", "image/gif"],
  ["treatment.pdf", "application/pdf"],
  ["notes.txt", "text/plain"],
  ["method.md", "text/markdown"],
  ["reference.html", "text/html"]
];

test("ordinary text paste remains the browser's default behavior", () => {
  const clipboard = {
    files: [],
    items: [{ kind: "string", type: "text/plain", getAsFile: () => null }]
  };

  assert.deepEqual(composerPasteFiles(clipboard), []);
});

test("an unnamed clipboard image receives a format-derived name before validation", () => {
  const pasted = namePastedTempReferenceFile(new File(["image"], "", { type: "image/png" }), "paste-one");
  assert.equal(pasted.name, "paste-one.png");
  assert.equal(validateTempReferenceFile(pasted).mimeType, "image/png");
});

test("the composer accepts its documented image and document formats", () => {
  for (const [name, type] of supportedFiles) {
    const file = new File(["content"], name, { type });
    assert.deepEqual(validateTempReferenceFile(file), {
      extension: name.split(".").at(-1),
      kind: type.startsWith("image/") ? "image" : "document",
      mimeType: type
    });
  }
});

test("video and files disguised with a mismatched extension are rejected", () => {
  assert.throws(
    () => validateTempReferenceFile(new File(["video"], "clip.mp4", { type: "video/mp4" })),
    /暂不支持视频/
  );
  assert.throws(
    () => validateTempReferenceFile(new File(["image"], "frame.png", { type: "text/html" })),
    /扩展名和文件格式不一致/
  );
});

test("temporary reference metadata survives composer session normalization", () => {
  const file = new File(["visual"], "lighting.webp", { type: "image/webp" });
  const reference = createTempReference({
    file,
    assetId: "temp-reference-asset:one",
    referenceId: "temp-reference:one",
    alias: "@参考1"
  });
  const [saved] = createComposerSession({ referenceSnapshots: [reference] }).referenceSnapshots;

  assert.equal(saved.sourceType, "temporary");
  assert.equal(saved.entryId, "temp-reference:one");
  assert.deepEqual(saved.assetRefs, [{
    assetId: "temp-reference-asset:one",
    kind: "image",
    mimeType: "image/webp",
    name: "lighting.webp",
    byteSize: 6
  }]);
  assert.deepEqual(saved.imageRefs, [{ visualId: "temp-reference-asset:one", mimeType: "image/webp" }]);
});

test("temporary reference backup paths keep safe relative paths and discard unsafe paths", () => {
  const base = {
    entryId: "temp-reference:backup",
    alias: "@参考1",
    sourceType: "temporary",
    assetRefs: [{ assetId: "temp-reference-asset:backup", kind: "document", mimeType: "text/plain", name: "notes.txt", byteSize: 5 }]
  };
  const [safe] = createComposerSession({
    referenceSnapshots: [{ ...base, assetRefs: [{ ...base.assetRefs[0], archivePath: "temporary/session/notes.txt" }] }]
  }).referenceSnapshots;
  const [unsafe] = createComposerSession({
    referenceSnapshots: [{ ...base, assetRefs: [{ ...base.assetRefs[0], archivePath: "../private/notes.txt" }] }]
  }).referenceSnapshots;

  assert.equal(safe.assetRefs[0].archivePath, "temporary/session/notes.txt");
  assert.equal(Object.hasOwn(unsafe.assetRefs[0], "archivePath"), false);
});

test("a text-only service blocks image attachments without choosing another service", () => {
  const references = [{
    sourceType: "temporary",
    assetRefs: [{ assetId: "temp-reference-asset:one", kind: "image", mimeType: "image/png" }]
  }];

  assert.deepEqual(imageTempReferenceBlock(references, { serviceId: "deepseek", vision: false }), {
    blocked: true,
    imageCount: 1,
    choices: ["chooseVisionService", "analyzeImages", "cancel"]
  });
  assert.deepEqual(imageTempReferenceBlock(references, { serviceId: "openai", vision: true }), {
    blocked: false,
    imageCount: 1,
    choices: []
  });
  assert.deepEqual(imageTempReferenceBlock([{ ...references[0], referenceText: "A centered portrait with hard side light." }], { serviceId: "deepseek", vision: false }), {
    blocked: false,
    imageCount: 0,
    choices: []
  });
  assert.deepEqual(imageTempReferenceBlock([{
    sourceType: "library",
    imageRefs: [{ visualId: "temp-reference-asset:one", mimeType: "image/png" }]
  }], { serviceId: "deepseek", vision: false }), {
    blocked: true,
    imageCount: 1,
    choices: ["chooseVisionService", "analyzeImages", "cancel"]
  });
  assert.deepEqual(imageTempReferenceBlock([{
    sourceType: "library",
    referenceKind: "prompt",
    originalText: "A centered portrait with hard side light.",
    referenceText: "A centered portrait with hard side light.",
    imageRefs: [{ visualId: "temp-reference-asset:one", mimeType: "image/png" }],
    assets: [{ assetId: "temp-reference-asset:one", kind: "image" }]
  }], { serviceId: "deepseek", vision: false }), {
    blocked: false,
    imageCount: 0,
    choices: []
  });
});

test("a partial temporary-image analysis remains eligible for completion", () => {
  const base = {
    referenceText: "已保存的可见描述",
    assetRefs: [{ assetId: "temp-reference-asset:partial", kind: "image", mimeType: "image/png" }],
    imageRefs: [{ visualId: "temp-reference-asset:partial", mimeType: "image/png" }]
  };
  const partial = {
    ...base,
    assets: [{
      assetId: "temp-reference-asset:partial",
      imageFingerprint: "image-hash",
      analysisImageFingerprint: "image-hash",
      analysisVersion: 2,
      analysisFingerprint: "profile-hash",
      reconstructionPrompt: ""
    }]
  };
  assert.deepEqual(unreadReferenceImageAssets(partial).map((item) => item.assetId), ["temp-reference-asset:partial"]);
  assert.deepEqual(unreadReferenceImageAssets({
    ...partial,
    assets: [{ ...partial.assets[0], reconstructionPrompt: "可独立复用的重建提示词" }]
  }), []);
});

test("text, Markdown, and HTML attachments expose readable text without script content", async () => {
  const parser = (html) => ({
    body: {
      textContent: html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
        .replace(/<[^>]+>/gu, " ")
    }
  });
  assert.equal(await extractTempReferenceText(new File(["line one\nline two"], "notes.txt", { type: "text/plain" })), "line one\nline two");
  assert.equal(await extractTempReferenceText(new File(["# Method\nKeep contrast"], "method.md", { type: "text/markdown" })), "# Method\nKeep contrast");
  assert.equal(
    await extractTempReferenceText(new File(["<main>Visible</main><script>secret()</script>"], "brief.html", { type: "text/html" }), { parseHtml: parser }),
    "Visible"
  );
});

test("PDF attachments use the supplied PDF text extractor", async () => {
  const file = new File(["pdf"], "treatment.pdf", { type: "application/pdf" });
  const text = await extractTempReferenceText(file, { extractPdfText: async () => "Page one direction" });
  assert.equal(text, "Page one direction");
});
