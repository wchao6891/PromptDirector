import test from "node:test";
import assert from "node:assert/strict";
import { classifyImportedMedia } from "../extension/classifier.js";
import { CONTENT_IDS, createDefaultTaxonomy, normalizeTaxonomy } from "../extension/taxonomy.js";
import { prepareLocalMedia } from "../extension/local-media.js";
import { normalizeMediaAsset } from "../extension/media.js";
import { createZipBlob, readZipBlob } from "../extension/zip.js";
import { resolvePortableAssetFormat } from "../extension/asset-formats.js";

test("audio and source originals get useful defaults without reading prompt-like text", () => {
  for (const [kind, sourceFormat, target] of [["audio", "wav", CONTENT_IDS.audio], ["attachment", "psd", CONTENT_IDS.sourceFile], ["attachment", "prproj", CONTENT_IDS.sourceFile]]) {
    const entry = { text: "Midjourney prompt --ar 1:1", mediaAssets: [{ id: "file", kind, sourceFormat, sourceTitle: `file.${sourceFormat}`, storageMode: "managed" }] };
    assert.deepEqual(classifyImportedMedia(entry).pathIds, [target]);
    const manual = { ...entry, classification: { pathIds: [CONTENT_IDS.reference], status: "confirmed", source: "manual" } };
    assert.deepEqual(classifyImportedMedia(manual).pathIds, [CONTENT_IDS.reference]);
  }
});

test("existing taxonomy gains the new types without renaming or duplicating user categories", () => {
  const previous = createDefaultTaxonomy();
  previous.nodes = previous.nodes.filter(node => ![CONTENT_IDS.audio, CONTENT_IDS.sourceFile].includes(node.id));
  previous.nodes[0].name = "我的教程";
  const next = normalizeTaxonomy(previous);
  assert.equal(next.nodes[0].name, "我的教程");
  assert.deepEqual(normalizeTaxonomy(next), next);
  assert.ok(next.nodes.some(node => node.id === CONTENT_IDS.audio));
  assert.ok(next.nodes.some(node => node.id === CONTENT_IDS.sourceFile));
});

test("preservation-only office files remain documents and retain exact bytes through ZIP", async () => {
  for (const extension of ["xlsx", "xls", "pptx", "ppt", "doc", "csv"]) {
    // Deliberate binary sentinel: preserving an original must not decode it as text.
    const bytes = new Uint8Array([0, 255, 1, 128, 80, 75]);
    const file = new File([bytes], `creative.${extension}`);
    const prepared = await prepareLocalMedia(file, `file:${extension}`);
    assert.equal(prepared.asset.kind, "document");
    assert.equal(prepared.contentText, "");
    assert.match(prepared.warnings.join(), /原件已保存/);
    const asset = normalizeMediaAsset(prepared.asset);
    assert.deepEqual(asset.extractionWarnings, prepared.warnings);
    assert.deepEqual(classifyImportedMedia({ mediaAssets: [asset] }).pathIds, [CONTENT_IDS.reference]);
    const format = resolvePortableAssetFormat(asset, prepared.blob);
    const zip = await createZipBlob([{ name: `documents/original.${format.extension}`, data: prepared.blob }]);
    const restored = await readZipBlob(zip);
    assert.deepEqual(new Uint8Array(await restored.get(`documents/original.${extension}`).arrayBuffer()), bytes);
  }
});

test("a damaged DOCX keeps its original and reports extraction failure", async () => {
  const file = new File(["deliberately invalid DOCX fixture"], "broken.docx");
  const prepared = await prepareLocalMedia(file, "broken");
  assert.equal(await prepared.blob.text(), await file.text());
  assert.equal(prepared.contentText, "");
  assert.match(prepared.warnings.join(), /DOCX 正文提取失败/);
});
