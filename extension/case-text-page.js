import { sha256Blob } from './blob-digest.js';
import { agentError } from './agent-protocol.js';
import { ResourceCache } from './resource-cache.js';
import { operationBudget } from './resource-policy.js';

// The revision fixes the requested text and its identity, including derived
// document text. It is a read cursor, not the case-edit revision.
export function createCaseTextPager({ digest = sha256Blob, budget } = {}) {
  const limits = operationBudget(budget);
  const pages = new ResourceCache({ maxEntries: limits.maxRequests, maxBytes: limits.maxTextBytes,
    cost: value => value.text.length * 2 });
  return async ({ caseId, assetId, part, text, offset, length, expectedRevision }) => {
    if (offset > 0 && !expectedRevision) throw agentError('case_revision_required', '续读文字需要首屏的 revision，请从第一页重新读取。');
    const key = JSON.stringify([caseId, assetId || null, part]);
    let page = pages.get(key);
    // Compare the actual current text, not timestamps or caller-provided versions.
    if (!page || page.text !== text) {
      page = { text, revision: digest(new Blob([JSON.stringify([caseId, assetId || null, part, text])])) };
      pages.set(key, page);
    }
    let revision;
    try { revision = await page.revision; }
    catch (error) { if (pages.get(key) === page) pages.delete(key); throw error; }
    if (expectedRevision && expectedRevision !== revision) throw agentError('case_text_changed', '案例文字或读取部分已变化，请从第一页重新读取，不能拼接旧页。');
    return { revision, offset, content: text.slice(offset, offset + length), totalCharacters: text.length,
      nextOffset: offset + length < text.length ? offset + length : null, untrustedContent: true };
  };
}

export const caseTextPage = createCaseTextPager();
