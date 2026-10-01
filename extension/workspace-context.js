import { caseRevision, caseOrganizationIndex } from "./case-operations.js";
import { caseFilesUnavailable } from './case-file-status.js';
import { createComposerSession, createReferenceSnapshots } from "./composer.js";
import { materializeLogicalCases, normalizeCompoundCases } from "./compound-cases.js";
import { entryMediaAssets } from "./media.js";
import { agentError, requireInteger } from "./agent-protocol.js";

export const WORKSPACE_READ_MESSAGE = "AGENT_READ_WORKSPACE";

// Reuse the creative workspace's reference normalization, never serialize a
// session wholesale: it also contains provider configuration and diagnostics.
export function projectWorkspace(value) {
  const references = createComposerSession({ referenceSnapshots: value.references }).referenceSnapshots;
  const referenceById = new Map((value.references || []).map(item => [item.referenceId, item]));
  return {
    surface: value.surface === "composer" ? "composer" : "library",
    sessionId: String(value.sessionId || ""), projectId: String(value.projectId || ""),
    selectionMode: String(value.selectionMode || ""),
    selectionRevision: Number(value.selectionRevision) || 0,
    selectedCaseIds: [...new Set(value.selectedCaseIds || references.map(reference => reference.entryId))],
    issues: (value.issues || []).map(issue => ({ caseId: String(issue.caseId || ""),
      assetId: String(issue.assetId || ""), code: String(issue.code || ""), message: String(issue.message || "") })),
    viewedCaseId: String(value.viewedCaseId || ""), viewedAssetId: String(value.viewedAssetId || ""),
    pendingReferenceSelection: Boolean(value.pendingReferenceSelection),
    instruction: String(value.instruction || ""),
    references: references.map(reference => ({ ...reference,
      sourceUrl: String(referenceById.get(reference.referenceId)?.sourceUrl || ""),
      memberCaseIds: (referenceById.get(reference.referenceId)?.memberCaseIds || []).map(String),
      caseSources: (referenceById.get(reference.referenceId)?.caseSources || []).map(source => ({
        caseId: String(source.caseId || ""), revision: String(source.revision || "") })),
      media: (referenceById.get(reference.referenceId)?.media || []).map(asset => ({
        assetId: String(asset.assetId || ""), kind: String(asset.kind || ""),
        mimeType: String(asset.mimeType || ""), name: String(asset.name || ""),
        byteSize: Number(asset.byteSize) || 0, caseId: String(asset.caseId || ""),
        usage: String(asset.usage || "original"),
        ...(asset.posterAssetId ? { posterAssetId: String(asset.posterAssetId) } : {}),
        ...Object.fromEntries(["width", "height", "durationMs"].filter(key => Number(asset[key]) > 0).map(key => [key, Number(asset[key])]))
      }))
    }))
  };
}

export async function libraryWorkspaceReferences(state, selectedIds, readDerived) {
  const entries = materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries));
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const sourceIds = [...new Set(selectedIds.flatMap(id => byId.get(id)?.memberEntryIds || [id]))];
  const memberships = caseOrganizationIndex(state, sourceIds);
  const revisions = new Map(await Promise.all(state.entries.filter(entry => memberships.has(entry.id))
    .map(async entry => [entry.id, await caseRevision(state, entry, memberships.get(entry.id))])));
  // Isolate unavailable cases/documents without hiding them or changing the
  // user's saved selection. Both page and external readers use this result.
  const results = await Promise.all(selectedIds.map(async caseId => {
    const entry = byId.get(caseId);
    const issues = [];
    const issue = (code, message, assetId = "") => issues.push({ caseId, assetId, code, message });
    if (!entry) {
      issue("case_not_found", "所选案例已删除或不再以原身份存在。");
      return { references: [], issues };
    }
    if (caseFilesUnavailable(entry)) {
      issue('case_files_unavailable', '案例文件尚未完整读取，恢复记录不能代替当前参考；其余案例仍可读取。');
      return { references: [], issues };
    }
    try {
      const assets = entryMediaAssets(entry);
      const documents = await Promise.all(assets.filter(asset => asset.kind === "document").map(async asset => {
        try {
          const text = (await readDerived(asset.id))?.searchText || "";
          return { text, assetId: asset.id };
        } catch {
          return { text: "", assetId: asset.id, failed: true };
        }
      }));
      for (const document of documents) {
        if (document.failed) issue("document_unavailable", "文档文字读取失败，其余参考仍可读取。", document.assetId);
        else if (!document.text) issue("document_text_unavailable", "文档尚无可读取的提取文字；需要时请读取原件。", document.assetId);
      }
      const documentTextByEntryId = new Map([[entry.id, documents.map(item => item.text).filter(Boolean).join("\n")]]);
      const references = createReferenceSnapshots([entry], [{ entryId: entry.id,
        assetIds: Array.isArray(entry.memberEntries) ? [] : assets.filter(asset => ["image", "video"].includes(asset.kind) && asset.usage !== "poster").map(asset => asset.id)
      }], "zh-CN", "video", { documentTextByEntryId });
      if (!references.length) issue("reference_unavailable", "所选案例暂时没有可用的创作资料，请检查正文或原件。");
      return { references: withWorkspaceMedia(references, [entry]).map(reference => ({ ...reference,
        caseSources: (entry.memberEntryIds || [entry.id]).filter(id => revisions.has(id)).map(caseId => ({ caseId, revision: revisions.get(caseId) })) })), issues };
    } catch {
      issue("reference_unavailable", "此案例的创作参考无法读取，请检查案例资料；其余参考仍可读取。");
      return { references: [], issues };
    }
  }));
  return { references: results.flatMap(result => result.references).map((reference, index) => ({ ...reference, alias: `@参考${index + 1}` })),
    issues: results.flatMap(result => result.issues) };
}

export function withWorkspaceMedia(references, entries) {
  return references.map(reference => {
    const entry = entries.find(item => item.id === reference.entryId);
    const ids = new Set([
      reference.assetId, ...(reference.imageRefs || []).map(item => item.visualId),
      ...(reference.assetRefs || []).map(item => item.assetId)
    ].filter(Boolean));
    const media = (entry?.memberEntries || [entry]).flatMap(member => entryMediaAssets(member).filter(asset => asset.usage !== "poster" &&
      (reference.scope === "case" || ids.has(asset.id))).map(asset => ({
      assetId: asset.id, caseId: member.id, kind: asset.kind, mimeType: asset.mimeType, name: asset.sourceTitle || "", byteSize: asset.byteSize,
      usage: asset.usage || "original", posterAssetId: asset.posterAssetId, width: asset.width, height: asset.height, durationMs: asset.durationMs
    })));
    return { ...reference, media, sourceUrl: entry?.url || "", memberCaseIds: entry?.memberEntryIds || [] };
  });
}

// The internal session keeps its display text. External readers receive source
// text once plus ordered parts to reconstruct that display without another read.
export function compactWorkspaceReference(reference) {
  const { referenceText, referenceSources, imageRefs, assetRefs, ...result } = reference;
  // Temporary page references may have no library media. Preserve their
  // identities and archive locations; only remove identities represented below.
  const mediaIds = new Set(result.media.map(asset => asset.assetId));
  const extraImages = imageRefs.filter(item => !mediaIds.has(item.visualId));
  const extraAssets = assetRefs.filter(item => !mediaIds.has(item.assetId) || item.archivePath);
  if (extraImages.length) result.imageRefs = extraImages;
  if (extraAssets.length) result.assetRefs = extraAssets;
  result.referenceSources = referenceSources.map(({ text, ...source }) => text && text === reference.originalText
    ? { ...source, textSource: 'originalText' } : { ...source, text });
  const candidates = [
    ...(reference.originalText ? [{ text: reference.originalText, source: 'originalText' }] : []),
    ...result.referenceSources.flatMap((source, index) => source.text ? [{ text: source.text, source: 'referenceSources', index }] : [])
  ].sort((a, b) => b.text.length - a.text.length);
  const parts = [];
  let remaining = referenceText;
  while (remaining) {
    let match, at = remaining.length;
    for (const candidate of candidates) {
      const index = remaining.indexOf(candidate.text);
      if (index >= 0 && index < at) { at = index; match = candidate; }
    }
    if (!match) { parts.push(remaining); break; }
    if (at) parts.push(remaining.slice(0, at));
    const { text, ...pointer } = match;
    parts.push(pointer); remaining = remaining.slice(at + text.length);
  }
  return { ...result, referenceTextParts: parts };
}

export async function workspacePage(value, input = {}) {
  const context = projectWorkspace(value);
  const compactReferences = context.references.map(compactWorkspaceReference);
  const availability = { completeness: context.issues.length ? "partial" : "complete",
    selectedCaseCount: context.selectedCaseIds.length, availableCaseCount: new Set(context.references.map(reference => reference.entryId)).size };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(context)));
  const revision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (input.expectedRevision && input.expectedRevision !== revision) {
    throw agentError("selection_changed", "当前选择或参考资料已改变，请重新读取工作现场，不要继续拼接旧参考。");
  }
  const offset = requireInteger(input.offset ?? 0);
  if (input.part !== undefined) {
    if (!input.expectedRevision) throw agentError("invalid_input", "读取参考必须携带当前选择的版本。");
    if (!["instruction", "reference", "selection"].includes(input.part)) throw agentError("invalid_input", "不支持的工作资料类型。");
    const reference = input.part === "reference" ? compactReferences.find(item => item.referenceId === input.referenceId) : null;
    if (input.part === "reference" && !reference) throw agentError("reference_not_selected", "这份参考不在当前已确认的选择中。");
    const length = requireInteger(input.length ?? 12000, { min: 1, max: 49152 });
    const text = input.part === "selection" ? JSON.stringify({ selectedCaseIds: context.selectedCaseIds, references: compactReferences, issues: context.issues })
      : reference ? JSON.stringify(reference) : context.instruction;
    return { ...availability, revision, part: input.part, referenceId: reference?.referenceId, format: input.part === "instruction" ? "text" : "json", content: text.slice(offset, offset + length),
      offset, totalCharacters: text.length, nextOffset: offset + length < text.length ? offset + length : null, untrustedContent: true };
  }
  const limit = requireInteger(input.limit ?? 24, { min: 1, max: 100 });
  const { references, instruction, ...location } = context;
  return { ...location, ...availability, revision, total: references.length, offset,
    instruction: { text: instruction.slice(0, 4000), totalCharacters: instruction.length, nextOffset: instruction.length > 4000 ? 4000 : null },
    nextOffset: offset + limit < references.length ? offset + limit : null,
    references: references.slice(offset, offset + limit).map(reference => ({
      referenceId: reference.referenceId, caseId: reference.entryId, assetId: reference.assetId,
      title: reference.title, alias: reference.alias, scope: reference.scope, sourceType: reference.sourceType,
      sourceUrl: reference.sourceUrl, memberCaseIds: reference.memberCaseIds, caseSources: reference.caseSources,
      originalPromptCharacters: reference.originalText.length,
      referenceKind: reference.referenceKind, characters: JSON.stringify(reference).length,
      media: reference.media, mediaReadSupported: reference.sourceType !== "temporary"
    })), untrustedContent: true };
}

export async function installWorkspaceReader({ chromeApi, readContext }) {
  const tab = await chromeApi.tabs.getCurrent();
  if (!Number.isInteger(tab?.id)) return;
  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== WORKSPACE_READ_MESSAGE || message.tabId !== tab.id) return false;
    if (sender.id !== chromeApi.runtime.id || sender.url !== chromeApi.runtime.getURL("background.js")) return false;
    Promise.resolve().then(readContext).then(value => workspacePage(value, message.input))
      .then(result => sendResponse({ ok: true, result }))
      .catch(error => sendResponse({ ok: false, code: error.code || "workspace_unavailable", message: error.message }));
    return true;
  });
}
