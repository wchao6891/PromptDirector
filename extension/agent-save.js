import { agentError, requireWebUrl } from "./agent-protocol.js";
import { materializeLogicalCases, normalizeCompoundCases } from "./compound-cases.js";
import { normalizeEntryMedia } from "./media.js";
import { normalizeArticleDocument } from "./article-document.js";

export function resolveAgentProject(state, project = "") {
  if (!project) return "";
  const matches = (state.organizerState?.collections || []).filter(item => item.id === project || item.name === project);
  if (matches.length !== 1) throw agentError("ambiguous_project", "项目不存在或名称不唯一，请先搜索并使用项目编号。");
  return matches[0].id;
}

export async function saveAgentMaterial(input, requestId, deps) {
  const { loadState, transfers, buildEntry, classify, place, commit, notify, schemaVersion } = deps;
  const state = await loadState();
  const instanceId = await deps.getInstanceId?.() || "";
  const prior = state.entries.find(entry => entry.agentProvenance?.requestId === requestId && entry.agentProvenance.instanceId === instanceId);
  if (prior) return { ok: true, results: [{ status: "duplicate", entryId: prior.id, title: prior.title }] };
  if (!String(input.title || "").trim()) throw agentError("invalid_input", "请提供案例标题。");
  const collectionId = resolveAgentProject(state, input.project);
  const sourceUrl = input.sourceUrl ? requireWebUrl(input.sourceUrl) : "";
  const sourceCaseIds = [...new Set(input.sourceCaseIds || [])];
  const logicalCases = materializeLogicalCases(state.entries, normalizeCompoundCases(state.compoundCases, state.entries));
  const sources = sourceCaseIds.map(id => {
    const entry = logicalCases.find(item => item.id === id);
    if (!entry) throw agentError("source_case_missing", "来源案例已不存在，请核对参考范围。");
    return { caseId: id, title: entry.title, url: entry.url || "" };
  });
  const records = [];
  for (const id of [...new Set(input.transferIds || [])]) {
    const record = await transfers.get(id);
    if (record.state !== "ready") throw agentError("transfer_not_ready", "附件尚未准备好，或已经用于另一次入库。");
    records.push(record);
  }
  let text = String(input.text || "");
  if (input.bodyTransferId) {
    const body = records.find(record => record.id === input.bodyTransferId);
    if (!body || body.prepared.asset.kind !== "document") throw agentError("invalid_body", "正文文件必须是本次附件中的文档。");
    text = body.prepared.contentText;
  }
  const mediaAssets = records.flatMap(record => [record.prepared.asset, ...(record.prepared.poster ? [record.prepared.poster] : [])]);
  if (!text.trim() && !mediaAssets.length) throw agentError("empty_material", "没有可保存的正文或附件。");
  const warnings = records.flatMap(record => record.prepared.warnings || []);
  if (/!\[[^\]]*\]\([^)]+\)/u.test(text)) {
    warnings.push("正文含 Markdown 图片引用；原文已保留，图片须作为附件提交，未自动下载这些链接。");
  }
  const base = buildEntry({ title: input.title, text, url: sourceUrl, allowEmptyText: mediaAssets.length > 0 });
  const blocks = [
    ...(text ? [{ id: "body", kind: "paragraph", text, sourceOrder: 0 }] : []),
    ...mediaAssets.filter(asset => asset.usage !== "poster" && asset.kind !== "audio").map((asset, index) => ({
      id: `media:${asset.id}`, kind: asset.kind, assetId: asset.id, label: asset.sourceTitle, sourceOrder: index + 1
    }))
  ];
  const entry = normalizeEntryMedia({ ...base, schemaVersion, mediaAssets,
    primaryMediaId: mediaAssets.find(asset => asset.usage !== "poster")?.id || "",
    articleDocument: normalizeArticleDocument({ blocks }),
    mediaPrompts: records.filter(record => input.filePrompts?.[record.id]).map(record => ({
      assetId: record.assetId, text: input.filePrompts[record.id], source: "manual"
    })),
    sourcePages: [...(sourceUrl ? [{ url: sourceUrl, title: input.title }] : []), ...sources.filter(s => s.url).map(s => ({ url: s.url, title: s.title }))],
    agentProvenance: { requestId, instanceId, kind: input.kind, sources, note: String(input.note || ""), savedAt: new Date().toISOString() },
    customLabels: [], metadataLabels: [], facetAssignments: [], analysisCandidates: [],
    analysisBreakdown: [], rejectedCandidateKeys: [], negativeTerms: [], analysisPending: false });
  entry.classification = classify(entry, state);
  const entries = [...state.entries, entry];
  const organizerState = place(state.organizerState, entries, [entry.id], { collectionId });
  // Receipt provenance and transfer ownership are committed with the entry.
  // Retrying after a lost acknowledgement cannot create another case.
  await commit({ entries, organizerState,
    ...Object.fromEntries(records.map(record => [transfers.key(record.id), { ...record, state: "committed", entryId: entry.id }])) });
  try { await notify(entries.length); } catch { warnings.push("案例已保存，但界面通知未送达。"); }
  return { ok: true, results: [{ status: warnings.length ? "partial" : "saved", entryId: entry.id, title: entry.title, warnings }] };
}
