import test from "node:test";
import assert from "node:assert/strict";

import { installCuratedSkillTransaction, planCuratedSkillInstall } from "../curated-skill-install.js";

const item = { id: "composition@1.0.0", skillId: "composition", version: "1.0.0", sha256: "a".repeat(64) };
const parsed = {
  name: "composition",
  description: "Compose clearly.",
  body: "# Method\n\nUse depth.",
  references: [],
  files: new Map([["SKILL.md", new Blob(["skill"])]]),
  dependencies: [],
  requiresTextModeConfirmation: false
};

test("same curated Skill version is idempotent while a new version becomes a separate safe copy", () => {
  const state = { version: 1, items: [{
    id: "local:one", callName: "composition", portableId: "composition", currentVersionId: "version:local",
    versions: [{ id: "version:local", skillMarkdown: "# locally edited", createdAt: "2026-08-23T00:00:00.000Z" }],
    curatedOrigin: { skillId: "composition", version: "1.0.0", catalogId: "composition@1.0.0" }
  }] };
  assert.equal(planCuratedSkillInstall(state, item).action, "already-installed");
  assert.equal(planCuratedSkillInstall(state, { ...item, id: "composition@1.1.0", version: "1.1.0" }).action, "install-update-copy");
});

test("install saves files before metadata and rolls all new files back when metadata commit fails", async () => {
  const events = [];
  await assert.rejects(() => installCuratedSkillTransaction({
    state: { version: 1, items: [] }, item, parsed,
    assetIdFactory: () => "skill-file:new",
    saveBlob: async (id) => { events.push(`save:${id}`); },
    deleteBlobs: async (ids) => { events.push(`delete:${ids.join(",")}`); },
    createSkill: async () => { events.push("commit"); throw new Error("commit failed"); }
  }), /commit failed/);
  assert.deepEqual(events, ["save:skill-file:new", "commit", "delete:skill-file:new"]);
});

test("install uses the reviewed catalog call name while keeping the package name as the portable id", async () => {
  let created;
  await installCuratedSkillTransaction({
    state: { version: 1, items: [] },
    item: { ...item, callName: "中式意境巨构" },
    parsed,
    assetIdFactory: () => "skill-file:new",
    saveBlob: async () => undefined,
    deleteBlobs: async () => undefined,
    createSkill: async (skill) => { created = skill; return { skill }; }
  });
  assert.equal(created.callName, "中式意境巨构");
  assert.equal(created.portableId, "composition");
});

test("install safely renames a reviewed call name that conflicts with a local Skill", async () => {
  const reviewedName = "构".repeat(80);
  let created;
  await installCuratedSkillTransaction({
    state: { version: 1, items: [{
      id: "local:existing", callName: reviewedName, portableId: "local-composition", currentVersionId: "v1",
      versions: [{ id: "v1", skillMarkdown: "# 本地方法", createdAt: "2026-08-23T00:00:00.000Z" }]
    }] },
    item: { ...item, callName: reviewedName },
    parsed,
    assetIdFactory: () => "skill-file:new",
    saveBlob: async () => undefined,
    deleteBlobs: async () => undefined,
    createSkill: async (skill) => { created = skill; return { skill }; }
  });
  assert.equal(created.callName, `${"构".repeat(78)} 2`);
  assert.equal(created.callName.length, 80);
  assert.equal(created.portableId, "composition");
});

test("idempotent install performs no file or metadata writes", async () => {
  const state = { version: 1, items: [{
    id: "local:one", callName: "composition", portableId: "composition", currentVersionId: "v1",
    versions: [{ id: "v1", skillMarkdown: "# Method", createdAt: "2026-08-23T00:00:00.000Z" }],
    curatedOrigin: { skillId: "composition", version: "1.0.0", catalogId: "composition@1.0.0" }
  }] };
  let writes = 0;
  const result = await installCuratedSkillTransaction({
    state, item, parsed,
    saveBlob: async () => { writes += 1; },
    deleteBlobs: async () => { writes += 1; },
    createSkill: async () => { writes += 1; }
  });
  assert.equal(result.status, "already-installed");
  assert.equal(writes, 0);
});

test("rollback failure is visible instead of hiding orphaned temporary files", async () => {
  await assert.rejects(() => installCuratedSkillTransaction({
    state: { version: 1, items: [] }, item, parsed,
    assetIdFactory: () => "skill-file:new",
    saveBlob: async () => undefined,
    deleteBlobs: async () => { throw new Error("cleanup failed"); },
    createSkill: async () => { throw new Error("commit failed"); }
  }), /回滚未完成/);
});
