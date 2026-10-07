import { agentError, requireInteger } from "./agent-protocol.js";
import { materializeLogicalCases, normalizeCompoundCases } from "./compound-cases.js";
import { entryMediaAssets } from "./media.js";
import { pdReference, parsePdReference } from "./pd-reference.js";
import { libraryWorkspaceReferences, createWorkspaceSnapshot } from "./workspace-context.js";
import { resolveCaseMediaId } from './media-identity-aliases.js';
import { CASE_LIBRARY_REVISION_KEY } from "./library-storage.js";
import { assertCaseFilesReadable } from './case-file-status.js';

export const REFERENCE_SELECTION_KEY = "agentReferenceSelection";
const empty = () => ({ version: 1, revision: 0, caseIds: [] });

export function createReferenceSelection({ storage, loadState, readDerived, getLibraryId, enqueue }) {
  const readSelection = async () => (await storage.get(REFERENCE_SELECTION_KEY))[REFERENCE_SELECTION_KEY] || empty();
  let cached = null;
  const readVersion = async () => {
    const stored = await storage.get([REFERENCE_SELECTION_KEY, CASE_LIBRARY_REVISION_KEY]);
    return { selection: stored[REFERENCE_SELECTION_KEY] || empty(), revision: stored[CASE_LIBRARY_REVISION_KEY] };
  };
  // Derived document text lives outside the case revision. Recheck only selected documents;
  // an extraction completion or read failure must invalidate the material as well.
  const documentText = async id => {
    try { return { searchText: (await readDerived(id))?.searchText || "" }; }
    catch { return { failed: true }; }
  };
  const sameDocuments = async documents => {
    const current = await Promise.all([...documents].map(async ([id, before]) => {
      const after = await documentText(id);
      return before.searchText === after.searchText && before.failed === after.failed;
    }));
    return current.every(Boolean);
  };
  return {
    // A revisioned snapshot can be read while a writer is waiting for disk.
    // Updates still serialize and compare the caller's expected revision.
    get: readSelection,
    update: input => enqueue(async () => {
      requireInteger(input.expectedRevision);
      if (!Array.isArray(input.caseIds) || input.caseIds.some(id => typeof id !== "string" || !id.trim()) || new Set(input.caseIds).size !== input.caseIds.length) {
        throw agentError("invalid_input", "参考选择必须是唯一的案例编号列表。");
      }
      const current = await readSelection();
      if (input.expectedRevision !== current.revision) throw agentError("selection_conflict", "参考已在其他页面改变，请按当前显示的选择继续。");
      if (JSON.stringify(input.caseIds) === JSON.stringify(current.caseIds)) return current;
      const state = await loadState();
      const entries = materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries));
      if (input.caseIds.some(id => !current.caseIds.includes(id) && !entries.some(entry => entry.id === id))) throw agentError("case_not_found", "所选案例已删除，请刷新后重选。");
      const next = { version: 1, revision: current.revision + 1, caseIds: [...input.caseIds] };
      await storage.set({ [REFERENCE_SELECTION_KEY]: next });
      cached = null;
      return next;
    }),
    read: input => enqueue(async () => {
      const { selection, revision } = await readVersion();
      const selectionKey = JSON.stringify(selection);
      let snapshot = cached;
      if (!revision || snapshot?.libraryRevision !== revision || snapshot.selectionKey !== selectionKey || !await sameDocuments(snapshot.documents)) {
        const documents = new Map();
        const readDocument = async id => {
          const value = await documentText(id); documents.set(id, value);
          if (value.failed) throw new Error("文档文字暂时不可读");
          return value;
        };
        const materials = selection.caseIds.length
          ? await libraryWorkspaceReferences(await loadState(), selection.caseIds, readDocument) : { references: [], issues: [] };
        snapshot = { libraryRevision: revision, selectionKey, documents,
          page: await createWorkspaceSnapshot({ surface: "library", selectionRevision: selection.revision, selectedCaseIds: selection.caseIds, ...materials }) };
      }
      const libraryId = await getLibraryId();
      const current = await readVersion();
      if (revision !== current.revision || selectionKey !== JSON.stringify(current.selection)) {
        cached = null;
        throw agentError("selection_changed", "读取期间选择或参考资料已改变，请重新读取工作现场。");
      }
      cached = revision ? snapshot : null;
      const result = snapshot.page(input);
      return { state: "ready", source: "saved_selection", libraryId, selectionRevision: selection.revision, ...result,
        ...(result.references ? { references: result.references.map(item => ({ ...item,
          reference: pdReference({ libraryId, caseId: item.caseId, assetId: item.assetId }) })) } : {}) };
    }),
    resolve: input => enqueue(async () => {
      let identity;
      try { identity = parsePdReference(input.reference); } catch (error) { throw agentError("invalid_reference", error.message); }
      if (identity.libraryId !== await getLibraryId()) throw agentError("library_mismatch", "引用属于另一份资料库，请连接对应资料库；不能按同名案例猜测。");
      const state = await loadState();
      const entry = materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries)).find(item => item.id === identity.caseId);
      if (!entry) throw agentError("case_not_found", "引用的案例已删除或不在此库中。");
      assertCaseFilesReadable(entry);
      identity.assetId = resolveCaseMediaId(entry, identity.assetId);
      const assets = entryMediaAssets(entry);
      if (identity.assetId && !assets.some(asset => asset.id === identity.assetId)) throw agentError("asset_not_in_case", "引用的素材不属于该案例。");
      return { ...identity, title: entry.title, sourceUrl: entry.url || "", media: assets.filter(asset => !identity.assetId || asset.id === identity.assetId).map(asset => ({
        assetId: asset.id, kind: asset.kind, mimeType: asset.mimeType, byteSize: asset.byteSize, usage: asset.usage || ""
      })), next: "用 read_case_details 读取来源、正文、媒体、标注与组织关系；read_case 读取原词；read_media 读取所需原件。", untrustedContent: true };
    })
  };
}

// UI events enter one queue: a quick series of clicks cannot save out of order.
// Conflicts are surfaced and refreshed, never silently overwrite another tab.
export function createSelectionWriter({ read, write, onError, onRefresh }) {
  let revision = 0, known = [], desired = [], ready = false, queue = Promise.resolve(), generation = 0;
  const refresh = async () => {
    const value = await read();
    revision = value.revision; known = [...value.caseIds]; desired = [...known]; ready = true;
    return value;
  };
  return {
    initialize() {
      const pending = queue.then(refresh);
      queue = pending.catch(() => {});
      return pending;
    },
    save(caseIds) {
      if (!ready || JSON.stringify(caseIds) === JSON.stringify(desired)) return queue;
      desired = [...caseIds];
      const ids = [...caseIds];
      const epoch = generation;
      queue = queue.then(async () => {
        if (epoch !== generation) return;
        if (JSON.stringify(ids) === JSON.stringify(known)) return;
        const value = await write({ expectedRevision: revision, caseIds: ids });
        revision = value.revision; known = [...value.caseIds];
      }).catch(async error => {
        generation++;
        ready = false;
        try { const value = await refresh(); onRefresh(value); }
        catch { /* Keep writes disabled until a successful explicit refresh. */ }
        onError(error);
      });
      return queue;
    },
    observe(value) {
      if (!value) return queue;
      queue = queue.then(() => {
        // Own-write events may arrive before their acknowledgement. Waiting for
        // the write queue prevents an echo from rolling back later local clicks.
        if (!ready || value.revision <= revision) return;
        // Clicks queued before this change was painted belong to the old
        // selection. Do not apply them with the newly observed revision.
        generation++;
        revision = value.revision;
        known = [...value.caseIds]; desired = [...known];
        onRefresh(value);
      }).catch(onError);
      return queue;
    },
    flush: () => queue
  };
}
