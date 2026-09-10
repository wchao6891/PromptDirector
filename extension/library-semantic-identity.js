const RECEIVER_LOCAL_FIELDS = new Set([
  "libraryAddedAt",
  "importBatchId",
  "importSource",
  "schemaVersion",
  "assetPath",
  "screenshotPath",
  "byteSize",
  "relativePath",
  "sourceLastModified",
  "linkStatus"
]);

export function caseSemanticFingerprint(entryValue = {}) {
  const managedAssets = Array.isArray(entryValue?.mediaAssets)
    ? entryValue.mediaAssets.filter((asset) => asset?.storageMode !== "reference")
    : [];
  if (managedAssets.some((asset) => !/^[a-f0-9]{64}$/iu.test(clean(asset?.contentHash)))) return "";
  const canonical = canonicalizeReceiverIds(entryValue);
  const { id: _entryId, ...entry } = canonical;
  return stableJson(withoutReceiverLocalFields(entry));
}

export function reconcileLibrarySemanticIdentity(stateValue = {}) {
  const state = stateValue && typeof stateValue === "object" ? structuredClone(stateValue) : {};
  const entries = Array.isArray(state.entries) ? state.entries : [];
  const groups = new Map();
  for (const entry of entries) {
    const fingerprint = caseSemanticFingerprint(entry);
    if (!fingerprint) continue;
    const group = groups.get(fingerprint) ?? [];
    group.push(entry);
    groups.set(fingerprint, group);
  }

  const entryIdMap = new Map();
  const assetIdMap = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = group.toSorted((left, right) => compareStableIds(left?.id, right?.id));
    const canonical = ordered[0];
    for (const duplicate of ordered.slice(1)) {
      const duplicateId = clean(duplicate?.id);
      const canonicalId = clean(canonical?.id);
      if (!duplicateId || !canonicalId || duplicateId === canonicalId) continue;
      entryIdMap.set(duplicateId, canonicalId);
      const canonicalAssets = Array.isArray(canonical.mediaAssets) ? canonical.mediaAssets : [];
      const duplicateAssets = Array.isArray(duplicate.mediaAssets) ? duplicate.mediaAssets : [];
      for (const [index, duplicateAsset] of duplicateAssets.entries()) {
        const duplicateAssetId = clean(duplicateAsset?.id);
        const canonicalAssetId = clean(canonicalAssets[index]?.id);
        if (duplicateAssetId && canonicalAssetId && duplicateAssetId !== canonicalAssetId) {
          assetIdMap.set(duplicateAssetId, canonicalAssetId);
        }
      }
    }
  }

  if (!entryIdMap.size) {
    return { state, changed: false, entryIdMap: {}, assetIdMap: {} };
  }

  state.entries = entries
    .filter((entry) => !entryIdMap.has(clean(entry?.id)))
    .sort((left, right) => compareStableIds(left?.id, right?.id));
  const remapped = remapLibraryReferences(state, entryIdMap, assetIdMap);
  if (Array.isArray(remapped.compoundCases)) {
    remapped.compoundCases = remapped.compoundCases.filter((compound) =>
      new Set(Array.isArray(compound?.memberEntryIds) ? compound.memberEntryIds : []).size >= 2
    );
  }
  return {
    state: remapped,
    changed: true,
    entryIdMap: Object.fromEntries(entryIdMap),
    assetIdMap: Object.fromEntries(assetIdMap)
  };
}

const ENTRY_ID_FIELDS = new Set(["entryId", "parentEntryId", "sourceEntryId", "targetEntryId"]);
const ENTRY_ID_LIST_FIELDS = new Set([
  "entryIds", "memberEntryIds", "sourceEntryIds", "excludedEntryIds", "screenshotEntryIds", "tempReferenceIds"
]);
const ASSET_ID_FIELDS = new Set([
  "assetId", "posterAssetId", "derivedFromAssetId", "coverVisualId", "primaryMediaId", "primaryVisualId", "visualId", "frameAssetId"
]);
const ASSET_ID_LIST_FIELDS = new Set(["assetIds", "mediaIds", "visualIds"]);

function remapLibraryReferences(value, entryIdMap, assetIdMap, parentKey = "") {
  if (Array.isArray(value)) {
    const remapped = value.map((item) => remapLibraryReferences(item, entryIdMap, assetIdMap, parentKey));
    if (ENTRY_ID_LIST_FIELDS.has(parentKey) || ASSET_ID_LIST_FIELDS.has(parentKey)) {
      return [...new Set(remapped)];
    }
    return remapped;
  }
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    if (parentKey === "referenceId") return remapReferenceId(value, entryIdMap, assetIdMap);
    if (ENTRY_ID_FIELDS.has(parentKey) || ENTRY_ID_LIST_FIELDS.has(parentKey)) return entryIdMap.get(value) ?? value;
    if (ASSET_ID_FIELDS.has(parentKey) || ASSET_ID_LIST_FIELDS.has(parentKey)) return assetIdMap.get(value) ?? value;
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    remapLibraryReferences(item, entryIdMap, assetIdMap, key)
  ]));
}

function remapReferenceId(value, entryIdMap, assetIdMap) {
  let result = value;
  for (const [sourceId, targetId] of entryIdMap) {
    if (result === sourceId) return targetId;
    if (result.startsWith(`${sourceId}:`)) {
      result = `${targetId}:${result.slice(sourceId.length + 1)}`;
      break;
    }
  }
  for (const [sourceId, targetId] of assetIdMap) {
    if (result === sourceId) return targetId;
    if (result.endsWith(`:${sourceId}`)) return `${result.slice(0, -sourceId.length)}${targetId}`;
  }
  return result;
}

function canonicalizeReceiverIds(entryValue) {
  const entry = entryValue && typeof entryValue === "object" ? structuredClone(entryValue) : {};
  const replacements = new Map();
  if (clean(entry.id)) replacements.set(clean(entry.id), "$entry");
  for (const [index, asset] of (Array.isArray(entry.mediaAssets) ? entry.mediaAssets : []).entries()) {
    if (clean(asset?.id)) replacements.set(clean(asset.id), `$media:${index}`);
  }
  return replaceKnownIds(entry, replacements);
}

function replaceKnownIds(value, replacements) {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceKnownIds(item, replacements));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceKnownIds(item, replacements)]));
}

function withoutReceiverLocalFields(value, parentKey = "") {
  if (Array.isArray(value)) return value.map((item) => withoutReceiverLocalFields(item, parentKey));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (RECEIVER_LOCAL_FIELDS.has(key)) continue;
    const item = value[key];
    if (item === undefined || item === null) continue;
    if (parentKey === "classification" && ["reason", "classifierVersion"].includes(key)) continue;
    result[key] = withoutReceiverLocalFields(item, key);
  }
  return result;
}

function stableJson(value) {
  return JSON.stringify(value);
}

function compareStableIds(leftValue, rightValue) {
  const left = clean(leftValue);
  const right = clean(rightValue);
  return left < right ? -1 : left > right ? 1 : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}
