export const ARTICLE_DOCUMENT_VERSION = 1;

const TEXT_BLOCK_KINDS = new Set(["heading", "paragraph", "list", "quote", "code", "table"]);
const ASSET_BLOCK_KINDS = new Set(["image", "video", "document", "attachment"]);
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
  const byId = new Map(blocks.map(block => [block.id, block]));
  const owned = new Set();
  for (const table of blocks.filter(block => block.rows)) {
    for (const row of table.rows) for (const cell of row) {
      cell.blockIds = cell.blockIds.filter(id => byId.has(id) && !byId.get(id).rows && !owned.has(id) && id !== table.id && (owned.add(id), true));
    }
    table.text = table.rows.map(row => row.map(cell => cell.blockIds.map(id => byId.get(id).text || "").filter(Boolean).join("\n")).join("\t")).join("\n").trim();
  }
  return { version: ARTICLE_DOCUMENT_VERSION, blocks };
}

export function articleDocumentText(value) {
  const documentValue = normalizeArticleDocument(value);
  if (!documentValue) return "";
  const cellIds = new Set(documentValue.blocks.flatMap(block => (block.rows || []).flatMap(row => row.flatMap(cell => cell.blockIds))));
  return documentValue.blocks
    .filter((block) => TEXT_BLOCK_KINDS.has(block.kind) && !cellIds.has(block.id))
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
  const text = kind === "code"
    ? String(value.text ?? "").replace(/\r\n?/gu, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    : cleanMultiline(value.text);
  const assetId = clean(value.assetId);
  const sourceUrl = safeHttpUrl(value.sourceUrl || value.url);
  if (TEXT_BLOCK_KINDS.has(kind) && !text && !(kind === "table" && Array.isArray(value.rows) && value.rows.length)) return null;
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
  if (kind === "table" && Array.isArray(value.rows) && value.rows.length) {
    block.rows = value.rows.filter(Array.isArray).map(row => row.filter(cell => cell && typeof cell === "object").map(cell => ({
      header: cell.header === true,
      rowspan: Number.isSafeInteger(cell.rowspan) && cell.rowspan > 0 ? cell.rowspan : 1,
      colspan: Number.isSafeInteger(cell.colspan) && cell.colspan > 0 ? cell.colspan : 1,
      ...(Number.isFinite(cell.width) && cell.width > 0 ? { width: cell.width } : {}),
      ...(["left", "right", "center", "justify", "start", "end"].includes(cell.align) ? { align: cell.align } : {}),
      ...(["top", "middle", "bottom", "baseline"].includes(cell.valign) ? { valign: cell.valign } : {}),
      blockIds: Array.isArray(cell.blockIds) ? cell.blockIds.map(clean).filter(Boolean) : []
    })));
  }
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
