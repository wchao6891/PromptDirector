import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCreativeSkill, createCreativeSkillsState, saveCreativeSkillVersion, createAppliedSkillSnapshot, mergeCreativeSkillsState } from "../extension/creative-skills.js";
import { exportStoredSkillPackage, parseSkillArchive, buildSkillMarkdown } from "../extension/creative-skill-package.js";
import { commitSkillWithCover } from "../extension/skill-cover-save.js";
import { skillCoverFile, readSkillCover, validateSkillCover } from "../extension/skill-cover.js";
import { createZipBlob, readZipBlob } from "../extension/zip.js";
import { buildCuratedSkillSnapshot, buildCuratedSkillSubmissionArchive } from "../extension/curated-skill-package.js";
import { fetchCuratedSkillCover } from "../extension/curated-skill-catalog.js";
import { sha256Hex } from "../extension/sync-crypto.js";

const image = new Blob([readFileSync(new URL("./fixtures/transfer-media/original.gif", import.meta.url))], { type: "image/gif" });
const coverFile = { path: "assets/cover.gif", assetId: "skill-file:original", byteSize: image.size, mimeType: image.type };
function fixture() {
  return createCreativeSkill(createCreativeSkillsState(), {
    callName: "画面构图", portableId: "image-composition", description: "层次与尺度", skillMarkdown: "# 构图\n\n让主体清楚。", packageFiles: [coverFile]
  }, { id: "skill:original", versionId: "skill-version:original" });
}
function storage(result, failure = "") {
  const blobs = new Map([[coverFile.assetId, image], ["source:image", image]]);
  let committed = null;
  const warnings = [];
  return {
    blobs, warnings, state: () => committed,
    options: {
      readBlob: async id => blobs.get(id),
      saveBlob: async (id, blob) => { if (failure === "write") throw new Error("write failed"); blobs.set(id, blob); },
      commit: async state => { if (failure === "commit") throw new Error("commit failed"); committed = structuredClone(state); },
      cleanup: async ids => {
        if (failure === "cleanup") throw new Error("cleanup failed");
        const retained = (committed ?? result.state).items.flatMap(skill => skill.packageFiles.map(file => file.assetId));
        for (const id of ids) if (!retained.includes(id)) blobs.delete(id);
      },
      onCleanupError: error => warnings.push(error.message)
    }
  };
}

test("generated Skill exports its method plus the exact cover bytes without a stored SKILL.md", async () => {
  const { skill } = fixture();
  const archive = await exportStoredSkillPackage(skill, { readFile: async () => image });
  const files = await readZipBlob(archive);
  assert.ok(files.has("SKILL.md"));
  assert.deepEqual(new Uint8Array(await files.get(coverFile.path).arrayBuffer()), new Uint8Array(await image.arrayBuffer()));
  const parsed = await parseSkillArchive(archive);
  assert.equal(parsed.body, skill.versions[0].skillMarkdown);
  assert.equal(parsed.files.get(coverFile.path).type, image.type);
});

test("nested external packages preserve executable bytes as inert files while recognizing exactly one cover", async () => {
  const files = [
    { name: "example/SKILL.md", data: buildSkillMarkdown({ name: "example", description: "Examples", body: "# Examples" }) },
    { name: "example/scripts/run.py", data: "print('never execute')" },
    { name: "example/assets/cover.gif", data: image }
  ];
  const parsed = await parseSkillArchive(await createZipBlob(files));
  assert.equal(parsed.files.size, 3);
  const packageFiles = [...parsed.files].map(([path, blob]) => ({ path, assetId: path, byteSize: blob.size, mimeType: blob.type }));
  assert.equal(skillCoverFile({ packageFiles }).path, "example/assets/cover.gif");
  const exported = await readZipBlob(await exportStoredSkillPackage({ packageFiles }, { readFile: async id => parsed.files.get(id) }));
  assert.equal(await exported.get("example/scripts/run.py").text(), "print('never execute')");
});

test("cover-only replacement preserves method version and applied conversation snapshots", async () => {
  const original = fixture();
  const before = createAppliedSkillSnapshot(original.skill);
  const result = saveCreativeSkillVersion(original.state, original.skill.id, {
    coverOnly: true, callName: original.skill.callName, description: original.skill.description, skillMarkdown: before.skillMarkdown
  });
  const store = storage(original);
  await commitSkillWithCover(result, { sourceAssetId: "source:image" }, store.options);
  assert.equal(result.skill.versions.length, 1);
  assert.deepEqual(createAppliedSkillSnapshot(result.skill), before);
  assert.notEqual(skillCoverFile(result.skill).assetId, coverFile.assetId);
  assert.ok(store.blobs.has("source:image"));
  assert.ok(!store.blobs.has(coverFile.assetId));
  assert.equal((await readSkillCover(result.skill, store.options.readBlob)).blob.size, image.size);
});

for (const failure of ["write", "commit"]) test(`${failure} failure retains the original cover and method without committing a dangling replacement`, async () => {
  const original = fixture();
  const result = structuredClone(original);
  result.skill = result.state.items[0];
  const store = storage(original, failure);
  await assert.rejects(() => commitSkillWithCover(result, { sourceAssetId: "source:image" }, store.options), new RegExp(failure));
  assert.equal(store.state(), null);
  assert.ok(store.blobs.has(coverFile.assetId));
  assert.equal(store.blobs.size, 2);
  assert.equal(skillCoverFile(original.skill).assetId, coverFile.assetId);
});

test("cleanup failure leaves a usable committed cover and reports the orphan", async () => {
  const original = fixture(), store = storage(original, "cleanup");
  await commitSkillWithCover(original, { sourceAssetId: "source:image" }, store.options);
  const saved = store.state().items[0];
  assert.ok(store.blobs.has(skillCoverFile(saved).assetId));
  assert.deepEqual(store.warnings, ["cleanup failed"]);
});

test("invalid image bytes and ambiguous covers are rejected rather than silently displaying another asset", async () => {
  await assert.rejects(() => validateSkillCover(new Blob(["not an image"], { type: "image/png" })), /内容与格式/);
  assert.throws(() => skillCoverFile({ packageFiles: [coverFile, { ...coverFile, path: "assets/cover.png" }] }), /只能/);
});

test("restored Skill resource ID collisions keep the cover associated with the remapped package resource", () => {
  const current = fixture();
  const incoming = fixture(); incoming.skill.id = "skill:incoming";
  const merged = mergeCreativeSkillsState(current.state, incoming.state);
  const restored = merged.state.items.find(skill => skill.id === "skill:incoming");
  assert.notEqual(skillCoverFile(restored).assetId, coverFile.assetId);
  assert.equal(merged.packageAssetIdMap[coverFile.assetId], skillCoverFile(restored).assetId);
});

test("submission preview binds the binary cover digest to exactly the image sent in the payload", async () => {
  const snapshot = await buildCuratedSkillSnapshot(fixture().skill, { author: "Creator", summary: "Image composition", rightsConfirmed: true }, { readFile: async () => image });
  const preview = snapshot.preview.find(file => file.path === coverFile.path);
  assert.equal(preview.sha256, await sha256Hex(image));
  assert.equal(preview.text, undefined);
  const outer = await readZipBlob(await buildCuratedSkillSubmissionArchive(snapshot));
  const files = await readZipBlob(outer.get("payload.zip"));
  assert.equal(await sha256Hex(files.get(coverFile.path)), preview.sha256);
});

test("a same-size damaged storage write cannot commit the replacement cover", async () => {
  const original = fixture(), store = storage(original);
  const originalWrite = store.options.saveBlob;
  store.options.saveBlob = async (id, blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    bytes[bytes.length - 1] ^= 1;
    await originalWrite(id, new Blob([bytes], { type: blob.type }));
  };
  await assert.rejects(() => commitSkillWithCover(structuredClone(original), { sourceAssetId: "source:image" }, store.options), /写入校验失败/);
  assert.equal(store.state(), null);
  assert.ok(store.blobs.has(coverFile.assetId));
  assert.equal(store.blobs.size, 2);
});

test("curated covers verify complete bytes and reject corrupt data or paths before use", async () => {
  const item = {cover: {path: "skill-previews/example/1.0.0/cover.gif", sha256: await sha256Hex(image), byteSize:image.size}};
  const verified = await fetchCuratedSkillCover(item, async () => new Response(image));
  assert.equal(await sha256Hex(verified.blob), item.cover.sha256);
  const bytes = new Uint8Array(await image.arrayBuffer()); bytes[bytes.length - 1] ^= 1;
  await assert.rejects(() => fetchCuratedSkillCover(item, async () => new Response(bytes)), /校验失败/);
  await assert.rejects(() => fetchCuratedSkillCover(item, async () => new Response(new Uint8Array(image.size + 1))), /大小不一致/);
  await assert.rejects(() => fetchCuratedSkillCover({cover:{...item.cover,path:"https://untrusted.invalid/cover.gif"}}, () => {throw new Error("must not fetch");}), /清单无效/);
});
