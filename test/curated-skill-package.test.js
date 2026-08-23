import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCuratedSkillSnapshot,
  buildCuratedSkillSubmissionArchive
} from "../curated-skill-package.js";
import { currentCreativeSkillVersion, createCreativeSkill, createCreativeSkillsState } from "../creative-skills.js";
import { readZipBlob } from "../zip.js";

function fixture(overrides = {}) {
  return createCreativeSkill(createCreativeSkillsState(), {
    callName: "构图方法",
    portableId: "composition-method",
    description: "把主体层级组织成清晰画面。",
    skillMarkdown: "# 构图方法\n\n保持主体清晰。",
    references: [{ path: "references/guide.md", markdown: "# Guide\n\nUse depth.", runtime: true }],
    provenanceMarkdown: "# 私人来源\n\n/Users/private/cases.md"
  }, { id: "local:one", versionId: "version:one", now: "2026-08-23T00:00:00.000Z" }).skill;
}

test("curated submission snapshot is text-only, exact-previewable, and excludes private provenance by default", async () => {
  const skill = fixture();
  const snapshot = await buildCuratedSkillSnapshot(skill, {
    author: "Creator One",
    summary: "A reusable composition method.",
    rightsConfirmed: true
  });
  assert.deepEqual([...snapshot.files.keys()], ["SKILL.md", "references/guide.md"]);
  assert.equal(snapshot.findings.length, 0);
  assert.doesNotMatch(await snapshot.files.get("SKILL.md").text(), /私人来源|\/Users\/private/);
  assert.equal(snapshot.manifest.reviewStatus, "pending");
  assert.equal(snapshot.manifest.skillId, "composition-method");
  assert.equal(snapshot.manifest.callName, "构图方法");
  assert.equal(snapshot.manifest.author, "Creator One");
  assert.equal(snapshot.manifest.license, "CC BY 4.0");
  assert.equal("authorId" in snapshot.manifest, false);
  assert.equal("skillVersion" in snapshot.manifest, false);
  assert.equal(snapshot.preview[0].text, await snapshot.files.get("SKILL.md").text());
  assert.equal(currentCreativeSkillVersion(skill).provenanceMarkdown.includes("private"), true);
});

test("privacy findings are reported without mutating the final preview", async () => {
  const skill = fixture();
  skill.versions[0].skillMarkdown = "# Method\n\nAPI_KEY=\"secret-value-123456\", /Users/alice/private.md, alice@example.com";
  const snapshot = await buildCuratedSkillSnapshot(skill, {
    author: "Creator One",
    summary: "A reusable composition method.",
    rightsConfirmed: true
  });
  assert.deepEqual(new Set(snapshot.findings.map((item) => item.kind)), new Set(["credential", "local-path", "personal-identifier"]));
  assert.match(snapshot.preview[0].text, /secret-value-123456/);
  assert.match(snapshot.preview[0].text, /\/Users\/alice/);
  await assert.rejects(() => buildCuratedSkillSubmissionArchive(snapshot), /隐私风险/);
});

test("submission archive contains a manifest and the reviewed text payload only", async () => {
  const snapshot = await buildCuratedSkillSnapshot(fixture(), {
    author: "Creator One",
    summary: "A reusable composition method.",
    rightsConfirmed: true
  });
  const archive = await buildCuratedSkillSubmissionArchive(snapshot);
  const outer = await readZipBlob(archive);
  assert.deepEqual([...outer.keys()], ["submission.json", "payload.zip"]);
  const manifest = JSON.parse(await outer.get("submission.json").text());
  assert.equal(manifest.format, "prompt-director-curated-skill-submission");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.license, "CC BY 4.0");
  assert.equal("authorId" in manifest, false);
  assert.equal("skillVersion" in manifest, false);
  const payload = await readZipBlob(outer.get("payload.zip"));
  assert.deepEqual([...payload.keys()], ["SKILL.md", "references/guide.md"]);
});

test("curated submission rejects missing public consent and derives its stable id from the Skill", async () => {
  await assert.rejects(() => buildCuratedSkillSnapshot(fixture(), {
    author: "Creator One",
    summary: "A reusable composition method.",
    rightsConfirmed: false,
    publicSkillId: "user-overridden-id"
  }), /允许其他用户/);

  const snapshot = await buildCuratedSkillSnapshot(fixture(), {
    author: "Creator One",
    summary: "A reusable composition method.",
    rightsConfirmed: true,
    publicSkillId: "user-overridden-id",
    publicVersion: "99.0.0",
    authorId: "hidden-maintenance-field",
    license: "MIT"
  });
  assert.equal(snapshot.manifest.skillId, "composition-method");
  assert.equal(snapshot.manifest.license, "CC BY 4.0");
  assert.equal("authorId" in snapshot.manifest, false);
  assert.equal("skillVersion" in snapshot.manifest, false);
});
