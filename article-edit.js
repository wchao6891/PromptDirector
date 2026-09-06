import { articleDocumentText, normalizeArticleDocument } from "./article-document.js";
import { entryTextRevision, markEntryTextChanged } from "./analysis-revision.js";

export const ARTICLE_TEXT_KINDS = new Set(["heading", "paragraph", "list", "quote", "code", "table"]);

// Edit only existing text blocks; media, links and their positions stay authoritative.
export function updateArticleText(entry, patches, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== entryTextRevision(entry)) {
    throw new Error("正文已发生变化，请重新打开后再编辑");
  }
  if (!entry.articleDocument?.blocks?.length || !Array.isArray(patches)) throw new Error("文章正文无效");
  const blocks = entry.articleDocument.blocks;
  const changes = new Map();
  for (const patch of patches) {
    if (!patch || changes.has(patch.blockId) || typeof patch.text !== "string"
      || !blocks.some(block => block.id === patch.blockId && ARTICLE_TEXT_KINDS.has(block.kind))) {
      throw new Error("正文修改包含无效段落");
    }
    changes.set(patch.blockId, patch.text);
  }
  const articleDocument = normalizeArticleDocument({ ...entry.articleDocument,
    blocks: blocks.map(block => changes.has(block.id) ? { ...block, text: changes.get(block.id) } : block) });
  if (!articleDocument) throw new Error("文章正文不能为空");
  const next = markEntryTextChanged(entry, articleDocumentText(articleDocument));
  // A block edit can change structure without changing the flattened search text.
  if (JSON.stringify(articleDocument) !== JSON.stringify(entry.articleDocument)
    && next.textRevision === entry.textRevision) next.textRevision = entryTextRevision(entry) + 1;
  return { ...next, articleDocument };
}
