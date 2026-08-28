const RECOVERY_POINT_VERSION = 1;

export function createLibraryReplacementRecoveryPoint(stateValue, options = {}) {
  const state = cloneManagedState(stateValue);
  const createdAt = isoString(options.createdAt) || new Date().toISOString();
  const id = clean(options.id) || `library-recovery:${globalThis.crypto.randomUUID()}`;
  return {
    version: RECOVERY_POINT_VERSION,
    id,
    createdAt,
    state,
    retainedAssetIds: uniqueIds(options.retainedAssetIds)
  };
}

export function normalizeLibraryReplacementRecoveryPoint(value) {
  if (Number(value?.version) !== RECOVERY_POINT_VERSION) return null;
  const id = clean(value?.id);
  const createdAt = isoString(value?.createdAt);
  if (!id || !createdAt || !isManagedState(value?.state)) return null;
  return {
    version: RECOVERY_POINT_VERSION,
    id,
    createdAt,
    state: cloneManagedState(value.state),
    retainedAssetIds: uniqueIds(value.retainedAssetIds)
  };
}

export function swapLibraryReplacementRecoveryPoint(currentStateValue, pointValue, options = {}) {
  const point = normalizeLibraryReplacementRecoveryPoint(pointValue);
  if (!point) throw new Error("没有可用的资料库回退点");
  return {
    targetState: cloneManagedState(point.state),
    recoveryPoint: createLibraryReplacementRecoveryPoint(currentStateValue, {
      id: options.id,
      createdAt: options.createdAt,
      retainedAssetIds: options.retainedAssetIds
    })
  };
}

export function obsoleteRecoveryAssetIds(previousPointValue, retainedStateAssetIdsValue, nextPointValue) {
  const previous = normalizeLibraryReplacementRecoveryPoint(previousPointValue);
  if (!previous) return [];
  const retained = new Set([
    ...uniqueIds(retainedStateAssetIdsValue),
    ...uniqueIds(normalizeLibraryReplacementRecoveryPoint(nextPointValue)?.retainedAssetIds)
  ]);
  return previous.retainedAssetIds.filter((assetId) => !retained.has(assetId));
}

function cloneManagedState(value) {
  if (!isManagedState(value)) throw new Error("资料库回退点缺少有效状态");
  return structuredClone(value);
}

function isManagedState(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.entries));
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(clean).filter(Boolean))].sort();
}

function clean(value) {
  return String(value ?? "").trim();
}

function isoString(value) {
  const timestamp = Date.parse(String(value ?? "").trim());
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}
