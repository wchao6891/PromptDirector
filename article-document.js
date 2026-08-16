export const ARTICLE_DOCUMENT_VERSION = 1;

const TEXT_BLOCK_KINDS = new Set(["heading", "paragraph", "list", "quote", "code", "table"]);
const ASSET_BLOCK_KINDS = new Set(["image", "video", "document"]);
const BLOCK_KINDS = new Set([...TEXT_BLOCK_KINDS, ...ASSET_BLOCK_KINDS, "link"]);

export function normalizeArticleDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const seen = new Set();
  const blocks = (Array.isArray(value.blocks) ? value.blocks : []).flatMap((block, index) => {
    const normalized = normalizeArticleBlock(block, index);
    if (!normalized || seen.has(normalized.id)) return [];
    seen.add(normalized.id);
    return [normalized];
  }).sort((left, right) => left.sourceOrder - right.sourceOrder);
  if (!blocks.length) return null;
  return { version: ARTICLE_DOCUMENT_VERSION, blocks };
}

export function articleDocumentText(value) {
  const documentValue = normalizeArticleDocument(value);
  if (!documentValue) return "";
  return documentValue.blocks
    .filter((block) => TEXT_BLOCK_KINDS.has(block.kind))
    .map((block) => block.text)
    .filter(Boolean)
    .join("\n\n");
}

export function remapArticleDocumentAssets(value, assetIdMapValue) {
  const documentValue = normalizeArticleDocument(value);
  if (!documentValue) return null;
  const assetIdMap = assetIdMapValue instanceof Map
    ? assetIdMapValue
    : new Map(Object.entries(assetIdMapValue && typeof assetIdMapValue === "object" ? assetIdMapValue : {}));
  return normalizeArticleDocument({
    ...documentValue,
    blocks: documentValue.blocks.map((block) => block.assetId && assetIdMap.has(block.assetId)
      ? { ...block, assetId: clean(assetIdMap.get(block.assetId)) }
      : block)
  });
}

export function finalizeArticleDocumentAssets(value, assetIdMapValue) {
  const documentValue = normalizeArticleDocument(value);
  if (!documentValue) return null;
  const assetIdMap = assetIdMapValue instanceof Map
    ? assetIdMapValue
    : new Map(Object.entries(assetIdMapValue && typeof assetIdMapValue === "object" ? assetIdMapValue : {}));
  return normalizeArticleDocument({
    ...documentValue,
    blocks: documentValue.blocks.map((block) => {
      if (!block.assetId) return block;
      const mapped = clean(assetIdMap.get(block.assetId));
      if (mapped) return { ...block, assetId: mapped };
      const { assetId: _assetId, ...referenceOnly } = block;
      return referenceOnly;
    })
  });
}

export function removeArticleDocumentAsset(value, assetIdValue) {
  const documentValue = normalizeArticleDocument(value);
  if (!documentValue) return null;
  const assetId = clean(assetIdValue);
  return normalizeArticleDocument({
    ...documentValue,
    blocks: documentValue.blocks.filter((block) => block.assetId !== assetId)
  });
}

function normalizeArticleBlock(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const kind = BLOCK_KINDS.has(value.kind) ? value.kind : "";
  if (!kind) return null;
  const id = clean(value.id) || `article-block:${index + 1}`;
  const text = cleanMultiline(value.text);
  const assetId = clean(value.assetId);
  const sourceUrl = safeHttpUrl(value.sourceUrl || value.url);
  if (TEXT_BLOCK_KINDS.has(kind) && !text) return null;
  if (ASSET_BLOCK_KINDS.has(kind) && !assetId && !sourceUrl) return null;
  if (kind === "link" && !sourceUrl) return null;
  const sourceOrderValue = Number(value.sourceOrder);
  const sourceOrder = Number.isSafeInteger(sourceOrderValue) && sourceOrderValue >= 0 ? sourceOrderValue : index;
  const label = clean(value.label);
  const mimeType = clean(value.mimeType).toLocaleLowerCase("en-US");
  const block = {
    id,
    kind,
    sourceOrder,
    ...(text ? { text } : {}),
    ...(assetId ? { assetId } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(label ? { label } : {}),
    ...(mimeType ? { mimeType } : {})
  };
  if (kind === "heading") block.level = Math.min(6, Math.max(1, Math.trunc(Number(value.level) || 2)));
  if (kind === "list") block.ordered = value.ordered === true;
  if (kind === "video" && safeHttpUrl(value.posterUrl)) block.posterUrl = safeHttpUrl(value.posterUrl);
  return block;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
}

function cleanMultiline(value) {
  return String(value ?? "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/[\t ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
