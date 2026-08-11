import { normalizeLocalRelativePath } from "./local-media.js";

const KINDS = new Set(["image", "video", "document"]);

export function normalizeImportStagingState(value = {}) {
  return {
    version: 1,
    assets: (Array.isArray(value?.assets) ? value.assets : [])
      .map(normalizeStagedAsset)
      .filter(Boolean)
  };
}

export function addStagedAsset(stateValue, assetValue) {
  const state = normalizeImportStagingState(stateValue);
  const asset = normalizeStagedAsset(assetValue);
  if (!asset) throw new Error("暂存资料缺少有效元数据");
  if (state.assets.some((item) => item.id === asset.id)) throw new Error("这项资料已经暂存");
  return { state: { ...state, assets: [...state.assets, asset] }, asset };
}

export function removeStagedAsset(stateValue, stagedAssetId) {
  const state = normalizeImportStagingState(stateValue);
  const id = clean(stagedAssetId);
  const asset = state.assets.find((item) => item.id === id);
  if (!asset) throw new Error("没有找到这项暂存资料");
  return {
    state: { ...state, assets: state.assets.filter((item) => item.id !== id) },
    asset,
    removedAssetIds: [...new Set([asset.assetId, asset.posterAssetId].filter(Boolean))]
  };
}

export function stagedAssetById(stateValue, stagedAssetId) {
  return normalizeImportStagingState(stateValue).assets.find((item) => item.id === clean(stagedAssetId)) ?? null;
}

export function importStagingAssetIds(stateValue) {
  return [...new Set(normalizeImportStagingState(stateValue).assets
    .flatMap((item) => [item.assetId, item.posterAssetId])
    .filter(Boolean))];
}

export function collectRetainedLocalAssetIds(state = {}) {
  return new Set([
    ...(Array.isArray(state.entries) ? state.entries : [])
      .flatMap((entry) => Array.isArray(entry?.mediaAssets) ? entry.mediaAssets.map((asset) => asset?.id) : []),
    ...(Array.isArray(state.creativeRuns) ? state.creativeRuns : [])
      .flatMap((run) => (Array.isArray(run?.outputs) ? run.outputs : []).map((output) => output?.visual?.id)),
    ...(Array.isArray(state.creativeSkills?.items) ? state.creativeSkills.items : [])
      .flatMap((skill) => (Array.isArray(skill?.packageFiles) ? skill.packageFiles : []).map((file) => file?.assetId)),
    ...(Array.isArray(state.composerSessions) ? state.composerSessions : []).flatMap(temporarySessionAssetIds),
    ...(Array.isArray(state.creativeJobs?.items) ? state.creativeJobs.items : [])
      .flatMap((job) => temporarySessionAssetIds(job?.request?.session)),
    ...importStagingAssetIds(state.importStaging)
  ].map(clean).filter(Boolean));
}

function temporarySessionAssetIds(session) {
  return (Array.isArray(session?.referenceSnapshots) ? session.referenceSnapshots : [])
    .filter((reference) => reference?.sourceType === "temporary")
    .flatMap((reference) => (Array.isArray(reference?.assetRefs) ? reference.assetRefs : []).map((asset) => asset?.assetId));
}

function normalizeStagedAsset(value) {
  const id = clean(value?.id);
  const assetId = clean(value?.assetId);
  const name = fileName(value?.name);
  const kind = KINDS.has(value?.kind) ? value.kind : "";
  const mimeType = clean(value?.mimeType).toLocaleLowerCase("en-US");
  const byteSize = Math.max(0, Math.floor(Number(value?.byteSize) || 0));
  const contentHash = clean(value?.contentHash).toLocaleLowerCase("en-US");
  if (!id || !assetId || !name || !kind || !mimeType || !byteSize || !/^[a-f0-9]{64}$/u.test(contentHash)) return null;
  let relativePath;
  try {
    relativePath = normalizeLocalRelativePath(value?.relativePath, name);
  } catch {
    return null;
  }
  return {
    id,
    assetId,
    name,
    relativePath,
    kind,
    mimeType,
    byteSize,
    contentHash,
    ...(positiveInteger(value?.width) ? { width: positiveInteger(value.width) } : {}),
    ...(positiveInteger(value?.height) ? { height: positiveInteger(value.height) } : {}),
    ...(positiveInteger(value?.durationMs) ? { durationMs: positiveInteger(value.durationMs) } : {}),
    ...(clean(value?.playbackCapability) ? { playbackCapability: clean(value.playbackCapability) } : {}),
    ...(clean(value?.contentText) ? { contentText: clean(value.contentText) } : {}),
    ...(["markdown", "plain"].includes(value?.contentFormat) ? { contentFormat: value.contentFormat } : {}),
    ...(clean(value?.sourceFormat) ? { sourceFormat: clean(value.sourceFormat) } : {}),
    ...(Array.isArray(value?.warnings) ? { warnings: [...new Set(value.warnings.map(clean).filter(Boolean))] } : {}),
    ...(clean(value?.posterAssetId) ? { posterAssetId: clean(value.posterAssetId) } : {}),
    ...(normalizePoster(value?.posterAsset) ? { posterAsset: normalizePoster(value.posterAsset) } : {}),
    ...(clean(value?.duplicateAssetId) ? { duplicateAssetId: clean(value.duplicateAssetId) } : {})
  };
}

function normalizePoster(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const mimeType = clean(value.mimeType).toLocaleLowerCase("en-US");
  const byteSize = positiveInteger(value.byteSize);
  if (!id || !mimeType.startsWith("image/") || !byteSize) return null;
  return {
    id,
    kind: "image",
    usage: "poster",
    storageMode: "managed",
    mimeType,
    byteSize,
    ...(positiveInteger(value.width) ? { width: positiveInteger(value.width) } : {}),
    ...(positiveInteger(value.height) ? { height: positiveInteger(value.height) } : {})
  };
}

function fileName(value) {
  const source = clean(value).replaceAll("\\", "/");
  return source.split("/").at(-1) ?? "";
}

function positiveInteger(value) {
  const number = Math.floor(Number(value) || 0);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}
