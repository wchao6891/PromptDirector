import test from "node:test";
import assert from "node:assert/strict";

import { createZipBlob } from "../zip.js";
import {
  normalizeCuratedSkillCatalog,
  validateCuratedSkillPackage,
  verifyCuratedSkillPackageBlob
} from "../curated-skill-catalog.js";
import { sha256Hex } from "../sync-crypto.js";

async function fixture() {
  const skill = new Blob(["---\nname: composition-method\ndescription: Compose clearly.\n---\n\n# Method\n\nUse depth.\n"]);
  const archive = await createZipBlob([{ name: "SKILL.md", data: skill }]);
  const sha256 = await sha256Hex(archive);
  const item = {
    id: "composition-method@1.0.0",
    skillId: "composition-method",
    version: "1.0.0",
    title: "Composition Method",
    callName: "composition-method",
    authorId: "creator-one",
    author: "Creator One",
    license: "CC BY 4.0",
    reviewStatus: "approved",
    reviewedAt: "2026-08-23T00:00:00.000Z",
    summary: "A reusable composition method.",
    downloadUrl: "https://github.com/wchao6891/PromptDirector-Curated/releases/download/skills/composition-method.zip",
    sha256,
    archiveBytes: archive.size,
    order: 1
  };
  return { archive, item };
}

test("curated Skill catalog requires stable identity, version, author, license, review and summary", async () => {
  const { item } = await fixture();
  const catalog = normalizeCuratedSkillCatalog({
    format: "prompt-director-curated-skills",
    version: 1,
    updatedAt: "2026-08-23T00:00:00.000Z",
    skills: [item]
  });
  assert.equal(catalog.skills[0].skillId, "composition-method");
  assert.equal(catalog.skills[0].reviewStatus, "approved");
  assert.throws(() => normalizeCuratedSkillCatalog({ ...catalog, skills: [{ ...item, license: "" }] }), /必填字段/);
});

test("curated Skill catalog accepts a readable multilingual call name without relaxing local safety boundaries", async () => {
  const { item } = await fixture();
  const catalogValue = (callName) => ({
    format: "prompt-director-curated-skills",
    version: 1,
    updatedAt: "2026-08-23T00:00:00.000Z",
    skills: [{ ...item, callName }]
  });
  assert.equal(normalizeCuratedSkillCatalog(catalogValue("中式意境巨构")).skills[0].callName, "中式意境巨构");
  for (const callName of ["bad/name", "bad\\name", "bad\u0000name", "构".repeat(81)]) {
    assert.throws(() => normalizeCuratedSkillCatalog(catalogValue(callName)), /必填字段|校验值/);
  }
});

test("verified curated Skill packages accept only SKILL.md and UTF-8 Markdown references", async () => {
  const { archive, item } = await fixture();
  await verifyCuratedSkillPackageBlob(archive, item.sha256, item.archiveBytes);
  const parsed = await validateCuratedSkillPackage(item, archive);
  assert.equal(parsed.name, "composition-method");
  const unsafe = await createZipBlob([
    { name: "SKILL.md", data: new Blob(["---\nname: unsafe\ndescription: Unsafe.\n---\n\n# Unsafe\n"]) },
    { name: "scripts/run.sh", data: new Blob(["echo no"]) }
  ]);
  await assert.rejects(() => validateCuratedSkillPackage({ ...item, skillId: "unsafe", callName: "unsafe" }, unsafe), /不允许的文件/);
});
