import { normalizeFacetCatalog, uniqueNames } from "./facets.js";
import { normalizeSettings } from "./lib.js";
import { SCHEMA_VERSION, mergeTaxonomies, normalizeTaxonomy } from "./taxonomy.js";
import {
  collectionEntryIds,
  collectionSubtreeIds,
  createDefaultOrganizerState,
  mergeOrganizerState,
  normalizeOrganizerState
} from "./organizer.js";
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
import { remapArticleDocumentAssets } from "./article-document.js";
import { boundedMediaBlobFromResponse, isSupportedDocumentMimeType } from "./bounded-media.js";
import {
  assetFormatForExtension,
  fileExtension,
  isReportedMimeCompatible
} from "./asset-formats.js";

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
  return parseLibraryPackage(value, preparedFiles, limitsValue);
}

export function parseLibraryPackage(value, files = new Map(), limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  const skipMediaByteValidation = limitsValue?.skipMediaByteValidation === true;
  if (!value || value.format !== LIBRARY_PACKAGE_FORMAT || !isSupportedLibraryPackageVersion(value.version) || !Array.isArray(value.entries)) {
    throw new Error("这个 ZIP 不是受支持的 PromptDirector 分享包");
  }
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
  if (value.version >= 4) {
    for (const entry of data.entries) {
      for (const asset of Array.isArray(entry?.mediaAssets) ? entry.mediaAssets : []) {
        if (asset?.storageMode === "reference") continue;
        validatePortableMediaDescriptor(asset, clean(asset?.assetPath), value.version);
      }
    }
  }
  data.entries = data.entries.map((entry) => {
    const normalized = normalizeEntryVisuals(entry);
    if (value.version >= 4) {
      const normalizedIds = new Set(normalized.mediaAssets.map((asset) => asset.id));
      const missingAsset = (Array.isArray(entry?.mediaAssets) ? entry.mediaAssets : [])
        .find((asset) => asset?.storageMode !== "reference" && clean(asset?.id) && !normalizedIds.has(clean(asset.id)));
      if (missingAsset) throw new Error("案例包包含无法安全规范化的媒体描述");
    }
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
      const format = validatePortableMediaDescriptor(asset, path, value.version);
      const blob = files.get(path);
      if (!(blob instanceof Blob) || !blobMatchesKind(blob, asset, format, value.version)) {
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
  const imported = parseLibraryPackage(importedValue, packageImagePlaceholders(importedValue), {
    skipMediaByteValidation: true
  });
  const importMetadata = localImportMetadata(options);
  const empty = !(current.entries ?? []).length && options.preserveLibraryConfiguration !== true;
  if (empty) {
    const skillMerge = mergeCreativeSkillsState(current.creativeSkills, imported.creativeSkills, options);
    return {
      state: {
        ...structuredClone(current),
        entries: imported.entries.map((entry) => withLocalImportMetadata(withoutArchivePath(entry), importMetadata)),
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
  const organizerEntryIdMap = {};
  let importedCount = 0;
  let remappedCount = 0;
  let skippedCount = 0;
  for (const source of imported.entries) {
    const idCollision = usedEntryIds.has(source.id);
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
    entryIdMap[source.id] = targetId;
    organizerEntryIdMap[source.id] = targetId;
    importedCount += 1;
  }
  for (const targetId of Object.values(entryIdMap)) {
    const importedEntry = next.entries.find((item) => item.id === targetId);
    if (!importedEntry?.creationMeta?.sourceEntryIds) continue;
    importedEntry.creationMeta.sourceEntryIds = importedEntry.creationMeta.sourceEntryIds.map((id) => organizerEntryIdMap[id] ?? id);
  }
  next.organizerState = mergeOrganizerState(
    next.organizerState,
    imported.organizerState,
    organizerEntryIdMap,
    options.preserveLibraryConfiguration === true ? { createdAt: importMetadata.libraryAddedAt } : {}
  );
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
  for (const entry of Array.isArray(value?.entries) ? value.entries : []) {
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
