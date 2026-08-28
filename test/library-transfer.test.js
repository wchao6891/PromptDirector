import test from "node:test";
import assert from "node:assert/strict";

import { createDefaultFacetCatalog } from "../facets.js";
import { createDefaultTaxonomy, SCHEMA_VERSION } from "../taxonomy.js";
import {
  LIBRARY_TRANSFER_MODES,
  LIBRARY_TRANSFER_SOURCES,
  inspectLibraryTransfer,
  libraryTransferWriteBytes,
  planLibraryTransfer
} from "../library-transfer.js";

test("ZIP and complete-folder adapters produce one canonical inspected transfer", async () => {
  const source = portablePackage([portableEntry("case:one", "image:one")]);
  const files = new Map([[
    "images/case-one/image-one.webp",
    new Blob(["good"], { type: "image/webp" })
  ]]);

  const shared = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.SHARE_PACKAGE,
    library: source,
    files
  });
  const complete = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source,
    files
  });

  assert.deepEqual(shared.state, complete.state);
  assert.deepEqual(shared.report, complete.report);
  assert.deepEqual([...shared.resources.assets.keys()], ["image:one"]);
  assert.deepEqual([...complete.resources.assets.keys()], ["image:one"]);
  assert.equal("assets" in shared.state, false);
  assert.equal("images" in shared.state, false);
  assert.equal("skillAssets" in shared.state, false);
  assert.deepEqual(shared.report.stats, {
    inputCases: 1,
    keptCases: 1,
    skippedCases: 0,
    droppedAiAssignments: 0,
    droppedMediaDescriptors: 0,
    droppedMediaFiles: 0,
    droppedTrashMedia: 0,
    droppedTemporaryAssets: 0,
    droppedCreativeOutputs: 0,
    droppedSkillFiles: 0
  });
});

test("shared inspection isolates an undecodable image without blocking healthy cases", async () => {
  const good = new Blob(["good"], { type: "image/webp" });
  const broken = new Blob(["bad!"], { type: "image/webp" });
  const source = portablePackage([
    portableEntry("case:good", "image:good"),
    portableEntry("case:broken", "image:broken")
  ]);
  const files = new Map([
    ["images/case-good/image-good.webp", good],
    ["images/case-broken/image-broken.webp", broken]
  ]);

  const inspected = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.SHARE_PACKAGE,
    library: source,
    files,
    validateImage: async (blob) => {
      if (blob === broken) throw new Error("decoder rejected bytes");
    }
  });

  assert.deepEqual(inspected.state.entries.map((entry) => entry.id), ["case:good", "case:broken"]);
  assert.deepEqual(inspected.state.entries[0].mediaAssets.map((asset) => asset.id), ["image:good"]);
  assert.deepEqual(inspected.state.entries[1].mediaAssets, []);
  assert.equal(inspected.state.entries[1].text, "正文");
  assert.deepEqual([...inspected.resources.assets.keys()], ["image:good"]);
  assert.equal(inspected.report.stats.droppedMediaFiles, 1);
  assert.deepEqual(inspected.report.diagnostics.filter(({ code }) => code === "media_file_dropped"), [{
    code: "media_file_dropped",
    severity: "media",
    action: "dropped",
    entryId: "case:broken",
    assetId: "image:broken",
    path: "images/case-broken/image-broken.webp",
    reason: "decode_failure"
  }]);
});

test("complete-backup inspection degrades to rescue and isolates an undecodable core image", async () => {
  const source = portablePackage([portableEntry("case:broken", "image:broken")]);
  const broken = new Blob(["bad!"], { type: "image/webp" });

  const inspected = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source,
    files: new Map([["images/case-broken/image-broken.webp", broken]]),
    validateImage: async () => {
      throw new Error("decoder rejected bytes");
    }
  });

  assert.equal(inspected.sourceType, LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP);
  assert.equal(inspected.report.status, "partial");
  assert.deepEqual(inspected.state.entries.map((entry) => entry.id), ["case:broken"]);
  assert.deepEqual(inspected.state.entries[0].mediaAssets, []);
  assert.equal(inspected.state.entries[0].text, "正文");
  assert.deepEqual(inspected.report.diagnostics.map((item) => item.code), [
    "backup_integrity_degraded",
    "media_file_dropped"
  ]);
  assert.throws(() => planLibraryTransfer({
    currentState: portablePackage([]),
    inspection: inspected,
    options: { mode: LIBRARY_TRANSFER_MODES.EXACT_REPLACE }
  }), /救援备份只能安全合并/);
});

test("complete-backup inspection drops one invalid descriptor and keeps the healthy case", async () => {
  const source = portablePackage([
    portableEntry("case:healthy", "image:healthy"),
    portableEntry("case:invalid", "image:invalid")
  ]);
  source.entries[1].mediaAssets[0].assetPath = "../unsafe/image-invalid.webp";
  const inspected = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source,
    files: new Map([["images/case-healthy/image-healthy.webp", new Blob(["good"], { type: "image/webp" })]])
  });

  assert.equal(inspected.sourceType, LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP);
  assert.deepEqual(inspected.state.entries.map((entry) => entry.id), ["case:healthy", "case:invalid"]);
  assert.deepEqual(inspected.state.entries[1].mediaAssets, []);
  assert.equal(inspected.report.stats.droppedMediaDescriptors, 1);
});

test("an unexpected strict parser fault is never disguised as rescue content loss", async () => {
  const source = portablePackage([portableEntry("case:healthy", "image:healthy")]);
  let faultInjected = false;
  const limits = new Proxy({}, {
    get() {
      if (!faultInjected) {
        faultInjected = true;
        throw new Error("unexpected parser fault");
      }
      return undefined;
    }
  });

  await assert.rejects(() => inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source,
    files: new Map([["images/case-healthy/image-healthy.webp", new Blob(["good"], { type: "image/webp" })]]),
    limits
  }), /unexpected parser fault/);
});

test("rescue-backup inspection keeps healthy content and merges envelope diagnostics", async () => {
  const source = portablePackage([
    portableEntry("case:good", "image:good"),
    portableEntry("case:missing", "image:missing")
  ]);
  const inspected = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP,
    library: source,
    files: new Map([[
      "images/case-good/image-good.webp",
      new Blob(["good"], { type: "image/webp" })
    ]]),
    sourceReport: {
      status: "partial",
      diagnostics: [{
        code: "backup_integrity_degraded",
        severity: "backup",
        action: "rescue",
        reason: "missing_complete_marker"
      }],
      stats: {}
    }
  });

  assert.deepEqual(inspected.state.entries.map((entry) => entry.id), ["case:good", "case:missing"]);
  assert.deepEqual(inspected.state.entries[1].mediaAssets, []);
  assert.deepEqual([...inspected.resources.assets.keys()], ["image:good"]);
  assert.deepEqual(inspected.report.diagnostics.map((item) => item.code), [
    "backup_integrity_degraded",
    "media_file_dropped"
  ]);
  assert.equal("importDiagnostics" in inspected.state, false);
  assert.equal("recoveryStatus" in inspected.state, false);
});

test("rescue image decoding isolates a broken private creative result", async () => {
  const source = portablePackage([portableEntry("case:good", "image:good")]);
  source.creativeRuns = [{
    id: "run:broken-image",
    sessionId: "session:broken-image",
    promptVersionId: "prompt:broken-image",
    promptText: "保留历史提示词",
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    outputs: [{
      visual: {
        id: "creative:broken-image",
        kind: "image",
        mimeType: "image/webp",
        byteSize: 4,
        capturedAt: "2026-08-27T00:00:00.000Z",
        assetPath: "creative-results/run-broken/creative-broken.webp"
      },
      capturedAt: "2026-08-27T00:00:00.000Z",
      signals: [{ type: "captured", at: "2026-08-27T00:00:00.000Z" }]
    }]
  }];
  const good = new Blob(["good"], { type: "image/webp" });
  const broken = new Blob(["bad!"], { type: "image/webp" });

  const inspected = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP,
    library: source,
    files: new Map([
      ["images/case-good/image-good.webp", good],
      ["creative-results/run-broken/creative-broken.webp", broken]
    ]),
    validateImage: async (blob) => {
      if (blob === broken) throw new Error("decoder rejected bytes");
    }
  });

  assert.deepEqual(inspected.state.creativeRuns[0].outputs, []);
  assert.equal(inspected.state.creativeRuns[0].promptText, "保留历史提示词");
  assert.deepEqual(inspected.report.diagnostics.find((item) => item.assetId === "creative:broken-image"), {
    code: "creative_output_dropped",
    severity: "media",
    action: "dropped",
    assetId: "creative:broken-image",
    path: "creative-results/run-broken/creative-broken.webp",
    reason: "decode_failure"
  });
});

test("a transfer plan binds collision mappings resources and receiver-local metadata", async () => {
  const source = portablePackage([portableEntry("case:one", "image:one")]);
  source.organizerState.collections = [{
    id: "collection:one",
    name: "来源项目",
    parentId: null,
    order: 0,
    entryIds: ["case:one"]
  }];
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.SHARE_PACKAGE,
    library: source,
    files: new Map([[
      "images/case-one/image-one.webp",
      new Blob(["good"], { type: "image/webp" })
    ]])
  });
  const current = portablePackage([{
    ...portableEntry("case:one", "image:local"),
    title: "本机已有的不同案例",
    text: "本机正文"
  }]);
  current.organizerState.collections = [{
    id: "collection:one",
    name: "本机项目",
    parentId: null,
    order: 0,
    entryIds: ["case:one"]
  }];

  const first = planLibraryTransfer({
    currentState: current,
    inspection,
    options: {
      preserveLibraryConfiguration: true,
      now: "2026-08-27T08:00:00.000Z",
      importBatchId: "library-import:test-plan",
      conflictResolutions: { "case:one": "keep-both" }
    }
  });
  const replay = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { preferredPlan: first.context }
  });

  assert.equal(first.targetState.entries.length, 2);
  assert.notEqual(first.mappings.entryIds["case:one"], "case:one");
  assert.notEqual(first.mappings.collectionIds["collection:one"], "collection:one");
  assert.deepEqual(first.resourceWrites, [{
    sourceId: "image:one",
    targetId: first.mappings.visualIds["image:one"],
    resourceType: "media"
  }]);
  assert.equal(first.context.libraryAddedAt, "2026-08-27T08:00:00.000Z");
  assert.equal(first.context.importBatchId, "library-import:test-plan");
  assert.deepEqual(replay.targetState, first.targetState);
  assert.equal(replay.planToken, first.planToken);
});

test("a confirmed plan reuses facet and tag collision mappings", async () => {
  const source = portablePackage([portableEntry("case:source", "image:source")]);
  source.facetCatalog = catalogWithCollision("来源维度", "来源标签");
  source.entries[0].facetAssignments = [{
    facetId: "facet:collision",
    nodeId: "tag:collision",
    status: "confirmed",
    source: "manual"
  }];
  const current = portablePackage([]);
  current.facetCatalog = catalogWithCollision("本机维度", "本机标签");
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.SHARE_PACKAGE,
    library: source,
    files: new Map([[
      "images/case-source/image-source.webp",
      new Blob(["good"], { type: "image/webp" })
    ]])
  });

  const first = planLibraryTransfer({
    currentState: current,
    inspection,
    options: {
      preserveLibraryConfiguration: true,
      now: "2026-08-27T08:30:00.000Z",
      importBatchId: "library-import:facet-plan"
    }
  });
  const replay = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { preferredPlan: first.context }
  });

  assert.notEqual(first.mappings.facetIds["facet:collision"], "facet:collision");
  assert.notEqual(first.mappings.nodeIds["tag:collision"], "tag:collision");
  assert.deepEqual(replay.targetState, first.targetState);
  assert.equal(replay.planToken, first.planToken);
});

test("a confirmed plan reuses trash identity mappings", async () => {
  const source = portablePackage([portableEntry("case:source", "image:source")]);
  source.trashState.items = [trashedEntry("case:trash", "来源回收站案例")];
  const current = portablePackage([portableEntry("case:current", "image:current")]);
  current.trashState.items = [trashedEntry("case:trash", "本机回收站案例")];
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.SHARE_PACKAGE,
    library: source,
    files: new Map([[
      "images/case-source/image-source.webp",
      new Blob(["good"], { type: "image/webp" })
    ]])
  });

  const first = planLibraryTransfer({
    currentState: current,
    inspection,
    options: {
      preserveLibraryConfiguration: true,
      now: "2026-08-27T09:00:00.000Z",
      importBatchId: "library-import:trash-plan"
    }
  });
  const replay = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { preferredPlan: first.context }
  });

  assert.notEqual(first.mappings.trashEntryIds["case:trash"], "case:trash");
  assert.deepEqual(replay.targetState, first.targetState);
  assert.equal(replay.planToken, first.planToken);
});

test("a confirmed plan reuses Skill version mappings", async () => {
  const source = portablePackage([portableEntry("case:source", "image:source")]);
  source.creativeSkills = { version: 1, items: [portableSkill("skill:source", "skill-file:source", "来源方法")] };
  const appliedSkill = {
    skillId: "skill:source",
    versionId: "skill-version:collision",
    callName: "来源方法",
    portableId: "skill-source",
    description: "可恢复方法",
    skillMarkdown: "# 方法",
    references: [],
    source: "imported",
    textMode: false
  };
  source.composerSessions = [{
    id: "session:source",
    title: "使用来源方法的草稿",
    appliedSkills: [appliedSkill],
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z"
  }];
  source.creativeRuns = [{
    id: "run:source",
    sessionId: "session:source",
    promptVersionId: "prompt:source",
    promptText: "保留方法关系",
    appliedSkills: [appliedSkill],
    outputs: [],
    createdAt: "2026-08-27T00:01:00.000Z",
    updatedAt: "2026-08-27T00:01:00.000Z"
  }];
  const current = portablePackage([portableEntry("case:current", "image:current")]);
  current.creativeSkills = { version: 1, items: [portableSkill("skill:current", "skill-file:current", "本机方法")] };
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source,
    files: new Map([
      ["images/case-source/image-source.webp", new Blob(["good"], { type: "image/webp" })],
      ["skills/source/SKILL.md", new Blob(["skill"], { type: "text/markdown" })]
    ])
  });

  const first = planLibraryTransfer({
    currentState: current,
    inspection,
    options: {
      preserveLibraryConfiguration: true,
      now: "2026-08-27T09:30:00.000Z",
      importBatchId: "library-import:skill-plan"
    }
  });
  const replay = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { preferredPlan: first.context }
  });

  assert.notEqual(first.mappings.skillVersionIds["skill-version:collision"], "skill-version:collision");
  assert.equal(first.targetState.composerSessions[0].appliedSkills[0].skillId, first.mappings.skillIds["skill:source"]);
  assert.equal(first.targetState.composerSessions[0].appliedSkills[0].versionId, first.mappings.skillVersionIds["skill-version:collision"]);
  assert.equal(first.targetState.creativeRuns[0].appliedSkills[0].skillId, first.mappings.skillIds["skill:source"]);
  assert.equal(first.targetState.creativeRuns[0].appliedSkills[0].versionId, first.mappings.skillVersionIds["skill-version:collision"]);
  assert.deepEqual(replay.targetState, first.targetState);
  assert.equal(replay.planToken, first.planToken);
});

test("safe merge keeps the local version of a same-id conflict until the user chooses otherwise", async () => {
  const current = portablePackage([portableTextEntry("case:shared", "本机修改")]);
  const source = portablePackage([portableTextEntry("case:shared", "备份修改")]);
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source
  });

  const plan = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { mode: LIBRARY_TRANSFER_MODES.SAFE_MERGE }
  });

  assert.equal(plan.context.mode, LIBRARY_TRANSFER_MODES.SAFE_MERGE);
  assert.equal(plan.targetState.entries.length, 1);
  assert.equal(plan.targetState.entries[0].text, "本机修改");
  assert.deepEqual(plan.conflicts, [{
    entryId: "case:shared",
    localTitle: "可恢复案例",
    incomingTitle: "可恢复案例",
    resolution: "keep-local"
  }]);
});

test("safe merge can adopt the incoming conflict and move that case to the incoming project structure", async () => {
  const current = portablePackage([portableTextEntry("case:shared", "本机修改")]);
  current.organizerState.collections = [{
    id: "collection:local",
    name: "本机项目",
    parentId: null,
    order: 0,
    entryIds: ["case:shared"]
  }];
  const source = portablePackage([portableTextEntry("case:shared", "备份修改")]);
  source.organizerState.collections = [{
    id: "collection:incoming",
    name: "备份项目",
    parentId: null,
    order: 0,
    entryIds: ["case:shared"]
  }];
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source
  });

  const plan = planLibraryTransfer({
    currentState: current,
    inspection,
    options: {
      mode: LIBRARY_TRANSFER_MODES.SAFE_MERGE,
      conflictResolutions: { "case:shared": "use-incoming" }
    }
  });

  assert.equal(plan.targetState.entries.length, 1);
  assert.equal(plan.targetState.entries[0].text, "备份修改");
  assert.deepEqual(
    plan.targetState.organizerState.collections.map((collection) => [collection.name, collection.entryIds]),
    [["本机项目", []], ["备份项目", ["case:shared"]]]
  );
  assert.equal(plan.conflicts[0].resolution, "use-incoming");
});

test("safe merge deduplicates identical meaning across different ids and combines project membership", async () => {
  const currentInspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: portablePackage([portableTextEntry("case:local", "同一内容")])
  });
  const current = currentInspection.state;
  current.organizerState.collections = [{
    id: "collection:local",
    name: "本机项目",
    parentId: null,
    order: 0,
    entryIds: ["case:local"]
  }];
  const source = portablePackage([portableTextEntry("case:incoming", "同一内容")]);
  source.organizerState.collections = [{
    id: "collection:incoming",
    name: "备份项目",
    parentId: null,
    order: 0,
    entryIds: ["case:incoming"]
  }];
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source
  });

  const plan = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { mode: LIBRARY_TRANSFER_MODES.SAFE_MERGE }
  });

  assert.equal(plan.targetState.entries.length, 1);
  assert.equal(plan.mappings.entryIds["case:incoming"], "case:local");
  assert.deepEqual(
    plan.targetState.organizerState.collections.map((collection) => collection.entryIds),
    [["case:local"], ["case:local"]]
  );
});

test("exact replace uses only backup-managed data and stages every incoming resource under an isolated id", async () => {
  const current = portablePackage([portableEntry("case:local", "image:local")]);
  const source = portablePackage([portableEntry("case:backup", "image:backup")]);
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP,
    library: source,
    files: new Map([[
      "images/case-backup/image-backup.webp",
      new Blob(["good"], { type: "image/webp" })
    ]])
  });

  const first = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { mode: LIBRARY_TRANSFER_MODES.EXACT_REPLACE }
  });
  const replay = planLibraryTransfer({
    currentState: current,
    inspection,
    options: { preferredPlan: first.context }
  });

  assert.equal(first.context.mode, LIBRARY_TRANSFER_MODES.EXACT_REPLACE);
  assert.equal(first.context.sourceType, LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP);
  assert.deepEqual(first.targetState.entries.map((entry) => entry.id), ["case:backup"]);
  assert.equal(first.targetState.entries.some((entry) => entry.id === "case:local"), false);
  assert.equal(first.rollback.required, true);
  assert.deepEqual(first.rollback.retainedAssetIds, ["image:local"]);
  assert.equal(first.resourceWrites.length, 1);
  assert.equal(first.resourceWrites[0].sourceId, "image:backup");
  assert.notEqual(first.resourceWrites[0].targetId, "image:backup");
  assert.notEqual(first.resourceWrites[0].targetId, "image:local");
  assert.equal(first.targetState.entries[0].mediaAssets[0].id, first.resourceWrites[0].targetId);
  assert.deepEqual(replay.targetState, first.targetState);
  assert.equal(replay.planToken, first.planToken);
});

test("a rescue backup cannot request exact replacement", async () => {
  const inspection = await inspectLibraryTransfer({
    sourceType: LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP,
    library: portablePackage([portableTextEntry("case:rescued", "可恢复正文")]),
    sourceReport: {
      status: "partial",
      diagnostics: [{ code: "backup_integrity_degraded", severity: "backup", action: "rescue" }],
      stats: {}
    }
  });

  assert.throws(() => planLibraryTransfer({
    currentState: portablePackage([]),
    inspection,
    options: { mode: LIBRARY_TRANSFER_MODES.EXACT_REPLACE }
  }), /救援备份只能安全合并/);
});

test("transfer capacity uses every planned media and Skill write and rejects a stale resource plan", () => {
  const resources = {
    assets: new Map([["media:one", new Blob(["1234"], { type: "image/webp" })]]),
    skillAssets: new Map([["skill-file:one", new Blob(["12345"], { type: "text/markdown" })]])
  };
  const writes = [
    { sourceId: "media:one", targetId: "restore:media", resourceType: "media" },
    { sourceId: "skill-file:one", targetId: "restore:skill", resourceType: "skill" }
  ];

  assert.equal(libraryTransferWriteBytes(writes, resources), 9);
  assert.throws(() => libraryTransferWriteBytes([
    ...writes,
    { sourceId: "media:missing", targetId: "restore:missing", resourceType: "media" }
  ], resources), /资源已经变化/);
});

function portablePackage(entries) {
  return {
    format: "prompt-case-library",
    version: 5,
    schemaVersion: SCHEMA_VERSION,
    entries,
    trashState: { version: 1, items: [] },
    settings: {},
    taxonomy: createDefaultTaxonomy(),
    facetCatalog: createDefaultFacetCatalog(),
    classificationRules: [],
    organizerState: { version: 1, collections: [] },
    compoundCases: [],
    composerSettings: {},
    composerSessions: [],
    creativeExperimentSettings: {},
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] }
  };
}

function portableEntry(id, assetId) {
  const safeEntryId = id.replaceAll(":", "-");
  const safeAssetId = assetId.replaceAll(":", "-");
  return {
    id,
    title: "可恢复案例",
    text: "正文",
    mediaAssets: [{
      id: assetId,
      kind: "image",
      storageMode: "managed",
      sourceTitle: `${safeAssetId}.webp`,
      sourceFormat: "webp",
      mimeType: "image/webp",
      byteSize: 4,
      capturedAt: "2026-08-27T00:00:00.000Z",
      assetPath: `images/${safeEntryId}/${safeAssetId}.webp`
    }],
    primaryMediaId: assetId,
    customLabels: [],
    metadataLabels: [],
    facetAssignments: []
  };
}

function portableTextEntry(id, text) {
  return {
    id,
    title: "可恢复案例",
    text,
    mediaAssets: [],
    primaryMediaId: "",
    customLabels: [],
    metadataLabels: [],
    facetAssignments: []
  };
}

function catalogWithCollision(facetName, nodeName) {
  const catalog = createDefaultFacetCatalog();
  catalog.facets.push({
    id: "facet:collision",
    name: facetName,
    color: "#456789",
    order: catalog.facets.length,
    aliases: [],
    status: "active",
    kind: "facet",
    origin: "manual",
    fixed: false
  });
  catalog.nodes.push({
    id: "tag:collision",
    name: nodeName,
    facetId: "facet:collision",
    parentId: null,
    order: catalog.nodes.length,
    aliases: [],
    patterns: [],
    status: "active",
    kind: "group",
    origin: "manual",
    fixed: false,
    protected: false
  });
  return catalog;
}

function trashedEntry(id, title) {
  return {
    id: `trash:entry:${id}`,
    kind: "entry",
    targetId: id,
    deletedAt: "2026-08-27T00:00:00.000Z",
    snapshot: {
      id,
      title,
      text: "回收站正文",
      mediaAssets: [],
      primaryMediaId: "",
      facetAssignments: []
    },
    relationships: { collections: [], compoundCases: [] }
  };
}

function portableSkill(id, assetId, callName) {
  return {
    id,
    callName,
    portableId: id.replaceAll(":", "-"),
    description: "可恢复方法",
    currentVersionId: "skill-version:collision",
    versions: [{
      id: "skill-version:collision",
      createdAt: "2026-08-27T00:00:00.000Z",
      reason: "imported",
      source: "imported",
      skillMarkdown: "# 方法",
      references: [],
      provenanceMarkdown: ""
    }],
    packageFiles: [{
      path: "SKILL.md",
      assetId,
      byteSize: 5,
      mimeType: "text/markdown",
      archivePath: "skills/source/SKILL.md"
    }],
    textModeConfirmed: false,
    runtimeDependencies: [],
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z"
  };
}
