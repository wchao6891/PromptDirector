import { normalizeFacetCatalog } from "./facets.js";
import { normalizeSettings } from "./lib.js";
import { normalizeComposerSessions, normalizeComposerSettings } from "./composer.js";
import {
  normalizeCreativeExperimentSettings,
  normalizeCreativeRuns
} from "./creative-runs.js";
import { normalizeEntryMedia } from "./media.js";
import { normalizeOrganizerState } from "./organizer.js";
import { normalizeCompoundCases } from "./compound-cases.js";
import { normalizeTaxonomy } from "./taxonomy.js";
import { normalizeTrashState } from "./trash.js";
import { caseSemanticFingerprint } from "./library-semantic-identity.js";
import { normalizeCreativeSkillsState } from "./creative-skills.js";

const PLAN_TOKEN_VERSION = "v3";
const DEFAULT_RECEIPT_TTL_MS = 30 * 60 * 1000;
const RECEIPT_STATUSES = new Set(["pending", "completed"]);

export function createLibraryImportPlanToken(stateValue = {}, sourceValue = {}, planValue = {}) {
  const payload = stableJson({
    state: projectLibraryImportState(stateValue),
    source: projectLibraryImportSource(sourceValue),
    plan: cloneData(planValue)
  });
  return `import-plan:${PLAN_TOKEN_VERSION}:${fnv1a64(payload)}`;
}

export function assertLibraryImportPlanCurrent(tokenValue, stateValue = {}, sourceValue = {}, planValue = {}) {
  const token = String(tokenValue ?? "").trim();
  if (token && token === createLibraryImportPlanToken(stateValue, sourceValue, planValue)) return;
  throw Object.assign(new Error("预览后资料库发生了变化，请重新检查再导入"), {
    code: "IMPORT_PLAN_STALE"
  });
}

export function normalizeLibraryImportTransactionsState(value = {}, options = {}) {
  const now = toTimestamp(options.now);
  const retentionMs = normalizeRetentionMs(options.retentionMs);
  const receipts = new Map();
  for (const candidate of Array.isArray(value?.items) ? value.items : []) {
    const receipt = normalizeLibraryImportTransaction(candidate, { now, retentionMs });
    if (!receipt) continue;
    const existing = receipts.get(receipt.operationId);
    if (!existing || toTimestamp(receipt.updatedAt) >= toTimestamp(existing.updatedAt)) {
      receipts.set(receipt.operationId, receipt);
    }
  }
  const items = [...receipts.values()].filter((item) => !isReceiptExpired(item, now));
  return { version: 1, items };
}

export function claimLibraryImportTransaction(stateValue, request = {}, options = {}) {
  const operationId = clean(request.operationId);
  const planToken = clean(request.planToken);
  if (!operationId) throw libraryImportTransactionError("导入事务缺少 operationId", "IMPORT_TRANSACTION_INVALID");
  if (!planToken) throw libraryImportTransactionError("导入事务缺少 planToken", "IMPORT_TRANSACTION_INVALID");

  const now = toTimestamp(options.now);
  const retentionMs = normalizeRetentionMs(options.retentionMs);
  const state = normalizeLibraryImportTransactionsState(stateValue, { now, retentionMs });
  const current = state.items.find((item) => item.operationId === operationId);
  if (current) {
    if (current.planToken !== planToken) {
      throw libraryImportTransactionError("同一导入操作已经对应不同的计划，不能复用", "IMPORT_RECEIPT_CONFLICT");
    }
    if (current.status === "completed") {
      return {
        state,
        receipt: current,
        result: cloneData(current.result),
        acquired: false,
        replayed: true,
        pending: false
      };
    }
    return {
      state,
      receipt: current,
      acquired: false,
      replayed: false,
      pending: true
    };
  }

  assertLibraryImportPlanCurrent(planToken, request.stateValue, request.sourceValue, request.planValue);

  const receipt = normalizeLibraryImportTransaction({
    operationId,
    planToken,
    status: "pending",
    createdAt: isoString(now),
    updatedAt: isoString(now),
    expiresAt: isoString(now + retentionMs)
  }, { now, retentionMs });

  return {
    state: { version: 1, items: [...state.items, receipt] },
    receipt,
    acquired: true,
    replayed: false,
    pending: true
  };
}

export function succeedLibraryImportTransaction(stateValue, receiptValue, resultValue = {}, options = {}) {
  const operationId = clean(receiptValue?.operationId);
  const planToken = clean(receiptValue?.planToken);
  if (!operationId || !planToken) {
    throw libraryImportTransactionError("导入事务缺少回执编号", "IMPORT_TRANSACTION_INVALID");
  }

  const now = toTimestamp(options.now);
  const retentionMs = normalizeRetentionMs(options.retentionMs);
  const state = normalizeLibraryImportTransactionsState(stateValue, { now, retentionMs });
  const current = state.items.find((item) => item.operationId === operationId);
  if (current) {
    if (current.planToken !== planToken) {
      throw libraryImportTransactionError("导入回执计划已经变化，不能写回结果", "IMPORT_RECEIPT_CONFLICT");
    }
    if (current.status === "completed") {
      return {
        state,
        receipt: current,
        result: cloneData(current.result),
        replayed: true
      };
    }
    if (current.status !== "pending") {
      throw libraryImportTransactionError("导入回执状态无效", "IMPORT_TRANSACTION_INVALID");
    }
  } else {
    throw libraryImportTransactionError("没有找到可完成的导入回执", "IMPORT_TRANSACTION_MISSING");
  }

  const completed = normalizeLibraryImportTransaction({
    ...current,
    status: "completed",
    result: cloneData(resultValue),
    updatedAt: isoString(now),
    expiresAt: isoString(now + retentionMs)
  }, { now, retentionMs });

  return {
    state: replaceLibraryImportTransaction(state, completed),
    receipt: completed,
    result: cloneData(resultValue),
    replayed: false
  };
}

export function failLibraryImportTransaction(stateValue, receiptValue, options = {}) {
  const operationId = clean(receiptValue?.operationId);
  const planToken = clean(receiptValue?.planToken);
  if (!operationId || !planToken) {
    throw libraryImportTransactionError("导入事务缺少回执编号", "IMPORT_TRANSACTION_INVALID");
  }

  const now = toTimestamp(options.now);
  const retentionMs = normalizeRetentionMs(options.retentionMs);
  const state = normalizeLibraryImportTransactionsState(stateValue, { now, retentionMs });
  const current = state.items.find((item) => item.operationId === operationId);
  if (!current) return state;
  if (current.planToken !== planToken) {
    throw libraryImportTransactionError("导入回执计划已经变化，不能清理", "IMPORT_RECEIPT_CONFLICT");
  }
  if (current.status === "completed") {
    return state;
  }
  return {
    ...state,
    items: state.items.filter((item) => item.operationId !== operationId)
  };
}

function projectLibraryImportSource(value = {}) {
  const projected = projectLibraryImportState(value);
  const schemaVersion = toFiniteNumber(value?.schemaVersion);
  const sourcePackageVersion = toFiniteNumber(value?.sourcePackageVersion);
  if (schemaVersion !== null) projected.schemaVersion = schemaVersion;
  if (sourcePackageVersion !== null) projected.sourcePackageVersion = sourcePackageVersion;
  return projected;
}

function projectLibraryImportState(value = {}) {
  const entries = projectLibraryImportEntries(value?.entries);
  const entryIds = entries.map((entry) => entry.id);
  return {
    entries,
    organizerState: normalizeOrganizerState(value?.organizerState, entryIds),
    compoundCases: normalizeCompoundCases(value?.compoundCases, entries),
    trashState: normalizeTrashState(value?.trashState),
    settings: normalizeSettings(value?.settings),
    taxonomy: normalizeTaxonomy(value?.taxonomy),
    facetCatalog: normalizeFacetCatalog(value?.facetCatalog),
    classificationRules: Array.isArray(value?.classificationRules) ? structuredClone(value.classificationRules) : [],
    composerSettings: normalizeComposerSettings(value?.composerSettings),
    composerSessions: normalizeComposerSessions(value?.composerSessions),
    creativeExperimentSettings: normalizeCreativeExperimentSettings(value?.creativeExperimentSettings),
    creativeRuns: normalizeCreativeRuns(value?.creativeRuns),
    creativeSkills: normalizeCreativeSkillsState(value?.creativeSkills)
  };
}

function projectLibraryImportEntries(value) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => normalizeEntryMedia(entry))
    .filter(Boolean)
    .map((entry) => {
      const normalized = structuredClone(entry);
      delete normalized.importBatchId;
      delete normalized.importSource;
      delete normalized.libraryAddedAt;
      return {
        id: clean(normalized.id),
        fingerprint: caseSemanticFingerprint(normalized),
        mediaAssetIds: normalized.mediaAssets.map((asset) => asset.id)
      };
    })
    .filter((entry) => Boolean(entry.id));
}

function normalizeLibraryImportTransaction(value, { now, retentionMs } = {}) {
  const operationId = clean(value?.operationId);
  const planToken = clean(value?.planToken);
  if (!operationId || !planToken) return null;
  const status = RECEIPT_STATUSES.has(value?.status) ? value.status : "pending";
  const createdAt = isoString(value?.createdAt) || isoString(value?.updatedAt) || isoString(now);
  const updatedAt = isoString(value?.updatedAt) || createdAt;
  const expiresAt = isoString(value?.expiresAt) || isoString((toTimestamp(updatedAt) || now || Date.now()) + normalizeRetentionMs(retentionMs));
  const receipt = {
    operationId,
    planToken,
    status,
    createdAt,
    updatedAt,
    expiresAt
  };
  if (status === "completed" && Object.hasOwn(value ?? {}, "result")) {
    receipt.result = cloneData(value.result);
  }
  return receipt;
}

function replaceLibraryImportTransaction(state, receipt) {
  const items = state.items.some((item) => item.operationId === receipt.operationId)
    ? state.items.map((item) => item.operationId === receipt.operationId ? receipt : item)
    : [...state.items, receipt];
  return { ...state, items };
}

function isReceiptExpired(receipt, now) {
  const nowMs = toTimestamp(now);
  const expiresAt = toTimestamp(receipt?.expiresAt);
  return Number.isFinite(nowMs) && Number.isFinite(expiresAt) && nowMs >= expiresAt;
}

function normalizeRetentionMs(value) {
  const milliseconds = Math.floor(Number(value));
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : DEFAULT_RECEIPT_TTL_MS;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toTimestamp(value) {
  if (Number.isFinite(value)) return Number(value);
  const parsed = Date.parse(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function isoString(value) {
  const timestamp = toTimestamp(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "";
}

function clean(value) {
  return String(value ?? "").trim();
}

function stableJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((key) => {
    const item = value[key];
    return item === undefined ? [] : [[key, canonicalValue(item)]];
  }));
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function cloneData(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through to JSON cloning for plain receipts/results.
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function libraryImportTransactionError(message, code) {
  return Object.assign(new Error(message), { code });
}
