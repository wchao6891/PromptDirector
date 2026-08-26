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

function clean(value) {
  return String(value ?? "").trim();
}
