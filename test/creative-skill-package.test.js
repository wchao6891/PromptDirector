import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import {
  buildProvenanceMarkdown,
  buildSkillMarkdown,
  detectSkillDependencies,
  exportGeneratedSkillPackage,
  exportStoredSkillPackage,
  parseSkillArchive,
  parseSkillFiles,
  parseSkillMarkdown
} from "../creative-skill-package.js";

test("generated packages contain a standard SKILL.md and Markdown references only", async () => {
  const archive = await exportGeneratedSkillPackage({
    portableId: "guofeng-visual",
    description: "将国风审美转成可复用创作方法。",
    skillMarkdown: "# 国风视觉\n\n围绕用户要求组织色彩和构图。",
    references: [{ path: "references/composition.md", markdown: "# 构图\n\n保持纵深。", runtime: true }],
    provenanceMarkdown: buildProvenanceMarkdown({ target: "提炼构图", contributions: ["案例一贡献纵深"] })
  });
  const parsed = await parseSkillArchive(archive);
  assert.equal(parsed.name, "guofeng-visual");
  assert.equal(parsed.description, "将国风审美转成可复用创作方法。");
  assert.deepEqual(parsed.references.map((item) => item.path), ["references/composition.md", "references/provenance.md"]);
  assert.equal(parsed.files.size, 3);
});

test("frontmatter reads only name and description while preserving the executable body", () => {
  const markdown = buildSkillMarkdown({ name: "game-cg", description: "Create game CG.", body: "# Workflow\n\nFollow the user goal." });
  const parsed = parseSkillMarkdown(markdown.replace("description:", "license: Apache-2.0\ndescription:"));
  assert.equal(parsed.name, "game-cg");
  assert.match(parsed.body, /Follow the user goal/);
  assert.equal(parsed.license, undefined);
});

test("external packages retain every file but expose only safe Markdown references", async () => {
  const files = new Map([
    ["external/SKILL.md", new Blob(["---\nname: external-tool\ndescription: Uses a helper.\n---\n\nRun scripts/helper.py before composing."])],
    ["external/references/guide.md", new Blob(["# Guide\n\nText method."])],
    ["external/scripts/helper.py", new Blob(["print('ok')"])],
    ["external/assets/example.png", new Blob([new Uint8Array([1, 2, 3])])]
  ]);
  const parsed = await parseSkillFiles(files);
  assert.equal(parsed.files.size, 4);
  assert.deepEqual(parsed.references.map((item) => item.path), ["references/guide.md"]);
  assert.equal(parsed.requiresTextModeConfirmation, true);
  assert.deepEqual(parsed.dependencies, ["scripts"]);
});

test("ordinary export preserves every stored external package byte and path", async () => {
  const blobs = new Map([
    ["skill-file:markdown", new Blob(["---\nname: exact-copy\ndescription: Exact.\n---\n\n# Method\n"])],
    ["skill-file:script", new Blob(["print('unchanged')\n"], { type: "text/x-python" })],
    ["skill-file:asset", new Blob([new Uint8Array([0, 255, 1, 254])], { type: "application/octet-stream" })]
  ]);
  const archive = await exportStoredSkillPackage({
    portableId: "exact-copy",
    packageFiles: [
      { path: "vendor/SKILL.md", assetId: "skill-file:markdown", byteSize: blobs.get("skill-file:markdown").size },
      { path: "vendor/scripts/tool.py", assetId: "skill-file:script", byteSize: blobs.get("skill-file:script").size },
      { path: "vendor/assets/sample.bin", assetId: "skill-file:asset", byteSize: 0 }
    ]
  }, { readFile: (assetId) => blobs.get(assetId) });
  const parsed = await parseSkillArchive(archive);
  assert.deepEqual([...parsed.files.keys()], ["vendor/SKILL.md", "vendor/scripts/tool.py", "vendor/assets/sample.bin"]);
  assert.deepEqual(
    new Uint8Array(await parsed.files.get("vendor/assets/sample.bin").arrayBuffer()),
    new Uint8Array([0, 255, 1, 254])
  );
});

test("package validation rejects traversal, duplicate SKILL.md, and damaged ZIP", async () => {
  await assert.rejects(() => parseSkillFiles(new Map([["../SKILL.md", new Blob(["x"])]])), /不安全/);
  await assert.rejects(() => parseSkillFiles(new Map([
    ["one/SKILL.md", new Blob(["x"])], ["two/SKILL.md", new Blob(["x"])]
  ])), /多个 SKILL/);
  await assert.rejects(() => parseSkillArchive(new Blob(["broken"])), /有效的 ZIP/);
});

test("dependency detection does not warn for a pure text method", () => {
  assert.deepEqual(detectSkillDependencies("Use contrast and rhythm to guide composition."), []);
  assert.deepEqual(detectSkillDependencies("Run python3 scripts/analyze.py before composing."), ["scripts"]);
});

test("ordinary deflated Skill ZIP files import without weakening archive checks", async () => {
  const markdown = "---\nname: deflated-skill\ndescription: Imported from a normal ZIP.\n---\n\n# Method\n\nKeep the subject readable.";
  const parsed = await parseSkillArchive(deflatedZip("portable/SKILL.md", markdown));
  assert.equal(parsed.name, "deflated-skill");
  assert.match(parsed.body, /subject readable/);
});

function deflatedZip(name, content) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const data = encoder.encode(content);
  const compressed = new Uint8Array(deflateRawSync(data));
  const checksum = crc32(data);
  const local = new Uint8Array(30);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0x0800, true);
  localView.setUint16(8, 8, true);
  localView.setUint32(14, checksum, true);
  localView.setUint32(18, compressed.byteLength, true);
  localView.setUint32(22, data.byteLength, true);
  localView.setUint16(26, nameBytes.byteLength, true);
  const central = new Uint8Array(46);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0x0800, true);
  centralView.setUint16(10, 8, true);
  centralView.setUint32(16, checksum, true);
  centralView.setUint32(20, compressed.byteLength, true);
  centralView.setUint32(24, data.byteLength, true);
  centralView.setUint16(28, nameBytes.byteLength, true);
  const centralOffset = local.byteLength + nameBytes.byteLength + compressed.byteLength;
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.byteLength + nameBytes.byteLength, true);
  endView.setUint32(16, centralOffset, true);
  return new Blob([local, nameBytes, compressed, central, nameBytes, end], { type: "application/zip" });
}

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) checksum = checksum & 1 ? 0xedb88320 ^ (checksum >>> 1) : checksum >>> 1;
  }
  return (checksum ^ 0xffffffff) >>> 0;
}
