import {
  hasLibrarySalvageDiagnostics,
  mergeLibraryPackage,
  parseCompleteFolderBackup,
  parseLibraryPackage
} from "./library-package.js";
import { filesWithoutInvalidLibraryImages, findInvalidImportedImageIds } from "./library-import-media.js";
import { createLibraryImportPlanToken } from "./library-import-transaction.js";
import { caseSemanticFingerprint } from "./library-semantic-identity.js";
import { libraryStoredAssetIds } from "./library-asset-inventory.js";

export const LIBRARY_TRANSFER_SOURCES = Object.freeze({
  SHARE_PACKAGE: "share-package",
  COMPLETE_BACKUP: "complete-backup",
  RESCUE_BACKUP: "rescue-backup"
});

export const LIBRARY_TRANSFER_MODES = Object.freeze({
  SAFE_MERGE: "safe-merge",
  EXACT_REPLACE: "exact-replace"
});

const SOURCE_TYPES = new Set(Object.values(LIBRARY_TRANSFER_SOURCES));

export async function inspectLibraryTransfer({
  sourceType,
  library,
  files = new Map(),
  limits = {},
  validateImage,
  sourceReport
} = {}) {
  if (!SOURCE_TYPES.has(sourceType)) throw new Error("资料检查缺少有效来源类型");
  if (!(files instanceof Map)) throw new Error("资料检查缺少有效资源清单");

  const strict = sourceType === LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP;
  const sourceDiagnostics = Array.isArray(sourceReport?.diagnostics)
    ? structuredClone(sourceReport.diagnostics)
    : [];
  let effectiveSourceType = sourceType;
  let inspected;
  if (strict) {
    try {
      inspected = await parseCompleteFolderBackup(library, files, limits);
    } catch (error) {
      let rescued;
      try {
        rescued = parseLibraryPackage(library, files, { ...limits, salvageInvalidMedia: true });
      } catch {
        throw error;
      }
      if (!hasLibrarySalvageDiagnostics(rescued.importDiagnostics)) throw error;
      inspected = rescued;
      effectiveSourceType = LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP;
      sourceDiagnostics.push(completeBackupRescueDiagnostic());
    }
  } else {
    inspected = parseLibraryPackage(library, files, { ...limits, salvageInvalidMedia: true });
  }
  if (validateImage !== undefined) {
    const invalidImageIds = await findInvalidImportedImageIds(inspected.images, validateImage);
    if (invalidImageIds.size) {
      const salvageFiles = filesWithoutInvalidLibraryImages(library, files, invalidImageIds);
      inspected = parseLibraryPackage(library, salvageFiles, { ...limits, salvageInvalidMedia: true });
      if (strict) {
        effectiveSourceType = LIBRARY_TRANSFER_SOURCES.RESCUE_BACKUP;
        sourceDiagnostics.push(completeBackupRescueDiagnostic());
      }
      inspected.importDiagnostics = inspected.importDiagnostics.map((diagnostic) =>
        diagnostic.action === "dropped" && invalidImageIds.has(diagnostic.assetId)
          ? { ...diagnostic, reason: "decode_failure" }
          : diagnostic
      );
    }
  }
  const {
    assets,
    images,
    skillAssets,
    importDiagnostics,
    importStats,
    ...state
  } = inspected;
  const diagnostics = [...sourceDiagnostics, ...structuredClone(importDiagnostics)];

  return {
    sourceType: effectiveSourceType,
    state,
    resources: { assets, images, skillAssets },
    resourceIndex: {
      mediaAssetIds: [...assets.keys()],
      skillAssetIds: [...skillAssets.keys()]
    },
    report: {
      status: diagnostics.length ? "partial" : "ready",
      diagnostics,
      stats: mergeReportStats(sourceReport?.stats, importStats)
    }
  };
}

function completeBackupRescueDiagnostic() {
  return {
    code: "backup_integrity_degraded",
    severity: "backup",
    action: "rescue",
    reason: "recoverable_content_failure"
  };
}

export function planLibraryTransfer({ currentState = {}, inspection, options = {} } = {}) {
  if (!inspection?.state || !inspection?.report) throw new Error("资料恢复计划缺少检查结果");
  const preferredPlan = options.preferredPlan && typeof options.preferredPlan === "object"
    ? options.preferredPlan
    : {};
  const preferredMappings = preferredPlan.mappings && typeof preferredPlan.mappings === "object"
    ? preferredPlan.mappings
    : {};
  const mode = normalizeTransferMode(preferredPlan.mode ?? options.mode);
  if (mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE && inspection.sourceType !== LIBRARY_TRANSFER_SOURCES.COMPLETE_BACKUP) {
    throw new Error("救援备份只能安全合并，不能恢复成备份当时状态");
  }
  const libraryAddedAt = receiverTimestamp(preferredPlan.libraryAddedAt || options.now);
  const importBatchId = clean(preferredPlan.importBatchId || options.importBatchId) ||
    `library-import:${globalThis.crypto.randomUUID()}`;
  const preserveLibraryConfiguration = preferredPlan.preserveLibraryConfiguration === true ||
    (!Object.hasOwn(preferredPlan, "preserveLibraryConfiguration") && options.preserveLibraryConfiguration === true);
  const importReport = cloneReport(preferredPlan.importReport ?? inspection.report);
  const conflicts = mode === LIBRARY_TRANSFER_MODES.SAFE_MERGE
    ? libraryEntryConflicts(currentState.entries, inspection.state.entries)
    : [];
  const conflictResolutions = plannedConflictResolutions(
    conflicts,
    preferredPlan.conflictResolutions ?? options.conflictResolutions
  );
  const resourceIndex = inspection.resourceIndex ?? {
    mediaAssetIds: inspection.resources?.assets instanceof Map ? [...inspection.resources.assets.keys()] : [],
    skillAssetIds: inspection.resources?.skillAssets instanceof Map ? [...inspection.resources.skillAssets.keys()] : []
  };
  const exactVisualIdMap = mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE
    ? isolatedResourceMap(resourceIndex.mediaAssetIds, preferredMappings.visualIds, "restore-media")
    : preferredMappings.visualIds;
  const exactSkillAssetIdMap = mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE
    ? isolatedResourceMap(resourceIndex.skillAssetIds, preferredMappings.skillAssetIds, "skill-file:restore")
    : preferredMappings.skillAssetIds;
  const mergeReceiver = mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE
    ? exactReplacementReceiver(inspection.state)
    : currentState;
  const result = mergeLibraryPackage(mergeReceiver, inspection.state, {
    preserveLibraryConfiguration: mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE || preserveLibraryConfiguration,
    libraryAddedAt,
    importBatchId,
    importReport,
    facetIdMap: preferredMappings.facetIds,
    nodeIdMap: preferredMappings.nodeIds,
    entryIdMap: preferredMappings.entryIds,
    collectionIdMap: preferredMappings.collectionIds,
    compoundIdMap: preferredMappings.compoundIds,
    visualIdMap: exactVisualIdMap,
    reservedVisualIds: mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE ? resourceIndex.mediaAssetIds : [],
    entryConflictResolutions: conflictResolutions,
    sessionIdMap: preferredMappings.sessionIds,
    runIdMap: preferredMappings.runIds,
    skillIdMap: preferredMappings.skillIds,
    skillVersionIdMap: preferredMappings.skillVersionIds,
    packageAssetIdMap: exactSkillAssetIdMap,
    trashEntryIdMap: preferredMappings.trashEntryIds,
    trashCollectionIdMap: preferredMappings.trashCollectionIds,
    trashCompoundIdMap: preferredMappings.trashCompoundIds
  });
  if (mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE) {
    restoreExactEntryImportMetadata(result.state.entries, inspection.state.entries, result.entryIdMap);
  }
  const mappings = {
    entryIds: result.entryIdMap,
    collectionIds: result.collectionIdMap ?? {},
    facetIds: result.facetIdMap ?? {},
    nodeIds: result.nodeIdMap ?? {},
    compoundIds: result.compoundIdMap,
    visualIds: result.visualIdMap,
    createdVisualIds: result.createdVisualIdMap,
    sessionIds: result.sessionIdMap,
    runIds: result.runIdMap,
    skillIds: result.skillIdMap,
    skillVersionIds: result.skillVersionIdMap ?? {},
    skillAssetIds: result.packageAssetIdMap,
    trashEntryIds: result.trashEntryIdMap ?? {},
    trashCollectionIds: result.trashCollectionIdMap ?? {},
    trashCompoundIds: result.trashCompoundIdMap ?? {}
  };
  const resourceWrites = [
    ...resourceIndex.mediaAssetIds.flatMap((sourceId) => (
      mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE ? mappings.visualIds[sourceId] : mappings.createdVisualIds[sourceId]
    )
      ? [{
          sourceId,
          targetId: mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE
            ? mappings.visualIds[sourceId]
            : mappings.createdVisualIds[sourceId],
          resourceType: "media"
        }]
      : []),
    ...resourceIndex.skillAssetIds.flatMap((sourceId) => mappings.skillAssetIds[sourceId]
      ? [{ sourceId, targetId: mappings.skillAssetIds[sourceId], resourceType: "skill" }]
      : [])
  ];
  const rollback = mode === LIBRARY_TRANSFER_MODES.EXACT_REPLACE
    ? { required: true, retainedAssetIds: retainedLibraryAssetIds(currentState) }
    : { required: false, retainedAssetIds: [] };
  const context = {
    version: 1,
    sourceType: inspection.sourceType,
    mode,
    preserveLibraryConfiguration,
    libraryAddedAt,
    importBatchId,
    importReport,
    mappings,
    conflictResolutions,
    resourceWrites,
    cleanupAssetIds: [],
    rollback
  };

  return {
    ...result,
    targetState: result.state,
    mappings,
    resourceWrites,
    cleanupAssetIds: [],
    rollback,
    conflicts: conflicts.map((conflict) => ({
      ...conflict,
      resolution: conflictResolutions[conflict.entryId]
    })),
    context,
    planToken: createLibraryImportPlanToken(currentState, inspection.state, context)
  };
}

export function libraryTransferWriteBytes(resourceWritesValue, resourcesValue = {}) {
  const assets = resourcesValue?.assets instanceof Map ? resourcesValue.assets : new Map();
  const skillAssets = resourcesValue?.skillAssets instanceof Map ? resourcesValue.skillAssets : new Map();
  let total = 0;
  for (const item of Array.isArray(resourceWritesValue) ? resourceWritesValue : []) {
    const blob = item?.resourceType === "skill"
      ? skillAssets.get(item.sourceId)
      : assets.get(item?.sourceId);
    if (!(blob instanceof Blob)) throw new Error("恢复计划引用的资源已经变化，请重新检查");
    total += blob.size;
  }
  return total;
}

function normalizeTransferMode(value) {
  return value === LIBRARY_TRANSFER_MODES.EXACT_REPLACE
    ? LIBRARY_TRANSFER_MODES.EXACT_REPLACE
    : LIBRARY_TRANSFER_MODES.SAFE_MERGE;
}

function libraryEntryConflicts(currentEntriesValue, incomingEntriesValue) {
  const current = new Map((Array.isArray(currentEntriesValue) ? currentEntriesValue : [])
    .map((entry) => [clean(entry?.id), entry]).filter(([id]) => Boolean(id)));
  return (Array.isArray(incomingEntriesValue) ? incomingEntriesValue : []).flatMap((incoming) => {
    const local = current.get(clean(incoming?.id));
    if (!local) return [];
    const localFingerprint = caseSemanticFingerprint(local);
    const incomingFingerprint = caseSemanticFingerprint(incoming);
    if (localFingerprint && incomingFingerprint && localFingerprint === incomingFingerprint) return [];
    return [{
      entryId: clean(incoming.id),
      localTitle: clean(local.title) || "未命名案例",
      incomingTitle: clean(incoming.title) || "未命名案例"
    }];
  });
}

function plannedConflictResolutions(conflicts, value) {
  const requested = value && typeof value === "object" ? value : {};
  return Object.fromEntries(conflicts.map((conflict) => {
    const resolution = ["keep-local", "use-incoming", "keep-both"].includes(requested[conflict.entryId])
      ? requested[conflict.entryId]
      : "keep-local";
    return [conflict.entryId, resolution];
  }));
}

function isolatedResourceMap(sourceIdsValue, preferredValue, prefix) {
  const preferred = preferredValue && typeof preferredValue === "object" ? preferredValue : {};
  const used = new Set();
  return Object.fromEntries((Array.isArray(sourceIdsValue) ? sourceIdsValue : []).map((sourceIdValue) => {
    const sourceId = clean(sourceIdValue);
    const planned = clean(preferred[sourceId]);
    const targetId = planned && planned !== sourceId && !used.has(planned)
      ? planned
      : `${prefix}:${globalThis.crypto.randomUUID()}`;
    used.add(targetId);
    return [sourceId, targetId];
  }).filter(([sourceId]) => Boolean(sourceId)));
}

function exactReplacementReceiver(source = {}) {
  return {
    ...structuredClone(source),
    entries: [],
    trashState: { version: 1, items: [] },
    organizerState: { version: 1, collections: [] },
    compoundCases: [],
    composerSessions: [],
    creativeRuns: [],
    creativeSkills: { version: 1, items: [] }
  };
}

function restoreExactEntryImportMetadata(targetEntriesValue, sourceEntriesValue, entryIdMap = {}) {
  const targets = new Map((Array.isArray(targetEntriesValue) ? targetEntriesValue : []).map((entry) => [entry.id, entry]));
  for (const source of Array.isArray(sourceEntriesValue) ? sourceEntriesValue : []) {
    const target = targets.get(entryIdMap[source.id] ?? source.id);
    if (!target) continue;
    for (const key of ["libraryAddedAt", "importBatchId", "importSource"]) {
      if (Object.hasOwn(source, key)) target[key] = structuredClone(source[key]);
      else delete target[key];
    }
  }
}

function retainedLibraryAssetIds(state = {}) {
  return [...libraryStoredAssetIds(state)].sort();
}

function receiverTimestamp(value) {
  const requested = clean(value);
  return requested && Number.isFinite(Date.parse(requested))
    ? new Date(requested).toISOString()
    : new Date().toISOString();
}

function cloneReport(value) {
  return {
    status: value?.status === "partial" ? "partial" : "ready",
    diagnostics: Array.isArray(value?.diagnostics) ? structuredClone(value.diagnostics) : [],
    stats: value?.stats && typeof value.stats === "object" ? structuredClone(value.stats) : {}
  };
}

function mergeReportStats(sourceValue, inspectedValue) {
  const merged = sourceValue && typeof sourceValue === "object" ? structuredClone(sourceValue) : {};
  for (const [key, value] of Object.entries(inspectedValue && typeof inspectedValue === "object" ? inspectedValue : {})) {
    const number = Number(value);
    merged[key] = Number.isFinite(number) ? number : value;
  }
  return merged;
}

function clean(value) {
  return String(value ?? "").trim();
}
