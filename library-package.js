import { normalizeFacetCatalog, uniqueNames } from "./facets.js";
import { normalizeSettings } from "./lib.js";
import { SCHEMA_VERSION, mergeTaxonomies, normalizeTaxonomy } from "./taxonomy.js";
import { createDefaultOrganizerState, mergeOrganizerState, normalizeOrganizerState } from "./organizer.js";
import { normalizeComposerSessions, normalizeComposerSettings } from "./composer.js";
import { normalizeCreativeExperimentSettings, normalizeCreativeRuns } from "./creative-runs.js";
import { mergeCreativeSkillsState, normalizeCreativeSkillsState } from "./creative-skills.js";
import { formatBytes, portableLibraryLimits } from "./resource-limits.js";
import { normalizeEntryVisuals } from "./visuals.js";
import { normalizeEntryMedia } from "./media.js";
import { expandLogicalCaseIds, normalizeCompoundCases } from "./compound-cases.js";
import { isFixedTagTree, migrateLegacyFacetState } from "./tag-taxonomy.js";
import { migrateLibraryState } from "./migration.js";
import { LIBRARY_PACKAGE_FORMAT, isSupportedLibraryPackageVersion } from "./library-package-format.js";

export function parseLibraryPackage(value, files = new Map(), limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  const skipMediaByteValidation = limitsValue?.skipMediaByteValidation === true;
  if (!value || value.format !== LIBRARY_PACKAGE_FORMAT || !isSupportedLibraryPackageVersion(value.version) || !Array.isArray(value.entries)) {
    throw new Error("这个 ZIP 不是受支持的 PromptDirector 分享包");
  }
  if (value.entries.length > limits.maxEntries) {
    throw new Error(`案例数量超过 ${limits.maxEntries} 条上限`);
  }
  const data = structuredClone(value);
  data.settings = normalizeSettings(data.settings);
  data.taxonomy = normalizeTaxonomy(data.taxonomy);
  data.facetCatalog = normalizeFacetCatalog(data.facetCatalog);
  data.classificationRules = Array.isArray(data.classificationRules) ? data.classificationRules : [];
  const ids = new Set();
  const visualIds = new Set();
  const assets = new Map();
  const images = new Map();
  const skillAssets = new Map();
  data.entries = data.entries.map((entry) => {
    const normalized = normalizeEntryVisuals(entry);
    normalized.customLabels = uniqueNames(entry?.customLabels);
    normalized.metadataLabels = uniqueNames(entry?.metadataLabels);
    return normalized;
  });
  if (!isFixedTagTree(data.facetCatalog)) {
    const migrated = migrateLegacyFacetState(data.entries, data.facetCatalog);
    data.facetCatalog = migrated.catalog;
    data.entries = migrated.entries;
  }
  for (const entry of data.entries) {
    const id = clean(entry?.id);
    if (!id || ids.has(id)) throw new Error("案例包包含无效或重复的案例编号");
    ids.add(id);
    entry.id = id;
    for (const asset of entry.mediaAssets) {
      if (visualIds.has(asset.id)) throw new Error("案例包包含重复的媒体编号");
      visualIds.add(asset.id);
      if (asset.storageMode === "reference") continue;
      const path = clean(asset.assetPath);
      if (!validMediaPath(path, asset.kind)) throw new Error(`“${entry.title || "未命名案例"}”的媒体路径无效`);
      const blob = files.get(path);
      if (!(blob instanceof Blob) || !blobMatchesKind(blob, asset.kind)) {
        throw new Error(asset.kind === "image"
          ? `“${entry.title || "未命名案例"}”的截图缺失`
          : `“${entry.title || "未命名案例"}”的媒体文件缺失或类型不符`);
      }
      if (asset.kind === "image" && blob.size > limits.maxImageBytes) {
        throw new Error(`“${entry.title || "未命名案例"}”的图片超过 ${formatBytes(limits.maxImageBytes)} 上限`);
      }
      if (asset.kind !== "image" && blob.size > limits.maxFileBytes) {
        throw new Error(`“${entry.title || "未命名案例"}”的媒体超过 ${formatBytes(limits.maxFileBytes)} 小型分享包上限，请使用完整资料夹备份`);
      }
      if (!skipMediaByteValidation && value.version >= 3 && asset.byteSize && asset.byteSize !== blob.size) {
        throw new Error(
          `“${entry.title || "未命名案例"}”的媒体大小校验失败：期望 ${asset.byteSize} bytes，实际 ${blob.size} bytes（${path}）`
        );
      }
      assets.set(asset.id, blob);
      if (asset.kind === "image") images.set(asset.id, blob);
    }
  }
  data.compoundCases = normalizeCompoundCases(data.compoundCases, data.entries);
  data.organizerState = normalizeOrganizerState(data.organizerState, [...ids]);
  data.composerSettings = normalizeComposerSettings(data.composerSettings);
  data.composerSessions = normalizeComposerSessions(data.composerSessions);
  for (const session of data.composerSessions) {
    for (const reference of session.referenceSnapshots) {
      if (reference.sourceType !== "temporary") continue;
      for (const asset of reference.assetRefs) {
        const path = clean(asset.archivePath);
        if (!validTemporaryAssetPath(path)) throw new Error(`临时附件路径无效：${asset.name || asset.assetId}`);
        const blob = files.get(path);
        if (!(blob instanceof Blob) || !blobMatchesKind(blob, asset.kind)) {
          throw new Error(`临时附件缺失或类型不符：${asset.name || asset.assetId}`);
        }
        if (blob.size > limits.maxFileBytes) {
          throw new Error(`临时附件超过 ${formatBytes(limits.maxFileBytes)} 上限：${asset.name || asset.assetId}`);
        }
        if (!skipMediaByteValidation && asset.byteSize && asset.byteSize !== blob.size) {
          throw new Error(`临时附件大小校验失败：${asset.name || asset.assetId}`);
        }
        const existing = assets.get(asset.assetId);
        if (existing && existing.size !== blob.size) throw new Error("案例包包含冲突的临时附件编号");
        if (visualIds.has(asset.assetId) && !existing) throw new Error("案例包包含冲突的媒体编号");
        visualIds.add(asset.assetId);
        assets.set(asset.assetId, blob);
        if (asset.kind === "image") images.set(asset.assetId, blob);
      }
    }
  }
  data.creativeExperimentSettings = normalizeCreativeExperimentSettings(data.creativeExperimentSettings);
  data.creativeRuns = normalizeCreativeRuns(data.creativeRuns);
  data.creativeSkills = normalizeCreativeSkillsState(data.creativeSkills);
  for (const run of data.creativeRuns) {
    for (const output of run.outputs) {
      const visual = output.visual;
      const path = clean(visual.assetPath || visual.screenshotPath);
      const video = visual.kind === "video" || String(visual.mimeType ?? "").startsWith("video/");
      if (!validCreativeResultPath(path, video ? "video" : "image")) {
        throw new Error("创作实验包包含无效的结果媒体路径");
      }
      const asset = files.get(path);
      if (!(asset instanceof Blob) || !blobMatchesKind(asset, video ? "video" : "image")) {
        throw new Error(`创作实验包缺少结果${video ? "视频" : "图片"}`);
      }
      if (!video && asset.size > limits.maxImageBytes) {
        throw new Error(`创作结果图片超过 ${formatBytes(limits.maxImageBytes)} 上限`);
      }
      const existingAsset = assets.get(visual.id);
      if (visualIds.has(visual.id) && existingAsset && existingAsset.size !== asset.size) {
        throw new Error("案例包包含冲突的结果媒体编号");
      }
      visualIds.add(visual.id);
      assets.set(visual.id, asset);
      if (!video) images.set(visual.id, asset);
    }
  }
  for (const skill of data.creativeSkills.items) {
    for (const file of skill.packageFiles) {
      const path = clean(file.archivePath);
      if (!/^skills\/[A-Za-z0-9._/-]+$/i.test(path) || path.includes("..")) {
        throw new Error(`外部 Skill 原包路径无效：${file.path}`);
      }
      const blob = files.get(path);
      if (!(blob instanceof Blob)) throw new Error(`外部 Skill 原包文件缺失：${file.path}`);
      if (blob.size > limits.maxFileBytes) throw new Error(`外部 Skill 文件超过 ${formatBytes(limits.maxFileBytes)} 上限`);
      if (!skipMediaByteValidation && file.byteSize && file.byteSize !== blob.size) {
        throw new Error(`外部 Skill 文件大小校验失败：${file.path}`);
      }
      skillAssets.set(file.assetId, blob);
    }
  }
  const migrated = migrateLibraryState({
    schemaVersion: packageSchemaVersion(data),
    entries: data.entries,
    compoundCases: data.compoundCases,
    taxonomy: data.taxonomy,
    facetCatalog: data.facetCatalog,
    classificationRules: data.classificationRules,
    organizerState: data.organizerState
  }).state;
  return {
    ...data,
    schemaVersion: SCHEMA_VERSION,
    entries: migrated.entries,
    compoundCases: migrated.compoundCases,
    taxonomy: migrated.taxonomy,
    facetCatalog: migrated.facetCatalog,
    classificationRules: migrated.classificationRules,
    organizerState: migrated.organizerState,
    assets,
    images,
    skillAssets
  };
}

function packageSchemaVersion(value = {}) {
  if (Number.isInteger(value.schemaVersion)) return value.schemaVersion;
  const versions = (value.entries ?? [])
    .map((entry) => Number(entry?.schemaVersion))
    .filter(Number.isInteger);
  return versions.length ? Math.min(...versions) : 0;
}

export function selectLibraryPackage(state = {}, entryIds = []) {
  const requestedIds = new Set(entryIds.map(clean).filter(Boolean));
  const compounds = normalizeCompoundCases(state.compoundCases, state.entries);
  const selectedIds = new Set(expandLogicalCaseIds([...requestedIds], compounds));
  const entries = (state.entries ?? []).filter((entry) => selectedIds.has(entry.id));
  if (!entries.length) throw new Error("请先选择要分享的案例");
  const catalog = normalizeFacetCatalog(state.facetCatalog);
  const usedNodeIds = new Set(entries.flatMap((entry) =>
    (entry.facetAssignments ?? []).map((item) => item.nodeId).filter(Boolean)
  ));
  const byId = new Map(catalog.nodes.map((node) => [node.id, node]));
  for (const nodeId of [...usedNodeIds]) {
    let current = byId.get(nodeId);
    while (current?.parentId) {
      usedNodeIds.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }
  const usedFacetIds = new Set([...usedNodeIds].map((id) => byId.get(id)?.facetId).filter(Boolean));
  const selected = {
    ...state,
    entries: entries.map(sanitizeSharedEntry),
    taxonomy: {
      ...normalizeTaxonomy(state.taxonomy),
      nodes: normalizeTaxonomy(state.taxonomy).nodes.filter((node) => entries.some((entry) => entry.classification?.pathIds?.[0] === node.id))
    },
    facetCatalog: {
      ...catalog,
      facets: catalog.facets.filter((facet) => usedFacetIds.has(facet.id)),
      nodes: catalog.nodes.filter((node) => usedNodeIds.has(node.id))
    },
    classificationRules: [],
    compoundCases: compounds.filter((item) => requestedIds.has(item.id) || item.memberEntryIds.every((id) => selectedIds.has(id))),
    organizerState: createDefaultOrganizerState(),
    composerSettings: undefined,
    composerSessions: [],
    creativeExperimentSettings: undefined,
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] }
  };
  return selected;
}

export function selectProjectPackage(state = {}, collectionId) {
  const organizer = normalizeOrganizerState(state.organizerState, (state.entries ?? []).map((entry) => entry.id));
  const collection = organizer.collections.find((item) => item.id === clean(collectionId));
  if (!collection) throw new Error("项目不存在");
  if (!collection.entryIds.length) throw new Error("这个项目还没有可分享的案例");
  const selected = selectLibraryPackage(state, collection.entryIds);
  selected.organizerState = normalizeOrganizerState({
    version: organizer.version,
    collections: [{
      id: collection.id,
      name: collection.name,
      order: 0,
      entryIds: collection.entryIds
    }]
  }, selected.entries.map((entry) => entry.id));
  return selected;
}

function sanitizeSharedEntry(entry) {
  const next = normalizeEntryVisuals(entry);
  next.mediaAssets = next.mediaAssets.map((asset) => {
    if (!asset.visionAnalysis) return asset;
    const {
      imageFingerprint: _imageFingerprint,
      profileFingerprint: _profileFingerprint,
      providerType: _providerType,
      provider: _provider,
      model: _model,
      usage: _usage,
      batchJobId: _batchJobId,
      ...portableAnalysis
    } = asset.visionAnalysis;
    return { ...asset, visionAnalysis: structuredClone(portableAnalysis) };
  });
  delete next.visionAnalysisUndo;
  if (next.creationMeta) {
    const { methodVersion, targetPlatform, outputLanguage, createdAt } = next.creationMeta;
    next.creationMeta = { methodVersion, targetPlatform, outputLanguage, createdAt };
  }
  return next;
}

export function mergeLibraryPackage(current = {}, importedValue = {}, options = {}) {
  const imported = parseLibraryPackage(importedValue, packageImagePlaceholders(importedValue), {
    skipMediaByteValidation: true
  });
  const empty = !(current.entries ?? []).length && options.preserveLibraryConfiguration !== true;
  if (empty) {
    const skillMerge = mergeCreativeSkillsState(current.creativeSkills, imported.creativeSkills, options);
    return {
      state: {
        ...structuredClone(current),
        entries: imported.entries.map(withoutArchivePath),
        settings: imported.settings,
        taxonomy: imported.taxonomy,
        facetCatalog: imported.facetCatalog,
        classificationRules: imported.classificationRules,
        compoundCases: imported.compoundCases,
        organizerState: imported.organizerState,
        composerSettings: imported.composerSettings,
        composerSessions: imported.composerSessions.map(withoutComposerArchivePaths),
        creativeExperimentSettings: imported.creativeExperimentSettings,
        creativeRuns: imported.creativeRuns.map(withoutCreativeArchivePaths),
        creativeSkills: skillMerge.state
      },
      entryIdMap: Object.fromEntries(imported.entries.map((entry) => [entry.id, entry.id])),
      compoundIdMap: Object.fromEntries(imported.compoundCases.map((item) => [item.id, item.id])),
      visualIdMap: Object.fromEntries([
        ...imported.entries.flatMap((entry) => entry.mediaAssets.map((visual) => [visual.id, visual.id])),
        ...imported.creativeRuns.flatMap((run) => run.outputs.map((output) => [output.visual.id, output.visual.id])),
        ...temporaryReferenceAssets(imported.composerSessions).map((asset) => [asset.assetId, asset.assetId])
      ]),
      skillIdMap: skillMerge.skillIdMap,
      packageAssetIdMap: skillMerge.packageAssetIdMap,
      importedSkillCount: skillMerge.importedSkillCount,
      skippedSkillCount: skillMerge.skippedSkillCount,
      importedRunCount: imported.creativeRuns.length,
      importedOutputCount: imported.creativeRuns.reduce((sum, run) => sum + run.outputs.length, 0),
      importedCount: imported.entries.length,
      skippedCount: 0
    };
  }

  const next = structuredClone(current);
  next.taxonomy = normalizeTaxonomy(next.taxonomy);
  next.facetCatalog = normalizeFacetCatalog(next.facetCatalog);
  next.settings = normalizeSettings(next.settings);
  next.classificationRules = Array.isArray(next.classificationRules) ? next.classificationRules : [];
  next.organizerState = normalizeOrganizerState(next.organizerState, next.entries.map((entry) => entry.id));
  next.compoundCases = normalizeCompoundCases(next.compoundCases, next.entries);
  const taxonomyMerge = mergeTaxonomies(next.taxonomy, imported.taxonomy);
  next.taxonomy = taxonomyMerge.taxonomy;
  const { facetIds, nodeIds } = mergeVocabulary(next.facetCatalog, imported.facetCatalog);
  const usedEntryIds = new Set(next.entries.map((entry) => entry.id));
  const usedVisualIds = new Set([
    ...next.entries.flatMap((entry) => normalizeEntryMedia(entry).mediaAssets.map((visual) => visual.id)),
    ...normalizeCreativeRuns(next.creativeRuns).flatMap((run) => run.outputs.map((output) => output.visual.id)),
    ...temporaryReferenceAssets(next.composerSessions).map((asset) => asset.assetId)
  ]);
  const entryIdMap = {};
  const visualIdMap = { ...(options.visualIdMap ?? {}) };
  const organizerEntryIdMap = {};
  let importedCount = 0;
  let skippedCount = 0;
  for (const source of imported.entries) {
    if (usedEntryIds.has(source.id)) {
      skippedCount += 1;
      organizerEntryIdMap[source.id] = source.id;
      continue;
    }
    const preferred = clean(options.entryIdMap?.[source.id]);
    const targetId = preferred && !usedEntryIds.has(preferred) ? preferred : source.id;
    if (usedEntryIds.has(targetId)) throw new Error("导入期间案例库发生变化，请重试");
    const entry = withoutArchivePath(structuredClone(source));
    entry.id = targetId;
    const sourceContentId = entry.classification?.pathIds?.[0];
    const targetContentId = taxonomyMerge.idMap[sourceContentId];
    if (targetContentId) entry.classification.pathIds = [targetContentId];
    else entry.classification = {
      pathIds: [], status: "needs_review", source: "auto", reason: "导入包缺少对应内容类型"
    };
    entry.mediaAssets = entry.mediaAssets.map((visual) => {
      const preferredVisualId = visual.id === source.id && targetId !== source.id ? targetId : visual.id;
      const mappedVisualId = clean(options.visualIdMap?.[visual.id]);
      const targetVisualId = usedVisualIds.has(preferredVisualId)
        ? mappedVisualId && !usedVisualIds.has(mappedVisualId)
          ? mappedVisualId
          : uniqueId("visual", usedVisualIds)
        : preferredVisualId;
      usedVisualIds.add(targetVisualId);
      visualIdMap[visual.id] = targetVisualId;
      return { ...visual, id: targetVisualId };
    });
    entry.primaryMediaId = visualIdMap[entry.primaryMediaId] ?? entry.primaryMediaId;
    entry.mediaAssets = entry.mediaAssets.map((asset) => ({
      ...asset,
      ...(asset.posterAssetId ? { posterAssetId: visualIdMap[asset.posterAssetId] ?? asset.posterAssetId } : {}),
      ...(asset.derivedFromAssetId ? { derivedFromAssetId: visualIdMap[asset.derivedFromAssetId] ?? asset.derivedFromAssetId } : {})
    }));
    entry.timeNotes = (entry.timeNotes ?? []).map((note) => ({
      ...note,
      assetId: visualIdMap[note.assetId] ?? note.assetId,
      ...(note.frameAssetId ? { frameAssetId: visualIdMap[note.frameAssetId] ?? note.frameAssetId } : {})
    }));
    entry.facetAssignments = (entry.facetAssignments ?? []).flatMap((item) => {
      const facetId = facetIds.get(item.facetId);
      const nodeId = nodeIds.get(item.nodeId);
      return facetId && nodeId ? [{ ...item, facetId, nodeId }] : [];
    });
    next.entries.push(entry);
    usedEntryIds.add(targetId);
    entryIdMap[source.id] = targetId;
    organizerEntryIdMap[source.id] = targetId;
    importedCount += 1;
  }
  for (const targetId of Object.values(entryIdMap)) {
    const importedEntry = next.entries.find((item) => item.id === targetId);
    if (!importedEntry?.creationMeta?.sourceEntryIds) continue;
    importedEntry.creationMeta.sourceEntryIds = importedEntry.creationMeta.sourceEntryIds.map((id) => organizerEntryIdMap[id] ?? id);
  }
  next.organizerState = mergeOrganizerState(next.organizerState, imported.organizerState, organizerEntryIdMap);
  const usedCompoundIds = new Set([
    ...next.entries.map((entry) => entry.id),
    ...next.compoundCases.map((item) => item.id)
  ]);
  const compoundIdMap = {};
  for (const source of imported.compoundCases) {
    const memberEntryIds = source.memberEntryIds.map((id) => organizerEntryIdMap[id]).filter(Boolean);
    if (memberEntryIds.length < 2) continue;
    const preferred = clean(options.compoundIdMap?.[source.id]);
    const targetId = !usedCompoundIds.has(source.id)
      ? source.id
      : preferred && !usedCompoundIds.has(preferred)
        ? preferred
        : uniqueId("compound", usedCompoundIds);
    usedCompoundIds.add(targetId);
    compoundIdMap[source.id] = targetId;
    next.compoundCases.push({
      ...source,
      id: targetId,
      memberEntryIds,
      coverVisualId: visualIdMap[source.coverVisualId] ?? source.coverVisualId
    });
  }
  next.compoundCases = normalizeCompoundCases(next.compoundCases, next.entries);
  next.composerSettings = normalizeComposerSettings(next.composerSettings);
  for (const asset of temporaryReferenceAssets(imported.composerSessions)) {
    if (visualIdMap[asset.assetId]) continue;
    const targetAssetId = usedVisualIds.has(asset.assetId) ? uniqueId("temp-reference", usedVisualIds) : asset.assetId;
    usedVisualIds.add(targetAssetId);
    visualIdMap[asset.assetId] = targetAssetId;
  }
  const composerMerge = mergeComposerSessions(
    next.composerSessions,
    imported.composerSessions,
    organizerEntryIdMap,
    options.sessionIdMap,
    visualIdMap
  );
  next.composerSessions = composerMerge.sessions;
  next.creativeExperimentSettings = normalizeCreativeExperimentSettings(
    next.creativeExperimentSettings ?? imported.creativeExperimentSettings
  );
  const creativeMerge = mergeCreativeRuns(
    next.creativeRuns,
    imported.creativeRuns,
    composerMerge.sessionIdMap,
    usedVisualIds,
    visualIdMap,
    options.runIdMap
  );
  next.creativeRuns = creativeMerge.runs;
  const skillMerge = mergeCreativeSkillsState(next.creativeSkills, imported.creativeSkills, options);
  next.creativeSkills = skillMerge.state;
  return {
    state: next,
    entryIdMap,
    visualIdMap,
    sessionIdMap: composerMerge.sessionIdMap,
    runIdMap: creativeMerge.runIdMap,
    compoundIdMap,
    skillIdMap: skillMerge.skillIdMap,
    packageAssetIdMap: skillMerge.packageAssetIdMap,
    importedSkillCount: skillMerge.importedSkillCount,
    skippedSkillCount: skillMerge.skippedSkillCount,
    importedRunCount: imported.creativeRuns.length,
    importedOutputCount: imported.creativeRuns.reduce((sum, run) => sum + run.outputs.length, 0),
    importedCount,
    skippedCount
  };
}

function mergeComposerSessions(currentValue, importedValue, entryIdMap, preferredIds = {}, visualIdMap = {}) {
  const current = normalizeComposerSessions(currentValue);
  const used = new Set(current.map((item) => item.id));
  const sessionIdMap = {};
  const imported = normalizeComposerSessions(importedValue).map((session) => {
    const next = structuredClone(session);
    const sourceId = next.id;
    if (used.has(next.id)) {
      const preferred = clean(preferredIds?.[sourceId]);
      next.id = preferred && !used.has(preferred) ? preferred : globalThis.crypto.randomUUID();
    }
    used.add(next.id);
    sessionIdMap[sourceId] = next.id;
    next.referenceSnapshots = next.referenceSnapshots.map((item) => ({
      ...item,
      entryId: entryIdMap[item.entryId] ?? item.entryId,
      imageRefs: item.imageRefs.map((image) => ({ ...image, visualId: visualIdMap[image.visualId] ?? image.visualId })),
      assetRefs: item.assetRefs.map(({ archivePath: _archivePath, ...asset }) => ({
        ...asset,
        assetId: visualIdMap[asset.assetId] ?? asset.assetId
      }))
    }));
    return next;
  });
  return { sessions: [...current, ...imported], sessionIdMap };
}

function mergeCreativeRuns(currentValue, importedValue, sessionIdMap, usedVisualIds, visualIdMap, preferredRunIds = {}) {
  const current = normalizeCreativeRuns(currentValue);
  const usedRunIds = new Set(current.map((item) => item.id));
  const runIdMap = {};
  const imported = normalizeCreativeRuns(importedValue).map((source) => {
    const run = withoutCreativeArchivePaths(source);
    const sourceRunId = run.id;
    if (usedRunIds.has(run.id)) {
      const preferred = clean(preferredRunIds?.[sourceRunId]);
      run.id = preferred && !usedRunIds.has(preferred) ? preferred : globalThis.crypto.randomUUID();
    }
    usedRunIds.add(run.id);
    runIdMap[sourceRunId] = run.id;
    run.sessionId = sessionIdMap[run.sessionId] ?? run.sessionId;
    run.outputs = run.outputs.map((output) => {
      const sourceVisualId = output.visual.id;
      let targetVisualId = visualIdMap[sourceVisualId];
      if (!targetVisualId) {
        targetVisualId = usedVisualIds.has(sourceVisualId)
          ? uniqueId("creative-visual", usedVisualIds)
          : sourceVisualId;
        usedVisualIds.add(targetVisualId);
        visualIdMap[sourceVisualId] = targetVisualId;
      }
      return { ...output, visual: { ...output.visual, id: targetVisualId } };
    });
    return run;
  });
  return { runs: normalizeCreativeRuns([...current, ...imported]), runIdMap };
}

function mergeVocabulary(target, sourceValue) {
  const source = normalizeFacetCatalog(sourceValue);
  const facetIds = new Map();
  const nodeIds = new Map();
  for (const facet of source.facets.toSorted((a, b) => a.order - b.order)) {
    const sameId = target.facets.find((item) => item.id === facet.id && canonical(item.name) === canonical(facet.name));
    const sameName = target.facets.find((item) => canonical(item.name) === canonical(facet.name));
    const existing = sameId ?? sameName;
    if (existing) {
      facetIds.set(facet.id, existing.id);
      continue;
    }
    const id = target.facets.some((item) => item.id === facet.id) ? uniqueId("facet", new Set(target.facets.map((item) => item.id))) : facet.id;
    target.facets.push({ ...facet, id, order: target.facets.length });
    facetIds.set(facet.id, id);
  }
  const orderedNodes = source.nodes.toSorted((left, right) => Number(Boolean(left.parentId)) - Number(Boolean(right.parentId)) || left.order - right.order);
  for (const node of orderedNodes) {
    const facetId = facetIds.get(node.facetId);
    const parentId = node.parentId ? nodeIds.get(node.parentId) : null;
    if (!facetId || (node.parentId && !parentId)) continue;
    const existing = target.nodes.find((item) =>
      item.facetId === facetId && (item.parentId || null) === parentId && canonical(item.name) === canonical(node.name)
    );
    if (existing) {
      nodeIds.set(node.id, existing.id);
      continue;
    }
    const id = target.nodes.some((item) => item.id === node.id) ? uniqueId("tag", new Set(target.nodes.map((item) => item.id))) : node.id;
    target.nodes.push({ ...node, id, facetId, parentId, order: target.nodes.length });
    nodeIds.set(node.id, id);
  }
  target.revision += 1;
  return { facetIds, nodeIds };
}

function packageImagePlaceholders(value) {
  const entryImages = (value?.entries ?? []).flatMap((entryValue) => {
    const entry = normalizeEntryMedia(entryValue);
    return entry.mediaAssets.flatMap((asset) => asset.assetPath
      ? [[asset.assetPath, new Blob(["placeholder"], { type: mediaType(asset.assetPath, asset.kind) })]] : []);
  });
  const creativeAssets = normalizeCreativeRuns(value?.creativeRuns).flatMap((run) =>
    run.outputs.flatMap((output) => (output.visual.assetPath || output.visual.screenshotPath)
      ? [[output.visual.assetPath || output.visual.screenshotPath, new Blob(["placeholder"], { type: mediaType(output.visual.assetPath || output.visual.screenshotPath, output.visual.kind) })]]
      : [])
  );
  const skillFiles = normalizeCreativeSkillsState(value?.creativeSkills).items.flatMap((skill) =>
    skill.packageFiles.flatMap((file) => file.archivePath
      ? [[file.archivePath, new Blob(["placeholder"], { type: file.mimeType || "application/octet-stream" })]]
      : [])
  );
  const tempFiles = normalizeComposerSessions(value?.composerSessions).flatMap((session) =>
    session.referenceSnapshots.flatMap((reference) => reference.sourceType === "temporary"
      ? reference.assetRefs.flatMap((asset) => asset.archivePath
        ? [[asset.archivePath, new Blob(["placeholder"], { type: asset.mimeType || "application/octet-stream" })]]
        : [])
      : [])
  );
  return new Map([...entryImages, ...creativeAssets, ...skillFiles, ...tempFiles]);
}

function withoutArchivePath(entry) {
  const next = normalizeEntryMedia(entry);
  next.mediaAssets = next.mediaAssets.map(({ assetPath: _assetPath, ...asset }) => asset);
  return next;
}

function withoutCreativeArchivePaths(runValue) {
  const run = structuredClone(runValue);
  run.outputs = (run.outputs ?? []).map((output) => {
    const { screenshotPath: _screenshotPath, assetPath: _assetPath, ...visual } = output.visual ?? {};
    return { ...output, visual };
  });
  return run;
}

function withoutComposerArchivePaths(sessionValue) {
  const session = structuredClone(sessionValue);
  session.referenceSnapshots = (session.referenceSnapshots ?? []).map((reference) => ({
    ...reference,
    assetRefs: (reference.assetRefs ?? []).map(({ archivePath: _archivePath, ...asset }) => asset)
  }));
  return session;
}

function temporaryReferenceAssets(sessionsValue) {
  return normalizeComposerSessions(sessionsValue).flatMap((session) =>
    session.referenceSnapshots
      .filter((reference) => reference.sourceType === "temporary")
      .flatMap((reference) => reference.assetRefs)
  );
}

function validTemporaryAssetPath(path) {
  return /^temp-references\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.[A-Za-z0-9]+$/u.test(path) && !path.includes("..");
}

function imageType(path) {
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  return "image/webp";
}

function mediaType(path, kind) {
  if (kind === "image") return imageType(path);
  if (/\.mp4$/i.test(path)) return "video/mp4";
  if (/\.webm$/i.test(path)) return "video/webm";
  if (/\.mov$/i.test(path)) return "video/quicktime";
  if (/\.mkv$/i.test(path)) return "video/x-matroska";
  if (/\.avi$/i.test(path)) return "video/x-msvideo";
  if (/\.pdf$/i.test(path)) return "application/pdf";
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.md$/i.test(path)) return "text/markdown";
  return "text/plain";
}

function validMediaPath(path, kind) {
  if (!path || path.includes("..")) return false;
  if (kind === "image") return /^images\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(path);
  if (kind === "video") return /^videos\/[A-Za-z0-9._/-]+\.(?:mp4|webm|mov|mkv|avi|video)$/i.test(path);
  return /^documents\/[A-Za-z0-9._/-]+\.(?:pdf|md|txt|html?|bin)$/i.test(path);
}

function validCreativeResultPath(path, kind) {
  if (!path || path.includes("..")) return false;
  if (kind === "video") return /^creative-results\/[A-Za-z0-9._/-]+\.(?:mp4|webm|mov)$/i.test(path);
  return /^(?:images|creative-results)\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(path);
}

function blobMatchesKind(blob, kind) {
  if (kind === "image") return blob.type.startsWith("image/");
  if (kind === "video") return blob.type.startsWith("video/");
  return ["application/pdf", "text/plain", "text/markdown", "text/html"].includes(blob.type);
}

function uniqueId(prefix, used) {
  let id;
  do id = `${prefix}:${globalThis.crypto.randomUUID()}`; while (used.has(id));
  return id;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

function canonical(value) {
  return clean(value).toLocaleLowerCase("zh-CN").replace(/[\s._·—–-]+/g, "");
}
