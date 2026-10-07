import { assertSourceCorrection } from './case-field-access.js';
import { confirmClassification } from './classifier.js';
import { isValidContentPath } from './taxonomy.js';
import { removeCaseTags } from './case-tags.js';
import { appendFacetUndo } from './facet-history.js';
import { validateCaseOperation } from './case-operation-specs.js';
import { sha256Blob } from './blob-digest.js';
import { updateEntryText, markEntryTextChanged } from './analysis-revision.js';
import { updateArticleText, ARTICLE_TEXT_KINDS } from './article-edit.js';
import { articleDocumentText } from './article-document.js';
import { setEntryMediaPrompt, addTimeNote, removeTimeNote, setCaseCover, visualSetAnalysesForAssets } from './media.js';
import { createCompoundCase, updateCompoundCase, splitCompoundCase } from './compound-cases.js';
import { uniqueNames } from './facets.js';
import { moveEntriesBetweenCollections } from './organizer.js';
import { planCaseCopies } from './library-folder-ownership.js';
import { agentError } from './agent-protocol.js';
import { assertCaseFilesReadable } from './case-file-status.js';
import { caseAnalysisCoverage } from './analysis-coverage.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => sha256Blob(new Blob([JSON.stringify(canonical(value))]));
export const caseOperationFingerprint = hash;
const fail = (code, message) => { throw agentError(code, message); };
function entryFor(state, id) {
  const entry = state.entries.find(item => item.id === id);
  if (!entry) fail('case_not_found', '案例不存在；组合案例请指定其中的成员');
  assertCaseFilesReadable(entry);
  return entry;
}
function organization(state, id) {
  return { projects: (state.organizerState?.collections || []).filter(c => c.entryIds.includes(id)).map(({ entryIds, ...c }) => c),
    compounds: (state.compoundCases || []).filter(c => c.memberEntryIds.includes(id)) };
}
export const caseRevision = (state, entry, memberships = organization(state, entry.id)) => hash({ entry, organization: memberships });
const compoundRevision = (state, compound) => {
  const byId = new Map(state.entries.map(entry => [entry.id, entry]));
  const memberships = caseOrganizationIndex(state, compound.memberEntryIds);
  return hash({ compound, members: compound.memberEntryIds.map(id => {
    const entry = byId.get(id);
    if (!entry) fail('case_not_found', '组合成员已不存在，请重新核对');
    assertCaseFilesReadable(entry);
    return { entry, organization: memberships.get(id) };
  }) });
};
export async function operationCase(state, id) {
  const compound = state.compoundCases?.find(item => item.id === id);
  const entry = compound || entryFor(state, id);
  return { caseId: id, title: entry.title, revision: compound ? await compoundRevision(state, compound) : await caseRevision(state, entry) };
}
// Batch registration checks the same membership meaning as a single read,
// without scanning every project's entire case list once per incoming case.
export function caseOrganizationIndex(state, ids) {
  const result=new Map(ids.map(id=>[id,{projects:[],compounds:[]} ]));
  for(const {entryIds,...project} of state.organizerState?.collections??[])
    for(const id of new Set(entryIds)) if(result.has(id)) result.get(id).projects.push(project);
  for(const compound of state.compoundCases??[])
    for(const id of new Set(compound.memberEntryIds)) if(result.has(id)) result.get(id).compounds.push(compound);
  return result;
}
async function checkedEntry(state, id, revision) {
  const entry = entryFor(state, id);
  if (await caseRevision(state, entry) !== revision) fail('case_conflict', '案例或项目关系已变化，请重新读取后修改');
  return entry;
}
function httpUrl(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { fail('invalid_url', '来源地址无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('invalid_url', '来源只允许不含账号密码的 HTTP/HTTPS 地址');
  return url.href;
}
function sourceChanges(entry, patch) {
  const next = { ...entry };
  if (Object.hasOwn(patch, 'sourceUrl')) next.url = httpUrl(patch.sourceUrl);
  if (patch.sourceFacts) {
    next.sourceFacts = { ...entry.sourceFacts };
    for (const [key, value] of Object.entries(patch.sourceFacts)) {
      if (value === null) delete next.sourceFacts[key];
      else next.sourceFacts[key] = key.endsWith('Url') ? httpUrl(value) : value;
    }
  }
  if (patch.sourceFacts || Object.hasOwn(patch, 'sourceUrl')) {
    const url = next.url && new URL(next.url);
    const post = url && /(^|\.)(x|twitter)\.com$/u.test(url.hostname) && /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/|$)/u.exec(url.pathname);
    if (post) {
      if (patch.sourceFacts?.itemId && patch.sourceFacts.itemId !== post[1]) fail('source_conflict', '作品编号与来源帖子不一致');
      next.url = `https://x.com${post[0].replace(/\/$/u, '')}`;
      next.sourceFacts = { ...next.sourceFacts, provider: 'x', itemId: post[1] };
    }
  }
  return next;
}

export function editCaseEntry(entry, patch, now = new Date().toISOString()) {
  let next = sourceChanges(entry, patch);
  if (Object.hasOwn(patch, 'title')) {
    const title = patch.title.replace(/[\u0000-\u001f\u007f]/gu, '').trim();
    if (!title) fail('invalid_input', '案例标题不能为空');
    next.title = title;
  }
  if (Object.hasOwn(patch, 'text')) {
    if (entry.articleDocument?.blocks?.length) fail('article_requires_patches', '此案例有结构化正文，请按段落修改');
    next = updateEntryText(next, patch.text, next.textRevision || 1);
  }
  if (patch.articlePatches) next = updateArticleText(next, patch.articlePatches, next.textRevision || 1);
  if (patch.customLabels) next.customLabels = uniqueNames(patch.customLabels);
  for (const item of patch.mediaPrompts || []) {
    const updated = setEntryMediaPrompt(next, item.assetId, item.text, item.source, { preserveOtherSource: true });
    // Prompt normalization must not rewrite unrelated original-file metadata.
    next = { ...next, mediaPrompts: updated.mediaPrompts };
  }
  for (const item of patch.timeNotes || []) {
    if (item.endMs !== undefined && item.endMs <= item.startMs) fail('invalid_input', '笔记结束时间必须晚于开始时间');
    if (item.frameAssetId && !next.mediaAssets?.some(a => a.id === item.frameAssetId && a.kind === 'image')) fail('asset_not_in_case', '笔记关键帧必须是当前案例中的图片');
    next = { ...next, timeNotes: addTimeNote(next, item).timeNotes };
  }
  for (const id of patch.removeTimeNoteIds || []) {
    if (!next.timeNotes?.some(note => note.id === id)) fail('note_not_found', '要删除的笔记已不存在');
    next = { ...next, timeNotes: removeTimeNote(next, id).timeNotes };
  }
  if (patch.mediaSources) {
    const byId = new Map(patch.mediaSources.map(item => [item.assetId, item]));
    if (byId.size !== patch.mediaSources.length || [...byId.keys()].some(id => !next.mediaAssets?.some(a => a.id === id))) fail('asset_not_in_case', '媒体来源修改包含重复或不存在的媒体');
    next.mediaAssets = next.mediaAssets.map(asset => {
      const change = byId.get(asset.id);
      if (!change) return asset;
      const { assetId, ...fields } = change;
      if (Object.hasOwn(fields, 'originalWorkUrl')) fields.originalWorkUrl = httpUrl(fields.originalWorkUrl);
      return { ...asset, ...fields };
    });
  }
  if (patch.primaryMediaId) {
    if (!next.mediaAssets?.some(a => a.id === patch.primaryMediaId && a.usage !== 'poster')) fail('asset_not_in_case', '主要媒体不属于该案例');
    next.primaryMediaId = patch.primaryMediaId;
  }
  if (Object.hasOwn(patch, 'coverVisualId')) {
    if (patch.coverVisualId === null || patch.coverVisualId === '') delete next.coverVisualId;
    else {
      if (!next.mediaAssets?.some(a => a.id === patch.coverVisualId && a.kind === 'image')) fail('asset_not_in_case', '封面必须是该案例中的图片');
      next = { ...next, coverVisualId: setCaseCover(next, patch.coverVisualId).coverVisualId };
    }
  }
  return JSON.stringify(canonical(next)) === JSON.stringify(canonical(entry)) ? entry : { ...next, libraryUpdatedAt: now };
}

function selectMedia(entry, assetIds) {
  const assets = entry.mediaAssets || [];
  const selected = new Set(assetIds);
  if (!selected.size || selected.size !== assetIds.length || assetIds.some(id => !assets.some(a => a.id === id && a.usage !== 'poster'))) fail('asset_not_in_case', '请指定该案例中不重复的内容媒体');
  // Posters and annotated keyframes are part of the selected video, not new files.
  for (const a of assets) if (selected.has(a.id) && a.posterAssetId) selected.add(a.posterAssetId);
  for (const note of entry.timeNotes || []) if (selected.has(note.assetId) && note.frameAssetId) selected.add(note.frameAssetId);
  if ([...selected].some(id => !assets.some(a => a.id === id))) fail('asset_not_in_case', '关联的封面或关键帧元数据缺失，未转移');
  return selected;
}
function retainedIds(entry, removed) {
  const ids = new Set((entry.mediaAssets || []).filter(a => !removed.has(a.id)).map(a => a.id));
  for (const a of entry.mediaAssets || []) if (ids.has(a.id) && a.posterAssetId) ids.add(a.posterAssetId);
  for (const note of entry.timeNotes || []) if (ids.has(note.assetId) && note.frameAssetId) ids.add(note.frameAssetId);
  return ids;
}
function mediaSubset(entry, ids, retainGroupHistory = false) {
  const result = { ...entry, mediaAssets: (entry.mediaAssets || []).filter(a => ids.has(a.id)),
    mediaPrompts: (entry.mediaPrompts || []).filter(p => ids.has(p.assetId)),
    timeNotes: (entry.timeNotes || []).filter(n => ids.has(n.assetId)),
    videoAnalyses: (entry.videoAnalyses || []).filter(a => ids.has(a.assetId)),
    visualSetAnalyses: visualSetAnalysesForAssets(entry, ids, retainGroupHistory),
    facetAssignments: (entry.facetAssignments || []).filter(a => !a.visualId || ids.has(a.visualId)) };
  if (!ids.has(result.primaryMediaId)) result.primaryMediaId = result.mediaAssets.find(a => a.usage !== 'poster')?.id || '';
  if (result.coverVisualId && !ids.has(result.coverVisualId)) delete result.coverVisualId;
  if (entry.articleDocument) result.articleDocument = { ...entry.articleDocument,
    blocks: entry.articleDocument.blocks.filter(b => !b.assetId || ids.has(b.assetId)) };
  return result;
}
function appendMediaDocument(document, assets, sourceDocument) {
  const ids = new Set(assets.map(a => a.id));
  const originalBlocks = (sourceDocument?.blocks || []).filter(b => b.assetId && ids.has(b.assetId));
  const covered = new Set([...document.blocks, ...originalBlocks].map(b => b.assetId).filter(Boolean));
  const incoming = [...originalBlocks, ...assets.filter(a => a.usage !== 'poster' && !covered.has(a.id))
    .map(a => ({ id: `media:${a.id}`, kind: a.kind, assetId: a.id }))];
  const usedIds = new Set(document.blocks.map(b => b.id));
  const blocks = incoming.map(block => {
    const base = block.id, next = { ...block };
    let suffix = 2;
    while (usedIds.has(next.id)) next.id = `${base}:${suffix++}`;
    usedIds.add(next.id);
    return next;
  });
  return { ...document, blocks: [...document.blocks, ...blocks].map((b, sourceOrder) => ({ ...b, sourceOrder })) };
}
function existingCaseDocument(entry) {
  if (entry.articleDocument) return entry.articleDocument;
  const document = { version: 1, blocks: entry.text ? [{ id: `text:${entry.id}`, kind: 'paragraph', text: entry.text }] : [] };
  return appendMediaDocument(document, entry.mediaAssets || []);
}
function assertRemaining(entry) {
  if (!entry.text?.trim() && !entry.mediaAssets.some(a => a.usage !== 'poster')) fail('empty_source_case', '转移会留下空案例，请保留内容或另行处理原案例');
}

export async function planCaseOperation(state, operation, input, { now = new Date().toISOString(), idFactory = () => crypto.randomUUID() } = {}) {
  validateCaseOperation(operation, input);
  const compound = state.compoundCases?.find(item => item.id === input.caseId);
  if (operation === 'organize_case' && input.action === 'remove_tags') {
    const current = await operationCase(state, input.caseId);
    if (current.revision !== input.expectedRevision) fail('case_conflict', '案例已变化，请重新读取后修改');
    const result = removeCaseTags(state, [input.caseId], input, now);
    return { update: result.updatedCount ? { entries: result.state.entries, compoundCases: result.state.compoundCases } : {},
      caseIds: [input.caseId], tagUndo: result.updatedCount > 0, updatedCount: result.updatedCount };
  }
  if (compound) {
    if (await compoundRevision(state, compound) !== input.expectedRevision) fail('case_conflict', '组合或成员资料已变化，请重新读取后修改');
    if (operation === 'organize_case' && input.action === 'split_compound') {
      const result = splitCompoundCase(state.compoundCases, state.entries, compound.id);
      return { update: { compoundCases: result.compoundCases }, caseIds: result.memberEntryIds };
    }
    if (operation !== 'edit_case') fail('compound_member', '此操作请指定组合中的成员；拆开组合使用 split_compound');
    if (Object.keys(input.patch).some(key => !['title', 'customLabels', 'coverVisualId'].includes(key))) fail('compound_member', '组合仅修改名称、标签和封面；正文及媒体修改请指定成员');
    if (input.patch.coverVisualId) {
      const ids = new Set(compound.memberEntryIds);
      if (!state.entries.some(e => ids.has(e.id) && e.mediaAssets?.some(a => a.kind === 'image' && a.usage !== 'poster' && a.id === input.patch.coverVisualId))) fail('asset_not_in_case', '组合封面必须是成员中的内容图片');
    }
    const result = updateCompoundCase(state.compoundCases, state.entries, compound.id, { ...input.patch, updatedAt: now });
    return { update: { compoundCases: result.compoundCases }, caseIds: [compound.id] };
  }
  const current = await checkedEntry(state, input.caseId, input.expectedRevision);
  if (operation === 'edit_case') {
    assertSourceCorrection(current, input.patch, input.sourceCorrection);
    let next = editCaseEntry(current, input.patch, now);
    if (input.patch.creative) next.creative = { ...current.creative, ...input.patch.creative };
    if (input.patch.classificationPathIds) {
      if (!isValidContentPath(state.taxonomy, input.patch.classificationPathIds)) fail('invalid_classification', '分类编号不在当前词库中');
      next = confirmClassification(next, input.patch.classificationPathIds, state.taxonomy);
    }
    if (input.patch.mediaOrder) {
      const assets = next.mediaAssets || [], ids = input.patch.mediaOrder;
      if (ids.length !== assets.length || ids.some(id => !assets.some(asset => asset.id === id))) fail('invalid_media_order', '媒体排序必须包含当前案例所有媒体，且不能重复');
      const byId = new Map(assets.map(asset => [asset.id, asset])); next.mediaAssets = ids.map(id => byId.get(id));
    }
    if (input.sourceCorrection) next.sourceCorrections = [...(current.sourceCorrections || []), {
      reason: input.sourceCorrection.reason, fields: input.sourceCorrection.fields, correctedAt: now,
      before: Object.fromEntries(input.sourceCorrection.fields.map(field => [field,
        field === 'sourceUrl' ? current.url || '' : field === 'mediaSources' ? current.mediaAssets || [] : field === 'articlePatches' ? current.articleDocument || null : current[field] ?? null]))
    }];
    return { update: { entries: state.entries.map(e => e.id === current.id ? next : e) }, caseIds: [current.id] };
  }
  if (operation !== 'organize_case') fail('unknown_operation', '未知写入操作');
  if (organization(state, current.id).compounds.length) fail('compound_member', '请先处理组合关系，不能单独移动或拆分组合成员');
  if (input.action === 'combine_cases') {
    if (!input.title || !input.additionalCases?.length) fail('invalid_input', '请提供组合名称及其他已读取版本的案例');
    const ids = [current.id, ...input.additionalCases.map(item => item.caseId)];
    if (new Set(ids).size !== ids.length) fail('invalid_input', '组合成员不能重复');
    for (const item of input.additionalCases) {
      await checkedEntry(state, item.caseId, item.expectedRevision);
      if (organization(state, item.caseId).compounds.length) fail('compound_member', '成员已在另一个组合中，请先拆开原组合');
    }
    if (input.coverVisualId && !state.entries.some(e => ids.includes(e.id) && e.mediaAssets?.some(a => a.id === input.coverVisualId && a.kind === 'image' && a.usage !== 'poster'))) fail('asset_not_in_case', '组合封面必须是成员中的内容图片');
    const result = createCompoundCase(state.compoundCases, state.entries, {
      id: idFactory(), title: input.title, memberEntryIds: ids, coverVisualId: input.coverVisualId, now
    });
    return { update: { compoundCases: result.compoundCases }, caseIds: [result.compoundCase.id] };
  }
  if (input.action === 'split_compound') fail('invalid_input', '请指定要拆开的组合案例');
  if (['move_project', 'copy_project'].includes(input.action)) {
    if (!input.projectId || input.groups || input.assetIds || input.targetCaseId || input.targetRevision) fail('invalid_input', '项目整理只接受目标项目');
    if (input.action === 'copy_project') {
      const plan = planCaseCopies(state, [current.id], input.projectId, { idFactory });
      return { update: { entries: plan.state.entries, organizerState: plan.state.organizerState, compoundCases: plan.state.compoundCases }, caseIds: plan.copies.flatMap(c => c.entryIds) };
    }
    const organizerState = moveEntriesBetweenCollections(state.organizerState, null, input.projectId, [current.id]);
    return { update: { entries: state.entries.map(e => e.id === current.id ? { ...e, libraryUpdatedAt: now } : e), organizerState }, caseIds: [current.id] };
  }
  if (input.projectId) fail('invalid_input', '媒体整理沿用案例项目，不能同时移动项目');
  if (input.action === 'move_media') {
    if (!input.targetCaseId || !input.targetRevision || !input.assetIds || input.groups || input.targetCaseId === current.id) fail('invalid_input', '请指定不同的目标案例、目标版本和媒体');
    const target = await checkedEntry(state, input.targetCaseId, input.targetRevision);
    if (organization(state, target.id).compounds.length) fail('compound_member', '目标案例属于组合，请先处理组合关系');
    const ids = selectMedia(current, input.assetIds);
    if (target.mediaAssets?.some(a => ids.has(a.id))) fail('asset_conflict', '目标已有这些媒体，请先核对已有内容');
    const remaining = mediaSubset(current, retainedIds(current, ids), true);
    assertRemaining(remaining);
    const selected = mediaSubset(current, ids);
    for (const field of ['timeNotes', 'videoAnalyses', 'visualSetAnalyses']) {
      const existingIds = new Set((target[field] || []).map(item => item.id).filter(Boolean));
      if (selected[field].some(item => item.id && existingIds.has(item.id))) fail('annotation_conflict', '目标有相同编号的标注，请先核对，未转移媒体');
    }
    const updated = { ...target, mediaAssets: [...(target.mediaAssets || []), ...selected.mediaAssets],
      mediaPrompts: [...(target.mediaPrompts || []), ...selected.mediaPrompts], timeNotes: [...(target.timeNotes || []), ...selected.timeNotes],
      videoAnalyses: [...(target.videoAnalyses || []), ...selected.videoAnalyses],
      visualSetAnalyses: [...(target.visualSetAnalyses || []), ...selected.visualSetAnalyses],
      facetAssignments: [...(target.facetAssignments || []), ...selected.facetAssignments.filter(a => a.visualId)], libraryUpdatedAt: now };
    if (!updated.primaryMediaId) updated.primaryMediaId = selected.primaryMediaId;
    if (target.articleDocument || selected.articleDocument) updated.articleDocument = appendMediaDocument(
      existingCaseDocument(target), selected.mediaAssets, selected.articleDocument);
    return { update: { entries: state.entries.map(e => e.id === current.id ? { ...remaining, libraryUpdatedAt: now } : e.id === target.id ? updated : e) }, caseIds: [current.id, target.id] };
  }
  if (!input.groups || input.assetIds || input.targetCaseId || input.targetRevision) fail('invalid_input', '拆分请指定媒体分组');
  const removed = new Set(), textIds = new Set(), newEntries = [];
  for (const group of input.groups) {
    if (group.assetIds.some(id => removed.has(id))) fail('asset_conflict', '同一媒体不能拆到多个案例');
    const ids = selectMedia(current, group.assetIds);
    ids.forEach(id => removed.add(id));
    const selectedBlocks = (current.articleDocument?.blocks || []).filter(b => group.textBlockIds?.includes(b.id));
    if (selectedBlocks.length !== (group.textBlockIds || []).length || selectedBlocks.some(b => !ARTICLE_TEXT_KINDS.has(b.kind) || b.rows || textIds.has(b.id))) fail('invalid_input', '正文段落不存在、重复或包含表格；请先逐段核对');
    selectedBlocks.forEach(b => textIds.add(b.id));
    if (selectedBlocks.length && articleDocumentText({ blocks: selectedBlocks }) !== group.text) fail('text_conflict', '移动段落的正文必须与原文一致');
    const selected = mediaSubset(current, ids);
    const id = idFactory();
    if (state.entries.some(e => e.id === id) || newEntries.some(e => e.id === id)) fail('case_conflict', '新案例编号冲突');
    const fresh = sourceChanges({ id, caseInstanceId: `case-instance:${id}`, title: group.title.trim(), text: group.text, textRevision: 1,
      savedAt: current.savedAt, libraryAddedAt: now, libraryUpdatedAt: now, schemaVersion: current.schemaVersion,
      mediaAssets: selected.mediaAssets, primaryMediaId: selected.primaryMediaId, mediaPrompts: selected.mediaPrompts,
      timeNotes: selected.timeNotes, videoAnalyses: selected.videoAnalyses,
      customLabels: [], facetAssignments: selected.facetAssignments.filter(a => a.visualId), analysisCandidates: [], analysisBreakdown: [], visualSetAnalyses: selected.visualSetAnalyses,
      sourcePages: group.sourceUrl ? [{ url: httpUrl(group.sourceUrl), title: group.title.trim() }] : [] }, group);
    const document = { version: 1, blocks: selectedBlocks.length
      ? current.articleDocument.blocks.filter(b => group.textBlockIds.includes(b.id) || ids.has(b.assetId))
      : group.text ? [{ id: `text:${id}`, kind: 'paragraph', text: group.text }] : [] };
    fresh.articleDocument = appendMediaDocument(document, fresh.mediaAssets, selectedBlocks.length ? null : selected.articleDocument);
    newEntries.push(fresh);
  }
  let remaining = mediaSubset(current, retainedIds(current, removed), true);
  if (textIds.size) {
    remaining.articleDocument = { ...remaining.articleDocument, blocks: remaining.articleDocument.blocks.filter(b => !textIds.has(b.id)) };
    remaining = markEntryTextChanged(remaining, articleDocumentText(remaining.articleDocument));
  }
  assertRemaining(remaining);
  const organizerState = structuredClone(state.organizerState || { collections: [] });
  for (const collection of organizerState.collections) {
    const index = collection.entryIds.indexOf(current.id);
    if (index >= 0) collection.entryIds.splice(index + 1, 0, ...newEntries.map(e => e.id));
  }
  return { update: { entries: [...state.entries.map(e => e.id === current.id ? { ...remaining, libraryUpdatedAt: now } : e), ...newEntries], organizerState }, caseIds: [current.id, ...newEntries.map(e => e.id)] };
}

export function createCaseOperations({ loadState, loadReadState = loadState, storage, commit, enqueue }) {
  return {
    read: input => enqueue(async () => {
      validateCaseOperation('read_case_details', input);
      const state = await loadReadState();
      const compound = state.compoundCases?.find(c => c.id === input.caseId);
      const entry = compound || entryFor(state, input.caseId);
      const memberships = compound ? null : organization(state, entry.id);
      const revision = compound ? await compoundRevision(state, compound) : await caseRevision(state, entry, memberships);
      if (input.expectedRevision && revision !== input.expectedRevision) fail('case_conflict', '案例已变化，请从第一页重新读取');
      const requested = input.parts || [input.part || 'overview'];
      const sections = compound ? { overview: () => ({ kind: 'compound', ...compound }) } : {
        overview: () => ({ id: entry.id, title: entry.title, textCharacters: (entry.text || '').length, textRevision: entry.textRevision || 1,
          primaryMediaId: entry.primaryMediaId, coverVisualId: entry.coverVisualId, mediaCount: (entry.mediaAssets || []).length, savedAt: entry.savedAt, libraryUpdatedAt: entry.libraryUpdatedAt }),
        source: () => ({ url: entry.url || '', sourceFacts: entry.sourceFacts || {}, sourcePages: entry.sourcePages || [], provenance: entry.agentProvenance || null, corrections: entry.sourceCorrections || [] }),
        creative: () => entry.creative || {}, media: () => entry.mediaAssets || [], document: () => ({ text: entry.text || '', articleDocument: entry.articleDocument || null }),
        annotations: () => ({ creative: entry.creative || {}, customLabels: entry.customLabels || [], classification: entry.classification, facetAssignments: entry.facetAssignments || [],
          mediaPrompts: entry.mediaPrompts || [], timeNotes: entry.timeNotes || [], videoAnalyses: entry.videoAnalyses || [], visualSetAnalyses: entry.visualSetAnalyses || [] }),
        organization: () => memberships, analysis_coverage: () => caseAnalysisCoverage(entry)
      };
      for (const part of requested) if (!Object.hasOwn(sections, part)) fail('compound_member', '请读取概览并指定组合中的成员');
      const value = input.parts ? Object.fromEntries(requested.map(part => [part, sections[part]()])) : sections[requested[0]]();
      const text = JSON.stringify(value), offset = input.offset || 0, length = input.length || 12000;
      return { ok: true, caseId: entry.id, revision, ...(input.parts ? { parts: requested } : { part: requested[0] }), content: text.slice(offset, offset + length), totalCharacters: text.length,
        nextOffset: offset + length < text.length ? offset + length : null, untrustedContent: true };
    }),
    execute: (operation, input) => enqueue(async () => {
      validateCaseOperation(operation, input);
      const key = `caseOperation:${input.requestId}`;
      const fingerprint = await hash({ operation, input });
      const receipt = (await storage.get(key))[key];
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail('request_conflict', '此请求编号已用于其他修改');
        return { ...receipt.result, replayed: true };
      }
      const state = await loadState();
      const plan = await planCaseOperation(state, operation, input);
      const after = { ...state, ...plan.update };
      const history = plan.tagUndo ? { facetUndo: appendFacetUndo((await storage.get('facetUndo')).facetUndo, state, after) } : {};
      const result = { ok: true, requestId: input.requestId, operation,
        ...(plan.updatedCount !== undefined ? { canUndoFacetUpdate: Boolean(history.facetUndo?.steps.length), updatedCount: plan.updatedCount } : {}),
        cases: await Promise.all(plan.caseIds.map(id => operationCase(after, id))) };
      // Commit metadata and acknowledgement together. No media bytes or backup copies.
      await commit({ ...plan.update, ...history, [key]: { fingerprint, result } });
      return result;
    })
  };
}
