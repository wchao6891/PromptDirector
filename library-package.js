import { normalizeFacetCatalog, uniqueNames } from "./facets.js";
import { normalizeSettings } from "./lib.js";
import { SCHEMA_VERSION, mergeTaxonomies, normalizeTaxonomy } from "./taxonomy.js";
import {
  collectionEntryIds,
  collectionSubtreeIds,
  createDefaultOrganizerState,
  mergeOrganizerStateWithMap,
  normalizeOrganizerState
} from "./organizer.js";
import { normalizeComposerSessions, normalizeComposerSettings } from "./composer.js";
import { normalizeCreativeExperimentSettings, normalizeCreativeRuns } from "./creative-runs.js";
import { mergeCreativeSkillsState, normalizeCreativeSkillsState } from "./creative-skills.js";
import { formatBytes, portableLibraryLimits } from "./resource-limits.js";
import { normalizeEntryVisuals } from "./visuals.js";
import { normalizeEntryMedia, removeEntryMedia } from "./media.js";
import { expandLogicalCaseIds, normalizeCompoundCases } from "./compound-cases.js";
import { prepareLibraryPackageDraft } from "./library-package-migrations.js";
import { remapArticleDocumentAssets } from "./article-document.js";
import { caseSemanticFingerprint } from "./library-semantic-identity.js";
import { normalizeTrashState } from "./trash.js";
import { boundedMediaBlobFromResponse, isSupportedDocumentMimeType } from "./bounded-media.js";
import {
  assetFormatForExtension,
  fileExtension,
  isReportedMimeCompatible
} from "./asset-formats.js";

const AI_ASSIGNMENT_SOURCES = new Set(["deepseek_text", "local_image_review", "vision_model"]);

export async function parseCompleteFolderBackup(value, files = new Map(), limitsValue = {}) {
  const preparedFiles = new Map(files);
  const limits = portableLibraryLimits(limitsValue);
  for (const [path, mimeType] of completeBackupDocumentPaths(value)) {
    const blob = preparedFiles.get(path);
    if (!(blob instanceof Blob)) continue;
    const verified = await boundedMediaBlobFromResponse(new Response(blob), {
      kind: "document",
      expectedMimeType: mimeType,
      maxBytes: limits.maxFileBytes
    });
    preparedFiles.set(path, verified);
  }
  return parseLibraryPackage(value, preparedFiles, { ...limitsValue, salvageInvalidMedia: false });
}

export function parseLibraryPackage(value, files = new Map(), limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  const skipMediaByteValidation = limitsValue?.skipMediaByteValidation === true;
  const salvageInvalidMedia = limitsValue?.salvageInvalidMedia === true;
  const prepared = prepareLibraryPackageDraft(value);
  const importDiagnostics = [...prepared.diagnostics];
  const importStats = { ...prepared.stats, droppedMediaFiles: 0 };
  const packageVersion = prepared.sourceVersion;
  value = prepared.draft;
  if (value.entries.length > limits.maxEntries) {
    throw new Error(`案例数量超过 ${limits.maxEntries} 条上限`);
  }
  if (Array.isArray(value.organizerState?.collections) && value.organizerState.collections.length > limits.maxCollections) {
    throw new Error(`项目数量超过 ${limits.maxCollections} 个上限`);
  }
  const data = structuredClone(value);
  data.settings = normalizeSettings(data.settings);
  data.taxonomy = normalizeTaxonomy(data.taxonomy);
  data.facetCatalog = normalizeFacetCatalog(data.facetCatalog);
  data.classificationRules = Array.isArray(data.classificationRules) ? data.classificationRules : [];
  const packageFacetIds = new Set(data.facetCatalog.facets.map((item) => item.id));
  const packageNodeIds = new Set(data.facetCatalog.nodes.map((item) => item.id));
  for (const entry of data.entries) {
    const missingAssignment = (Array.isArray(entry?.facetAssignments) ? entry.facetAssignments : [])
      .find((item) => !packageFacetIds.has(String(item?.facetId ?? "")) || !packageNodeIds.has(String(item?.nodeId ?? "")));
    if (missingAssignment) {
      throw new Error(`分享包中的案例“${clean(entry?.title) || clean(entry?.id) || "未命名案例"}”引用了缺失的 AI 标签词表，导入已取消`);
    }
  }
  const ids = new Set();
  const visualIds = new Set();
  const assets = new Map();
  const images = new Map();
  const skillAssets = new Map();
  if (packageVersion >= 4 && !salvageInvalidMedia) {
    for (const entry of data.entries) {
      for (const asset of Array.isArray(entry?.mediaAssets) ? entry.mediaAssets : []) {
        if (asset?.storageMode === "reference") continue;
        validatePortableMediaDescriptor(asset, clean(asset?.assetPath), packageVersion);
      }
    }
  }
  data.entries = data.entries.map((entry) => {
    const normalized = normalizeEntryVisuals(entry);
    if (packageVersion >= 4) {
      const normalizedIds = new Set(normalized.mediaAssets.map((asset) => asset.id));
      const missingAsset = (Array.isArray(entry?.mediaAssets) ? entry.mediaAssets : [])
        .find((asset) => asset?.storageMode !== "reference" && clean(asset?.id) && !normalizedIds.has(clean(asset.id)));
      if (missingAsset) throw new Error("案例包包含无法安全规范化的媒体描述");
    }
    normalized.customLabels = uniqueNames(entry?.customLabels);
    normalized.metadataLabels = uniqueNames(entry?.metadataLabels);
    return normalized;
  });
  for (let entryIndex = 0; entryIndex < data.entries.length; entryIndex += 1) {
    let entry = data.entries[entryIndex];
    const id = clean(entry?.id);
    if (!id || ids.has(id)) throw new Error("案例包包含无效或重复的案例编号");
    ids.add(id);
    entry.id = id;
    const entryAssets = new Map();
    const droppedAssetIds = [];
    for (const asset of entry.mediaAssets) {
      if (visualIds.has(asset.id)) throw new Error("案例包包含重复的媒体编号");
      visualIds.add(asset.id);
      if (asset.storageMode === "reference") continue;
      const path = clean(asset.assetPath);
      let format;
      try {
        format = validatePortableMediaDescriptor(asset, path, packageVersion);
      } catch (error) {
        if (!salvageInvalidMedia) throw error;
        droppedAssetIds.push(asset.id);
        importStats.droppedMediaDescriptors += 1;
        importDiagnostics.push({
          code: "media_descriptor_dropped",
          severity: "media",
          action: "dropped",
          entryId: entry.id,
          assetId: asset.id,
          reason: "invalid_descriptor"
        });
        continue;
      }
      const blob = files.get(path);
      const failure = portableMediaFileFailure(entry, asset, blob, format, packageVersion, limits, skipMediaByteValidation);
      if (failure) {
        if (!salvageInvalidMedia) throw new Error(failure.message);
        droppedAssetIds.push(asset.id);
        importStats.droppedMediaFiles += 1;
        importDiagnostics.push({
          code: "media_file_dropped",
          severity: "media",
          action: "dropped",
          entryId: entry.id,
          assetId: asset.id,
          path,
          reason: failure.reason
        });
        continue;
      }
      entryAssets.set(asset.id, blob);
    }
    for (const assetId of droppedAssetIds) entry = removeEntryMedia(entry, assetId);
    const retainedAssetIds = new Set(entry.mediaAssets.map((asset) => asset.id));
    if (droppedAssetIds.length) {
      entry.facetAssignments = (entry.facetAssignments ?? []).flatMap((assignment) => {
        const visualId = clean(assignment?.visualId);
        if (!visualId || retainedAssetIds.has(visualId)) return [assignment];
        if (!AI_ASSIGNMENT_SOURCES.has(assignment?.source)) {
          const { visualId: _visualId, ...portableAssignment } = assignment;
          return [portableAssignment];
        }
        importStats.droppedAiAssignments += 1;
        importDiagnostics.push({
          code: "ai_assignment_dropped",
          severity: "metadata",
          action: "dropped",
          entryId: entry.id,
          reason: "missing_media"
        });
        return [];
      });
    }
    data.entries[entryIndex] = entry;
    for (const [assetId, blob] of entryAssets) {
      if (!retainedAssetIds.has(assetId)) continue;
      assets.set(assetId, blob);
      if (entry.mediaAssets.find((asset) => asset.id === assetId)?.kind === "image") images.set(assetId, blob);
    }
  }
  if (salvageInvalidMedia) {
    data.entries = data.entries.filter((entry) => {
      if (hasRecoverableCaseContent(entry)) return true;
      ids.delete(entry.id);
      importStats.keptCases = Math.max(0, importStats.keptCases - 1);
      importStats.skippedCases += 1;
      importDiagnostics.push({
        code: "case_skipped_after_media_loss",
        severity: "case",
        action: "skipped",
        entryId: entry.id,
        reason: "no_usable_content"
      });
      return false;
    });
  }
  data.compoundCases = normalizeCompoundCases(data.compoundCases, data.entries);
  data.trashState = normalizeTrashState(data.trashState);
  for (const item of data.trashState.items) {
    if (item.kind !== "entry" && item.kind !== "media") continue;
    const entry = item.kind === "entry"
      ? normalizeEntryMedia(item.snapshot)
      : normalizeEntryMedia({
          id: clean(item.relationships?.entryId) || `trash-media:${item.targetId}`,
          title: clean(item.snapshot?.sourceTitle) || "回收站媒体",
          mediaAssets: item.snapshot?.mediaAssets ?? [],
          primaryMediaId: ""
        });
    const trashMediaIds = new Set(entry.mediaAssets.map((asset) => asset.id));
    if (item.kind === "entry") {
      entry.facetAssignments = dropDanglingAiAssignments(entry.facetAssignments, {
        facetIds: packageFacetIds,
        nodeIds: packageNodeIds,
        mediaIds: trashMediaIds,
        entryId: entry.id,
        importDiagnostics,
        importStats
      });
    } else {
      item.snapshot.facetAssignments = dropDanglingAiAssignments(item.snapshot?.facetAssignments, {
        facetIds: packageFacetIds,
        nodeIds: packageNodeIds,
        mediaIds: trashMediaIds,
        entryId: clean(item.relationships?.entryId) || item.targetId,
        importDiagnostics,
        importStats
      });
      item.relationships.facetAssignments = dropDanglingAiAssignments(item.relationships?.facetAssignments, {
        facetIds: packageFacetIds,
        nodeIds: packageNodeIds,
        mediaIds: trashMediaIds,
        entryId: clean(item.relationships?.entryId) || item.targetId,
        importDiagnostics,
        importStats
      });
    }
    for (const asset of entry.mediaAssets) {
      if (visualIds.has(asset.id)) throw new Error("完整备份包含重复的媒体编号");
      visualIds.add(asset.id);
      if (asset.storageMode === "reference") continue;
      const path = clean(asset.assetPath);
      const format = validatePortableMediaDescriptor(asset, path, packageVersion);
      const blob = files.get(path);
      if (!(blob instanceof Blob) || !blobMatchesKind(blob, asset, format, packageVersion)) {
        throw new Error(`回收站中的“${entry.title || "未命名案例"}”缺少媒体文件或类型不符`);
      }
      if (asset.kind === "image" && blob.size > limits.maxImageBytes) {
        throw new Error(`回收站中的图片超过 ${formatBytes(limits.maxImageBytes)} 上限`);
      }
      if (asset.kind !== "image" && blob.size > limits.maxFileBytes) {
        throw new Error(`回收站中的媒体超过 ${formatBytes(limits.maxFileBytes)} 上限`);
      }
      if (!skipMediaByteValidation && packageVersion >= 3 && asset.byteSize && asset.byteSize !== blob.size) {
        throw new Error(`回收站中的媒体大小校验失败：${path}`);
      }
      assets.set(asset.id, blob);
      if (asset.kind === "image") images.set(asset.id, blob);
    }
    if (item.kind === "entry") item.snapshot = entry;
    else item.snapshot.mediaAssets = entry.mediaAssets;
  }
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
  return {
    ...data,
    schemaVersion: SCHEMA_VERSION,
    sourcePackageVersion: packageVersion,
    importDiagnostics,
    importStats,
    assets,
    images,
    skillAssets
  };
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
  const subtreeIds = collectionSubtreeIds(organizer, collection.id);
  if (!collectionEntryIds(organizer, collection.id, { subtree: true }).length) throw new Error("这个项目及其子项目还没有可分享的案例");
  const exportedEntryIds = projectPackageEntryIds(state, collection.id);
  const selected = selectLibraryPackage(state, exportedEntryIds);
  const selectedEntryIds = new Set(selected.entries.map((entry) => entry.id));
  selected.organizerState = normalizeOrganizerState({
    version: organizer.version,
    collections: organizer.collections
      .filter((item) => subtreeIds.includes(item.id))
      .map((item) => ({
        ...structuredClone(item),
        parentId: item.id === collection.id ? null : item.parentId,
        order: item.id === collection.id ? 0 : item.order,
        entryIds: item.entryIds.filter((entryId) => selectedEntryIds.has(entryId))
      }))
  }, selected.entries.map((entry) => entry.id));
  return selected;
}

export function projectPackageEntryIds(state = {}, collectionId) {
  const entries = Array.isArray(state.entries) ? state.entries : [];
  const validEntryIds = new Set(entries.map((entry) => clean(entry?.id)).filter(Boolean));
  const organizer = normalizeOrganizerState(state.organizerState, [...validEntryIds]);
  const collection = organizer.collections.find((item) => item.id === clean(collectionId));
  if (!collection) throw new Error("项目不存在");
  const selectedIds = collectionEntryIds(organizer, collection.id, { subtree: true });
  const selectedSet = new Set(selectedIds);
  for (const compound of normalizeCompoundCases(state.compoundCases, entries)) {
    if (!compound.memberEntryIds.some((entryId) => selectedSet.has(entryId))) continue;
    for (const entryId of compound.memberEntryIds) {
      if (selectedSet.has(entryId)) continue;
      selectedSet.add(entryId);
      selectedIds.push(entryId);
    }
  }
  return selectedIds.filter((entryId) => validEntryIds.has(entryId));
}

function sanitizeSharedEntry(entry) {
  const next = normalizeEntryVisuals(entry);
  delete next.libraryAddedAt;
  delete next.importBatchId;
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
  const priorImportEvidence = parsedImportEvidence(importedValue);
  const imported = parseLibraryPackage(importedValue, packageImagePlaceholders(importedValue), {
    skipMediaByteValidation: true
  });
  if (priorImportEvidence) {
    imported.importDiagnostics = mergeImportDiagnostics(priorImportEvidence.diagnostics, imported.importDiagnostics);
    imported.importStats = mergeImportStats(priorImportEvidence.stats, imported.importStats);
  }
  const importedTrashAssets = trashMediaAssets(imported.trashState);
  const importMetadata = localImportMetadata(options);
  const empty = !(current.entries ?? []).length && options.preserveLibraryConfiguration !== true;
  if (empty) {
    const skillMerge = mergeCreativeSkillsState(current.creativeSkills, imported.creativeSkills, options);
    return {
      state: {
        ...structuredClone(current),
        entries: imported.entries.map((entry) => withLocalImportMetadata(withoutArchivePath(entry), importMetadata)),
        trashState: imported.trashState,
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
        ...temporaryReferenceAssets(imported.composerSessions).map((asset) => [asset.assetId, asset.assetId]),
        ...importedTrashAssets.map((asset) => [asset.id, asset.id])
      ]),
      createdVisualIdMap: Object.fromEntries([
        ...imported.entries.flatMap((entry) => entry.mediaAssets.map((visual) => [visual.id, visual.id])),
        ...imported.creativeRuns.flatMap((run) => run.outputs.map((output) => [output.visual.id, output.visual.id])),
        ...temporaryReferenceAssets(imported.composerSessions).map((asset) => [asset.assetId, asset.assetId]),
        ...importedTrashAssets.map((asset) => [asset.id, asset.id])
      ]),
      skillIdMap: skillMerge.skillIdMap,
      packageAssetIdMap: skillMerge.packageAssetIdMap,
      importedSkillCount: skillMerge.importedSkillCount,
      skippedSkillCount: skillMerge.skippedSkillCount,
      importedRunCount: imported.creativeRuns.length,
      importedOutputCount: imported.creativeRuns.reduce((sum, run) => sum + run.outputs.length, 0),
      importedCount: imported.entries.length,
      createdEntryIds: imported.entries.map((entry) => entry.id),
      importDiagnostics: imported.importDiagnostics,
      importStats: imported.importStats,
      remappedCount: 0,
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
  const createdVisualIdMap = {};
  const organizerEntryIdMap = {};
  let importedCount = 0;
  const createdEntryIds = [];
  let remappedCount = 0;
  let skippedCount = 0;
  for (const source of imported.entries) {
    const idCollision = usedEntryIds.has(source.id);
    const sourceFingerprint = caseSemanticFingerprint(source);
    const identical = sourceFingerprint && next.entries.find((entry) =>
      (entry.id === source.id || clean(entry.importSource?.entryId) === source.id) &&
      caseSemanticFingerprint(entry) === sourceFingerprint
    );
    if (identical) {
      skippedCount += 1;
      entryIdMap[source.id] = identical.id;
      organizerEntryIdMap[source.id] = identical.id;
      const sourceAssets = normalizeEntryMedia(source).mediaAssets;
      const existingAssets = normalizeEntryMedia(identical).mediaAssets;
      for (let index = 0; index < sourceAssets.length; index += 1) {
        if (existingAssets[index]) visualIdMap[sourceAssets[index].id] = existingAssets[index].id;
      }
      continue;
    }
    if (idCollision && options.skipExistingEntryIds === true) {
      skippedCount += 1;
      organizerEntryIdMap[source.id] = source.id;
      continue;
    }
    const preferred = clean(options.entryIdMap?.[source.id]);
    const targetId = preferred && !usedEntryIds.has(preferred)
      ? preferred
      : usedEntryIds.has(source.id)
        ? uniqueId("entry", usedEntryIds)
        : source.id;
    if (idCollision) remappedCount += 1;
    if (usedEntryIds.has(targetId)) throw new Error("导入期间案例库发生变化，请重试");
    const entry = withoutArchivePath(structuredClone(source));
    Object.assign(entry, importMetadata);
    entry.importSource = { entryId: source.id };
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
      createdVisualIdMap[visual.id] = targetVisualId;
      return { ...visual, id: targetVisualId };
    });
    entry.primaryMediaId = visualIdMap[entry.primaryMediaId] ?? entry.primaryMediaId;
    entry.articleDocument = remapArticleDocumentAssets(entry.articleDocument, visualIdMap);
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
    entry.facetAssignments = (entry.facetAssignments ?? []).map((item) => {
      const facetId = facetIds.get(item.facetId);
      const nodeId = nodeIds.get(item.nodeId);
      if (!facetId || !nodeId) {
        throw new Error(`分享包中的案例“${clean(entry.title) || source.id}”引用了缺失的 AI 标签词表，导入已取消且没有写入案例`);
      }
      return {
        ...item,
        facetId,
        nodeId,
        ...(item.visualId ? { visualId: visualIdMap[item.visualId] ?? item.visualId } : {})
      };
    });
    next.entries.push(entry);
    usedEntryIds.add(targetId);
    createdEntryIds.push(targetId);
    entryIdMap[source.id] = targetId;
    organizerEntryIdMap[source.id] = targetId;
    importedCount += 1;
  }
  for (const targetId of Object.values(entryIdMap)) {
    const importedEntry = next.entries.find((item) => item.id === targetId);
    if (!importedEntry?.creationMeta?.sourceEntryIds) continue;
    importedEntry.creationMeta.sourceEntryIds = importedEntry.creationMeta.sourceEntryIds.map((id) => organizerEntryIdMap[id] ?? id);
  }
  const organizerMerge = mergeOrganizerStateWithMap(
    next.organizerState,
    imported.organizerState,
    organizerEntryIdMap,
    options.preserveLibraryConfiguration === true ? { createdAt: importMetadata.libraryAddedAt } : {}
  );
  next.organizerState = organizerMerge.state;
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
    createdVisualIdMap[asset.assetId] = targetAssetId;
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
  for (const run of imported.creativeRuns) {
    for (const output of run.outputs) {
      const sourceId = output.visual.id;
      if (visualIdMap[sourceId]) createdVisualIdMap[sourceId] = visualIdMap[sourceId];
    }
  }
  const skillMerge = mergeCreativeSkillsState(next.creativeSkills, imported.creativeSkills, options);
  next.creativeSkills = skillMerge.state;
  const trashMerge = mergeImportedTrashState(next.trashState, imported.trashState, {
    activeEntryIds: next.entries.map((entry) => entry.id),
    activeCollectionIds: next.organizerState.collections.map((collection) => collection.id),
    activeCompoundIds: [
      ...next.entries.map((entry) => entry.id),
      ...next.compoundCases.map((compound) => compound.id)
    ],
    activeVisualIds: [...usedVisualIds],
    entryIdMap: organizerEntryIdMap,
    collectionIdMap: organizerMerge.collectionIdMap
  });
  next.trashState = trashMerge.trashState;
  Object.assign(visualIdMap, trashMerge.visualIdMap);
  Object.assign(createdVisualIdMap, trashMerge.visualIdMap);
  return {
    state: next,
    entryIdMap,
    visualIdMap,
    createdVisualIdMap,
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
    createdEntryIds,
    importDiagnostics: imported.importDiagnostics,
    importStats: imported.importStats,
    trashEntryIdMap: trashMerge.entryIdMap,
    trashCollectionIdMap: trashMerge.collectionIdMap,
    remappedCount,
    skippedCount
  };
}

function localImportMetadata(options = {}) {
  const requestedTime = clean(options.libraryAddedAt ?? options.now);
  const parsedTime = requestedTime && Number.isFinite(Date.parse(requestedTime))
    ? new Date(requestedTime).toISOString()
    : new Date().toISOString();
  return {
    libraryAddedAt: parsedTime,
    importBatchId: clean(options.importBatchId) || `library-import:${globalThis.crypto.randomUUID()}`
  };
}

function withLocalImportMetadata(entry, metadata) {
  return { ...entry, ...metadata };
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

function mergeImportedTrashState(currentValue, importedValue, context = {}) {
  const current = normalizeTrashState(currentValue);
  const imported = normalizeTrashState(importedValue);
  if (!imported.items.length) {
    return { trashState: current, entryIdMap: {}, collectionIdMap: {}, visualIdMap: {} };
  }
  const usedEntryIds = new Set([
    ...(context.activeEntryIds ?? []),
    ...current.items.filter((item) => item.kind === "entry").map((item) => item.targetId)
  ]);
  const usedCollectionIds = new Set([
    ...(context.activeCollectionIds ?? []),
    ...current.items.filter((item) => item.kind === "collection").map((item) => item.targetId)
  ]);
  const usedVisualIds = new Set(context.activeVisualIds ?? []);
  for (const item of current.items) {
    if (item.kind === "entry") {
      for (const asset of normalizeEntryMedia(item.snapshot).mediaAssets) usedVisualIds.add(asset.id);
    }
    if (item.kind === "media") {
      for (const asset of normalizeEntryMedia({ mediaAssets: item.snapshot?.mediaAssets ?? [] }).mediaAssets) usedVisualIds.add(asset.id);
    }
  }
  const collectionIdMap = { ...(context.collectionIdMap ?? {}) };
  for (const item of imported.items.filter((candidate) => candidate.kind === "collection")) {
    const sourceId = item.targetId;
    const targetId = usedCollectionIds.has(sourceId) ? uniqueId("collection", usedCollectionIds) : sourceId;
    usedCollectionIds.add(targetId);
    collectionIdMap[sourceId] = targetId;
  }
  const entryIdMap = { ...(context.entryIdMap ?? {}) };
  for (const item of imported.items.filter((candidate) => candidate.kind === "entry")) {
    const sourceId = item.targetId;
    const targetId = usedEntryIds.has(sourceId) ? uniqueId("entry", usedEntryIds) : sourceId;
    usedEntryIds.add(targetId);
    entryIdMap[sourceId] = targetId;
  }
  const compoundIds = new Set(context.activeCompoundIds ?? []);
  const compoundIdMap = {};
  for (const item of imported.items) {
    for (const compound of item.relationships?.compoundCases ?? []) {
      const sourceId = clean(compound?.id);
      if (!sourceId || compoundIdMap[sourceId]) continue;
      const targetId = compoundIds.has(sourceId) ? uniqueId("compound", compoundIds) : sourceId;
      compoundIds.add(targetId);
      compoundIdMap[sourceId] = targetId;
    }
  }
  const visualIdMap = {};
  const moved = imported.items.map((sourceItem) => {
    const item = structuredClone(sourceItem);
    if (item.kind === "collection") {
      const targetId = collectionIdMap[item.targetId];
      item.targetId = targetId;
      item.id = `trash:collection:${targetId}`;
      item.snapshot.id = targetId;
      item.snapshot.parentId = collectionIdMap[item.snapshot.parentId] ?? item.snapshot.parentId ?? null;
      item.snapshot.entryIds = (item.snapshot.entryIds ?? []).map((id) => entryIdMap[id] ?? id);
      return item;
    }
    if (item.kind === "entry") {
      const targetId = entryIdMap[item.targetId];
      const remapped = remapTrashedEntrySnapshot(item.snapshot, targetId, usedVisualIds);
      Object.assign(visualIdMap, remapped.visualIdMap);
      item.targetId = targetId;
      item.id = `trash:entry:${targetId}`;
      item.snapshot = remapped.entry;
      item.relationships.collections = (item.relationships.collections ?? []).map((membership) => ({
        ...membership,
        id: collectionIdMap[membership.id] ?? membership.id
      }));
      item.relationships.compoundCases = (item.relationships.compoundCases ?? []).map((compound) => ({
        ...compound,
        id: compoundIdMap[compound.id] ?? compound.id,
        memberEntryIds: (compound.memberEntryIds ?? []).map((id) => entryIdMap[id] ?? id),
        coverVisualId: remapped.visualIdMap[compound.coverVisualId] ?? compound.coverVisualId
      }));
      return item;
    }
    const parentEntryId = entryIdMap[item.relationships?.entryId] ?? item.relationships?.entryId;
    const remapped = remapTrashedEntrySnapshot({
      id: parentEntryId || `trash-media:${item.targetId}`,
      mediaAssets: item.snapshot?.mediaAssets ?? [],
      primaryMediaId: ""
    }, parentEntryId || `trash-media:${item.targetId}`, usedVisualIds);
    Object.assign(visualIdMap, remapped.visualIdMap);
    const targetId = remapped.visualIdMap[item.targetId] ?? item.targetId;
    item.targetId = targetId;
    item.id = ["trash", "media", parentEntryId, targetId].filter(Boolean).join(":");
    item.snapshot.mediaAssets = remapped.entry.mediaAssets;
    item.relationships.entryId = parentEntryId;
    item.relationships.positions = (item.relationships.positions ?? []).map((position) => ({
      ...position,
      id: remapped.visualIdMap[position.id] ?? position.id
    }));
    item.relationships.primaryMediaId = remapped.visualIdMap[item.relationships.primaryMediaId] ?? item.relationships.primaryMediaId;
    return item;
  });
  return {
    trashState: normalizeTrashState({ items: [...current.items, ...moved] }),
    entryIdMap: Object.fromEntries(imported.items.filter((item) => item.kind === "entry").map((item) => [item.targetId, entryIdMap[item.targetId]])),
    collectionIdMap,
    visualIdMap
  };
}

function remapTrashedEntrySnapshot(entryValue, targetEntryId, usedVisualIds) {
  const entry = normalizeEntryMedia(entryValue);
  const visualIdMap = {};
  entry.mediaAssets = entry.mediaAssets.map((asset) => {
    const preferredId = asset.id === entry.id && targetEntryId !== entry.id ? targetEntryId : asset.id;
    const targetId = usedVisualIds.has(preferredId) ? uniqueId("visual", usedVisualIds) : preferredId;
    usedVisualIds.add(targetId);
    visualIdMap[asset.id] = targetId;
    return { ...asset, id: targetId };
  });
  entry.id = targetEntryId;
  entry.primaryMediaId = visualIdMap[entry.primaryMediaId] ?? entry.primaryMediaId;
  entry.articleDocument = remapArticleDocumentAssets(entry.articleDocument, visualIdMap);
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
  entry.mediaPrompts = (entry.mediaPrompts ?? []).map((prompt) => ({
    ...prompt,
    assetId: visualIdMap[prompt.assetId] ?? prompt.assetId
  }));
  entry.facetAssignments = (entry.facetAssignments ?? []).map((assignment) => ({
    ...assignment,
    ...(assignment.visualId ? { visualId: visualIdMap[assignment.visualId] ?? assignment.visualId } : {})
  }));
  return { entry, visualIdMap };
}

function packageImagePlaceholders(value) {
  const entryImages = (value?.entries ?? []).flatMap((entryValue) => {
    const entry = normalizeEntryMedia(entryValue);
    return entry.mediaAssets.flatMap((asset) => asset.assetPath
      ? [[asset.assetPath, new Blob(["placeholder"], { type: mediaType(asset.assetPath, asset.kind, asset.mimeType) })]] : []);
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
  const trashAssets = trashMediaAssets(value?.trashState).flatMap((asset) => asset.assetPath
    ? [[asset.assetPath, new Blob(["placeholder"], { type: mediaType(asset.assetPath, asset.kind, asset.mimeType) })]]
    : []);
  return new Map([...entryImages, ...creativeAssets, ...skillFiles, ...tempFiles, ...trashAssets]);
}

function trashMediaAssets(trashStateValue) {
  return normalizeTrashState(trashStateValue).items.flatMap((item) => {
    if (item.kind === "entry") return normalizeEntryMedia(item.snapshot).mediaAssets;
    if (item.kind === "media") return normalizeEntryMedia({ mediaAssets: item.snapshot?.mediaAssets ?? [] }).mediaAssets;
    return [];
  });
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

function mediaType(path, kind, declaredMimeType = "") {
  const declared = clean(declaredMimeType).toLocaleLowerCase("en-US");
  if (declared) return declared;
  if (kind === "image") return imageType(path);
  if (/\.mp4$/i.test(path)) return "video/mp4";
  if (/\.webm$/i.test(path)) return "video/webm";
  if (/\.mov$/i.test(path)) return "video/quicktime";
  if (/\.mkv$/i.test(path)) return "video/x-matroska";
  if (/\.avi$/i.test(path)) return "video/x-msvideo";
  if (/\.pdf$/i.test(path)) return "application/pdf";
  if (/\.rtf$/i.test(path)) return "application/rtf";
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.md$/i.test(path)) return "text/markdown";
  return "text/plain";
}

function validatePortableMediaDescriptor(asset, path, packageVersion) {
  if (!validMediaPath(path, asset.kind, packageVersion)) {
    throw new Error("案例包包含无效或与媒体类型不符的文件路径");
  }
  if (packageVersion < 4) return null;
  const extension = fileExtension(path);
  const format = assetFormatForExtension(extension);
  const genericAttachment = asset.kind === "attachment" && !format && /^[a-z0-9]+$/u.test(extension);
  if (!format && !genericAttachment) throw new Error("案例包包含未登记的媒体格式");
  if (format && (format.kind !== asset.kind || !isReportedMimeCompatible(format, asset.mimeType))) {
    throw new Error("案例包中的扩展名、媒体类型和 MIME 不一致");
  }
  const declaredFormat = clean(asset.sourceFormat).toLocaleLowerCase("en-US").replace(/^\./u, "");
  if (declaredFormat && declaredFormat !== extension) {
    throw new Error("案例包中的源文件格式和文件扩展名不一致");
  }
  return format;
}

function validMediaPath(path, kind, packageVersion = 4) {
  if (!path || path.includes("..")) return false;
  const safeFile = "[A-Za-z0-9._/-]+\\.[A-Za-z0-9]+";
  const directories = packageVersion >= 4
    ? { image: "images", video: "videos", audio: "audio", document: "documents", attachment: "attachments" }
    : { image: "images", video: "videos", document: "documents" };
  const directory = directories[kind];
  if (!directory || !(new RegExp(`^${directory}\\/${safeFile}$`, "i")).test(path)) return false;
  if (packageVersion >= 4) return true;
  if (kind === "image") return /\.(?:png|jpe?g|webp)$/i.test(path);
  if (kind === "video") return /\.(?:mp4|webm|mov|mkv|avi|video)$/i.test(path);
  return /\.(?:pdf|rtf|md|txt|html?|bin)$/i.test(path);
}

function validCreativeResultPath(path, kind) {
  if (!path || path.includes("..")) return false;
  if (kind === "video") return /^creative-results\/[A-Za-z0-9._/-]+\.(?:mp4|webm|mov)$/i.test(path);
  return /^(?:images|creative-results)\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp)$/i.test(path);
}

function portableMediaFileFailure(entry, asset, blob, format, packageVersion, limits, skipMediaByteValidation) {
  const title = entry.title || "未命名案例";
  if (!(blob instanceof Blob)) {
    return {
      reason: "missing_file",
      message: asset.kind === "image" ? `“${title}”的截图缺失` : `“${title}”的媒体文件缺失或类型不符`
    };
  }
  if (!blobMatchesKind(blob, asset, format, packageVersion)) {
    return { reason: "type_mismatch", message: `“${title}”的媒体文件缺失或类型不符` };
  }
  if (asset.kind === "image" && blob.size > limits.maxImageBytes) {
    return { reason: "too_large", message: `“${title}”的图片超过 ${formatBytes(limits.maxImageBytes)} 上限` };
  }
  if (asset.kind !== "image" && blob.size > limits.maxFileBytes) {
    return {
      reason: "too_large",
      message: `“${title}”的媒体超过 ${formatBytes(limits.maxFileBytes)} 小型分享包上限，请使用完整资料夹备份`
    };
  }
  if (!skipMediaByteValidation && packageVersion >= 3 && asset.byteSize && asset.byteSize !== blob.size) {
    return {
      reason: "byte_size_mismatch",
      message: `“${title}”的媒体大小校验失败：期望 ${asset.byteSize} bytes，实际 ${blob.size} bytes（${clean(asset.assetPath)}）`
    };
  }
  return null;
}

function blobMatchesKind(blob, asset, format, packageVersion) {
  if (typeof asset === "string") {
    if (asset === "image") return clean(blob.type).startsWith("image/");
    if (asset === "video") return clean(blob.type).startsWith("video/");
    return isSupportedDocumentMimeType(blob.type);
  }
  const blobType = clean(blob.type).toLocaleLowerCase("en-US");
  if (packageVersion >= 4) {
    if (!blobType || ["application/octet-stream", "application/x-unknown"].includes(blobType)) return true;
    if (format) return isReportedMimeCompatible(format, blobType);
    return asset.kind === "attachment";
  }
  if (asset.kind === "image") return blobType.startsWith("image/");
  if (asset.kind === "video") return blobType.startsWith("video/");
  return isSupportedDocumentMimeType(blobType);
}

function completeBackupDocumentPaths(value = {}) {
  const paths = new Map();
  const trashEntries = (Array.isArray(value?.trashState?.items) ? value.trashState.items : []).flatMap((item) => {
    if (item?.kind === "entry") return [item.snapshot];
    if (item?.kind === "media") return [{ mediaAssets: item.snapshot?.mediaAssets ?? [] }];
    return [];
  });
  for (const entry of [...(Array.isArray(value?.entries) ? value.entries : []), ...trashEntries]) {
    const mediaAssets = Array.isArray(entry?.mediaAssets)
      ? entry.mediaAssets
      : Array.isArray(entry?.visuals) ? entry.visuals : [];
    for (const asset of mediaAssets) {
      if (asset?.kind === "document" && asset.storageMode !== "reference" && asset.assetPath) {
        paths.set(String(asset.assetPath), String(asset.mimeType ?? ""));
      }
    }
  }
  for (const session of Array.isArray(value?.composerSessions) ? value.composerSessions : []) {
    for (const reference of Array.isArray(session?.referenceSnapshots) ? session.referenceSnapshots : []) {
      if (reference?.sourceType !== "temporary") continue;
      for (const asset of Array.isArray(reference.assetRefs) ? reference.assetRefs : []) {
        if (asset?.kind === "document" && asset.archivePath) {
          paths.set(String(asset.archivePath), String(asset.mimeType ?? ""));
        }
      }
    }
  }
  return paths;
}

function hasRecoverableCaseContent(entry = {}) {
  if ([entry.title, entry.text, entry.note, entry.url].some((value) => clean(value))) return true;
  if ((entry.mediaAssets ?? []).some((asset) => asset && typeof asset === "object")) return true;
  return (entry.articleDocument?.blocks ?? []).some((block) => clean(block?.text) || clean(block?.assetId));
}

function dropDanglingAiAssignments(values, context) {
  return (Array.isArray(values) ? values : []).flatMap((assignment) => {
    if (!AI_ASSIGNMENT_SOURCES.has(assignment?.source)) return [assignment];
    const missingVocabulary = !context.facetIds.has(clean(assignment?.facetId)) ||
      !context.nodeIds.has(clean(assignment?.nodeId));
    const visualId = clean(assignment?.visualId);
    const missingMedia = Boolean(visualId) && !context.mediaIds.has(visualId);
    if (!missingVocabulary && !missingMedia) return [assignment];
    context.importStats.droppedAiAssignments += 1;
    context.importDiagnostics.push({
      code: "ai_assignment_dropped",
      severity: "metadata",
      action: "dropped",
      entryId: context.entryId,
      reason: missingVocabulary ? "missing_vocabulary" : "missing_media"
    });
    return [];
  });
}

function parsedImportEvidence(value) {
  if (!Number.isInteger(value?.sourcePackageVersion) || !Array.isArray(value?.importDiagnostics) ||
      !value?.importStats || typeof value.importStats !== "object") return null;
  return {
    diagnostics: structuredClone(value.importDiagnostics),
    stats: structuredClone(value.importStats)
  };
}

function mergeImportDiagnostics(previous, current) {
  const result = [];
  const seen = new Set();
  for (const diagnostic of [...previous, ...current]) {
    if (!diagnostic || typeof diagnostic !== "object") continue;
    const key = JSON.stringify(diagnostic);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(structuredClone(diagnostic));
  }
  return result;
}

function mergeImportStats(previous, current) {
  const dropped = {};
  for (const key of ["droppedAiAssignments", "droppedMediaDescriptors", "droppedMediaFiles"]) {
    dropped[key] = nonNegativeStat(previous?.[key]) + nonNegativeStat(current?.[key]);
  }
  return {
    ...current,
    inputCases: Number.isSafeInteger(previous?.inputCases)
      ? nonNegativeStat(previous.inputCases)
      : nonNegativeStat(current?.inputCases),
    keptCases: nonNegativeStat(current?.keptCases),
    skippedCases: nonNegativeStat(previous?.skippedCases) + nonNegativeStat(current?.skippedCases),
    ...dropped
  };
}

function nonNegativeStat(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
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
