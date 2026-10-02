import { caseRevision } from "./case-operations.js";
import { projectRevision } from "./project-operations.js";
import { materialProvenance } from "./material-provenance.js";
import { canonicalInput } from "./agent-tasks.js";
import { sha256Blob } from "./blob-digest.js";
import { planImageGenerationPrompts, generationPromptConfirmation } from "./image-generation-ingestion.js";
import { embeddedMediaPrompts } from "./image-generation-info.js";
import { agentError, requireWebUrl } from "./agent-protocol.js";
import { materializeLogicalCases, normalizeCompoundCases } from "./compound-cases.js";
import { normalizeEntryMedia } from "./media.js";
import { normalizeArticleDocument } from "./article-document.js";

export function resolveAgentProject(state, project = "") {
  if (!project) return "";
  const collections = state.organizerState?.collections || [];
  const exact = collections.find(item => item.id === project);
  if (exact) return exact.id;
  const matches = collections.filter(item => item.name === project);
  if (matches.length !== 1) throw agentError("ambiguous_project", "项目不存在或名称不唯一，请先搜索并使用项目编号。");
  return matches[0].id;
}

export async function saveAgentMaterial(input, requestId, deps) {
  const { loadState, transfers, buildEntry, classify, place, commit, notify, schemaVersion } = deps;
  const instanceId = await deps.getInstanceId?.() || "";
  const fingerprint = await sha256Blob(new Blob([JSON.stringify(canonicalInput(input))]));
  const receiptKey = `materialOperation:${instanceId}:${requestId}`;
  const receipt = deps.storage ? (await deps.storage.get(receiptKey))[receiptKey] : null;
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw agentError('request_conflict', '此请求编号已用于其他保存内容');
    return { ...receipt.result, replayed: true };
  }
  const state = await loadState();
  const prior = state.entries.find(entry => entry.agentProvenance?.requestId === requestId && entry.agentProvenance.instanceId === instanceId);
  if (prior) {
    if (prior.agentProvenance.fingerprint && prior.agentProvenance.fingerprint !== fingerprint) throw agentError('request_conflict', '此请求编号已用于其他保存内容');
    return { ok: true, replayed: true, results: [{ status: "duplicate", entryId: prior.id, title: prior.title }] };
  }
  if (!String(input.title || "").trim()) throw agentError("invalid_input", "请提供案例标题。");
  const collectionId = resolveAgentProject(state, input.project);
  const sourceUrl = input.sourceUrl ? requireWebUrl(input.sourceUrl) : "";
  const provenance = await materialProvenance(state, input, collectionId);
  const sourceCaseIds = [...new Set([...(input.sourceCaseIds || []), ...(input.sourceReferences || []).map(ref => ref.caseId)])];
  const logicalCases = materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries));
  const sources = sourceCaseIds.map(id => {
    const entry = logicalCases.find(item => item.id === id);
    if (!entry) throw agentError("source_case_missing", "来源案例已不存在，请核对参考范围。");
    return { caseId: id, title: entry.title, url: entry.url || "" };
  });
  const records = [];
  for (const id of [...new Set(input.transferIds || [])]) {
    const record = await transfers.get(id);
    if (record.purpose) throw agentError('invalid_transfer_purpose', 'Skill包文件不能作为案例媒体入库。');
    if (record.state !== "ready") throw agentError("transfer_not_ready", "附件尚未准备好，或已经用于另一次入库。");
    if (record.reused) {
      const blob = await deps.readBlob(record.assetId);
      if (!blob || blob.size !== record.byteSize || await sha256Blob(blob) !== record.sha256
        || record.prepared.poster && !await deps.readBlob(record.prepared.poster.id)) {
        throw agentError('integrity_failed', '复用的原件已改变或不可用，未保存资料；请重新传入本机文件。');
      }
    }
    records.push(record);
  }
  let text = String(input.text || "");
  let bodyMimeType = "text/plain";
  if (input.bodyTransferId) {
    const body = records.find(record => record.id === input.bodyTransferId);
    if (!body || body.prepared.asset.kind !== "document") throw agentError("invalid_body", "正文文件必须是本次附件中的文档。");
    text = body.prepared.contentText;
    bodyMimeType = body.prepared.asset.extractedTextFormat === "markdown" ? "text/markdown" : body.prepared.asset.mimeType;
  }
  const mediaAssets = records.flatMap(record => [record.prepared.asset, ...(record.prepared.poster ? [record.prepared.poster] : [])]);
  if (!text.trim() && !mediaAssets.length) throw agentError("empty_material", "没有可保存的正文或附件。");
  const warnings = records.flatMap(record => record.prepared.warnings || []);
  if (/!\[[^\]]*\]\([^)]+\)/u.test(text)) {
    warnings.push("正文含 Markdown 图片引用；原文已保留，图片须作为附件提交，未自动下载这些链接。");
  }
  const base = buildEntry({ title: input.title, text, url: sourceUrl, allowEmptyText: mediaAssets.length > 0 });
  const blocks = [
    ...(text ? [{ id: "body", kind: "paragraph", text, sourceOrder: 0, ...(bodyMimeType ? { mimeType: bodyMimeType } : {}) }] : []),
    ...mediaAssets.filter(asset => asset.usage !== "poster" && asset.kind !== "audio").map((asset, index) => ({
      id: `media:${asset.id}`, kind: asset.kind, assetId: asset.id, label: asset.sourceTitle, sourceOrder: index + 1
    }))
  ];
  const explicitPrompts = records.filter(record => input.filePrompts?.[record.id]).map(record => ({
    assetId: record.assetId, text: input.filePrompts[record.id], source: "manual"
  }));
  let entry = normalizeEntryMedia({ ...base, schemaVersion, mediaAssets,
    primaryMediaId: mediaAssets.find(asset => asset.usage !== "poster")?.id || "",
    articleDocument: normalizeArticleDocument({ blocks }),
    mediaPrompts: [...explicitPrompts, ...embeddedMediaPrompts(mediaAssets, explicitPrompts)],
    sourcePages: [...(sourceUrl ? [{ url: sourceUrl, title: input.title }] : []), ...sources.filter(s => s.url).map(s => ({ url: s.url, title: s.title }))],
    agentProvenance: { requestId, instanceId, fingerprint, kind: input.kind, sources, ...provenance,
      ...(input.kind === "creation" && !provenance.creationVersion ? { creationVersion: { rootCaseId: base.id, number: 1 } } : {}), note: String(input.note || ""), savedAt: new Date().toISOString() },
    customLabels: [], metadataLabels: [], facetAssignments: [], analysisCandidates: [],
    analysisBreakdown: [], rejectedCandidateKeys: [], negativeTerms: [], analysisPending: false });
  entry.classification = classify(entry, state);
  const promptPlan = await planImageGenerationPrompts(entry, mediaAssets, input.generationPromptChoices);
  if (promptPlan.conflicts.length) return generationPromptConfirmation(promptPlan.conflicts);
  entry = promptPlan.entry;
  const entries = [...state.entries, entry];
  const organizerState = place(state.organizerState, entries, [entry.id], { collectionId });
  const savedProject = organizerState.collections.find(project => project.id === collectionId);
  const result = { ok: true, results: [{ status: warnings.length ? "partial" : "saved", entryId: entry.id, title: entry.title, warnings,
    revision: await caseRevision({ ...state, entries, organizerState }, entry),
    body: { characters: entry.text.length, sha256: await sha256Blob(new Blob([entry.text])) },
    project: savedProject ? { id: savedProject.id, name: savedProject.name, revision: await projectRevision(savedProject) } : null,
    sourceCaseIds, sourceReferences: entry.agentProvenance.references || [],
    creationVersion: entry.agentProvenance.creationVersion || null }] };
  // Receipt provenance and transfer ownership are committed with the entry.
  // Retrying after a lost acknowledgement cannot create another case.
  await commit({ entries, organizerState,
    [receiptKey]: { fingerprint, result },
    ...Object.fromEntries(records.map(record => [transfers.key(record.id), { ...record, prepared: null, chunks: 0, state: "committed", entryId: entry.id }])) });
  try { await notify(entries.length); } catch { warnings.push("案例已保存，但界面通知未送达。"); result.results[0].status = 'partial'; }
  return result;
}
