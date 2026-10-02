import test from "node:test";
import assert from "node:assert/strict";

import {
  createAppliedSkillSnapshot,
  createCreativeSkill,
  createCreativeSkillsState,
  deleteCreativeSkill,
  findCreativeSkillsBySlashQuery,
  mergeCreativeSkillsState,
  normalizeAppliedSkillSnapshots,
  restoreCreativeSkillVersion,
  saveCreativeSkillVersion
} from "../extension/creative-skills.js";
import {
  extractCreativeSkillDraft,
  creativeRunEvidenceCandidates,
  selectedCreativeRunEvidenceSources
} from "../extension/creative-skill-service.js";

test("official portable names preserve 64 characters and duplicate suffixes without truncating user call names", () => {
  const portableId = 'a'.repeat(64);
  const first = createSkill({}, '完整调用名', { portableId });
  assert.equal(first.skill.portableId, portableId);
  const second = createSkill(first.state, '独立调用名', { portableId });
  assert.equal(second.skill.portableId.length, 64);
  assert.notEqual(second.skill.portableId, portableId);
  assert.equal(second.skill.callName, '独立调用名');
  assert.throws(() => createSkill({}, '不要偷偷裁短 ID', { portableId: 'a'.repeat(65) }), /Agent Skills 规范/);
});

test("Skill extraction retains the complete long heading and the user's complete extraction goal", async () => {
  const heading = '完整方法名称'.repeat(20);
  const goal = '用户明确的提炼目标'.repeat(40) + '最后一项要求';
  const markdown = `# ${heading}\n保留完整方法。`;
  const draft = await extractCreativeSkillDraft({ goal, sources: [{ prompt: '原始案例' }] }, {
    ai: { apiKey: 'isolated-fixture', consent: true, composerModel: 'deepseek-v4-flash' }
  }, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: markdown } }] })) });
  assert.equal(draft.callName, heading);
  assert.equal(draft.description, goal);
  assert.equal(draft.markdown, markdown);
});

function createSkill(state, name = "国风视觉", overrides = {}) {
  return createCreativeSkill(state, {
    callName: name,
    description: "将中国审美根系转成画面方法",
    skillMarkdown: "# 国风视觉\n\n围绕用户目标建立有根的视觉方向。",
    provenanceMarkdown: "# 来源\n\n由 3 个匿名案例提炼。",
    ...overrides
  }, { id: `skill:${name}`, versionId: `version:${name}:1`, now: "2026-08-06T00:00:00.000Z" });
}

test("creative skills keep a unique multilingual call name and stable portable id", () => {
  const first = createSkill(createCreativeSkillsState());
  assert.match(first.skill.portableId, /^[a-z0-9-]{1,63}$/);
  assert.throws(() => createSkill(first.state, " 国 风 视 觉 "), /调用名已经存在/);

  const renamed = saveCreativeSkillVersion(first.state, first.skill.id, {
    callName: "东方视觉",
    skillMarkdown: "# 东方视觉\n\n保留原方法。"
  }, { versionId: "version:2", now: "2026-08-06T01:00:00.000Z" });
  assert.equal(renamed.skill.portableId, first.skill.portableId);
  assert.equal(findCreativeSkillsBySlashQuery(renamed.state, "东方")[0].id, first.skill.id);
});

test("every saved Skill version stays recoverable beyond the former ten-version quota", () => {
  let { state, skill } = createSkill(createCreativeSkillsState(), "诺兰");
  for (let index = 2; index <= 12; index += 1) {
    ({ state, skill } = saveCreativeSkillVersion(state, skill.id, {
      skillMarkdown: `# 诺兰\n\n方法版本 ${index}`
    }, { versionId: `version:${index}`, now: `2026-08-06T${String(index).padStart(2, "0")}:00:00.000Z` }));
  }
  assert.equal(skill.versions.length, 12);
  assert.equal(skill.versions[0].id, "version:诺兰:1");

  const restored = restoreCreativeSkillVersion(state, skill.id, "version:诺兰:1", {
    versionId: "version:restored", now: "2026-08-07T00:00:00.000Z"
  });
  assert.equal(restored.skill.currentVersionId, "version:restored");
  assert.match(restored.version.skillMarkdown, /围绕用户目标/);
  assert.equal(restored.skill.versions.length, 13);
});

test("composer snapshots freeze the selected version and preserve user order", () => {
  const one = createSkill(createCreativeSkillsState(), "广告大片", {
    portableId: "advertising-blockbuster",
    references: [{ path: "references/runtime.md", markdown: "只在调用时读取", runtime: true }]
  });
  const two = createSkill(one.state, "游戏CG", { portableId: "game-cg" });
  const snapshots = [createAppliedSkillSnapshot(two.skill), createAppliedSkillSnapshot(one.skill)];
  assert.deepEqual(normalizeAppliedSkillSnapshots(snapshots).map((item) => item.callName), ["游戏CG", "广告大片"]);
  assert.equal(snapshots[1].references[0].path, "references/runtime.md");
});

test("deleting a skill returns package assets for transactional cleanup", () => {
  const created = createSkill(createCreativeSkillsState(), "外部技能", {
    packageFiles: [{ path: "scripts/tool.py", assetId: "skill-file:tool", byteSize: 12 }]
  });
  const removed = deleteCreativeSkill(created.state, created.skill.id);
  assert.equal(removed.state.items.length, 0);
  assert.equal(removed.skill.packageFiles[0].assetId, "skill-file:tool");
});

test("curated origin survives normalization and local version edits", () => {
  const created = createSkill(createCreativeSkillsState(), "精选方法", {
    curatedOrigin: {
      catalogId: "composition@1.0.0",
      skillId: "composition",
      version: "1.0.0",
      sha256: "a".repeat(64),
      installedAt: "2026-08-23T00:00:00.000Z"
    }
  });
  const updated = saveCreativeSkillVersion(created.state, created.skill.id, {
    skillMarkdown: "# 本地修改\n\nKeep this local edit."
  }, { versionId: "version:local", now: "2026-08-23T01:00:00.000Z" });
  assert.equal(updated.skill.curatedOrigin.skillId, "composition");
  assert.equal(updated.skill.curatedOrigin.version, "1.0.0");
  assert.match(updated.skill.versions.at(-1).skillMarkdown, /本地修改/);
});

test("full-library imports preserve versions and remap conflicting Skill identities", () => {
  const local = createSkill(createCreativeSkillsState(), "国风视觉", { portableId: "guofeng-visual" });
  const external = createCreativeSkill(createCreativeSkillsState(), {
    callName: "国风视觉",
    description: "将中国审美根系转成画面方法",
    skillMarkdown: "# 国风视觉\n\n围绕用户目标建立有根的视觉方向。",
    portableId: "guofeng-visual",
    packageFiles: [{ path: "SKILL.md", assetId: "skill-file:external", byteSize: 12, archivePath: "skills/guofeng/skill-file/SKILL.md" }]
  }, { id: "skill:external", versionId: "version:external", now: "2026-08-06T00:00:00.000Z" });
  const merged = mergeCreativeSkillsState(local.state, external.state, {
    skillIdMap: { [external.skill.id]: "skill:imported" },
    packageAssetIdMap: { "skill-file:external": "skill-file:imported" }
  });
  assert.equal(merged.state.items.length, 2);
  assert.equal(merged.state.items[1].callName, "国风视觉 2");
  assert.equal(merged.state.items[1].portableId, "guofeng-visual-2");
  assert.equal(merged.state.items[1].packageFiles[0].assetId, "skill-file:imported");
  assert.equal(Object.hasOwn(merged.state.items[1].packageFiles[0], "archivePath"), false);
});

test("Skill refinement includes only explicitly selected judgments from runs that used this Skill", () => {
  const runs = [
    {
      id: "run:used",
      title: "使用过当前 Skill",
      promptText: "电影感人物提示词",
      appliedSkills: [{ skillId: "skill:target", versionId: "version:one" }],
      outputs: [
        { visual: { id: "visual:judged" }, judgment: { keep: "保留主体层级", improve: "减弱背景" } },
        { visual: { id: "visual:unjudged" } }
      ]
    },
    {
      id: "run:other",
      title: "其他 Skill",
      promptText: "不应进入",
      appliedSkills: [{ skillId: "skill:other", versionId: "version:other" }],
      outputs: [{ visual: { id: "visual:other" }, judgment: { keep: "不应进入" } }]
    }
  ];
  const candidates = creativeRunEvidenceCandidates(runs, "skill:target");
  assert.deepEqual(candidates.map((item) => item.id), ["run:used:visual:judged"]);
  assert.deepEqual(selectedCreativeRunEvidenceSources(runs, [], "skill:target"), []);
  const selected = selectedCreativeRunEvidenceSources(runs, [candidates[0].id], "skill:target");
  assert.equal(selected.length, 1);
  assert.match(selected[0].analysis, /值得保留：保留主体层级/);
  assert.match(selected[0].analysis, /需要改进：减弱背景/);
  assert.doesNotMatch(JSON.stringify(selected), /visual:judged|run:used|skill:target/);
});

test("a full human Skill call name is retained independently of its portable identifier", () => {
  const callName = "用户完整创作方法".repeat(20);
  const result = createSkill(createCreativeSkillsState(), callName);
  assert.equal(result.skill.callName, callName);
});
