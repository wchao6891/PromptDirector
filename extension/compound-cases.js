import { uniqueNames } from "./facets.js";
import { normalizeEntryVisuals, primaryVisual } from "./visuals.js";
import { entryMediaAssets, primaryMediaAsset } from "./media.js";

export const COMPOUND_CASES_VERSION = 1;

export function normalizeCompoundCases(values = [], entries = []) {
  const entryIds = new Set((Array.isArray(entries) ? entries : []).map((entry) => clean(entry?.id)).filter(Boolean));
  const claimed = new Set();
  const ids = new Set(entryIds);
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = clean(value?.id);
    const memberEntryIds = uniqueIds(value?.memberEntryIds).filter((entryId) => entryIds.has(entryId) && !claimed.has(entryId));
    if (!id || ids.has(id) || memberEntryIds.length < 2) continue;
    const memberSet = new Set(memberEntryIds);
    const coverVisualId = clean(value.coverVisualId);
    const validCover = (Array.isArray(entries) ? entries : []).some((entry) =>
      memberSet.has(entry.id) && normalizeEntryVisuals(entry).visuals.some((visual) => visual.id === coverVisualId)
    );
    const createdAt = validIso(value.createdAt) || new Date().toISOString();
    result.push({
      id,
      title: clean(value.title) || "未命名组合案例",
      memberEntryIds,
      coverVisualId: validCover ? coverVisualId : firstVisualId(memberEntryIds, entries),
      customLabels: uniqueNames(value.customLabels),
      createdAt,
      updatedAt: validIso(value.updatedAt) || createdAt
    });
    ids.add(id);
    memberEntryIds.forEach((entryId) => claimed.add(entryId));
  }
  return result;
}

export function createCompoundCase(values, entries = [], options = {}) {
  const existing = normalizeCompoundCases(values, entries);
  const members = uniqueIds(options.memberEntryIds);
  if (members.length < 2) throw new Error("至少选择两个案例才能组合");
  const byId = new Map((Array.isArray(entries) ? entries : []).map((entry) => [entry.id, entry]));
  if (members.some((id) => !byId.has(id))) throw new Error("组合中包含不存在的案例");
  const owned = new Set(existing.flatMap((item) => item.memberEntryIds));
  if (members.some((id) => owned.has(id))) throw new Error("已有组合中的案例不能重复加入另一个组合");
  const now = validIso(options.now) || new Date().toISOString();
  const compound = {
    id: clean(options.id) || globalThis.crypto.randomUUID(),
    title: clean(options.title) || clean(byId.get(members[0])?.title) || "未命名组合案例",
    memberEntryIds: members,
    coverVisualId: clean(options.coverVisualId),
    customLabels: uniqueNames(options.customLabels),
    createdAt: now,
    updatedAt: now
  };
  const normalized = normalizeCompoundCases([...existing, compound], entries);
  const created = normalized.find((item) => item.id === compound.id);
  if (!created) throw new Error("组合案例编号无效或与现有内容冲突");
  return { compoundCases: normalized, compoundCase: created };
}

export function updateCompoundCase(values, entries = [], compoundId, changes = {}) {
  const current = normalizeCompoundCases(values, entries);
  const target = current.find((item) => item.id === clean(compoundId));
  if (!target) throw new Error("组合案例不存在");
  const memberEntryIds = changes.memberEntryIds === undefined ? target.memberEntryIds : uniqueIds(changes.memberEntryIds);
  if (memberEntryIds.length < 2) {
    return { compoundCases: current.filter((item) => item.id !== target.id), compoundCase: null, split: true };
  }
  const next = current.map((item) => item.id === target.id ? {
    ...target,
    title: changes.title === undefined ? target.title : clean(changes.title) || target.title,
    memberEntryIds,
    coverVisualId: changes.coverVisualId === undefined ? target.coverVisualId : clean(changes.coverVisualId),
    customLabels: changes.customLabels === undefined ? target.customLabels : uniqueNames(changes.customLabels),
    updatedAt: validIso(changes.updatedAt) || new Date().toISOString()
  } : item);
  const normalized = normalizeCompoundCases(next, entries);
  const updated = normalized.find((item) => item.id === target.id);
  if (!updated) throw new Error("组合内容与其他组合发生冲突");
  return { compoundCases: normalized, compoundCase: updated, split: false };
}

export function splitCompoundCase(values, entries = [], compoundId) {
  const current = normalizeCompoundCases(values, entries);
  const target = current.find((item) => item.id === clean(compoundId));
  if (!target) throw new Error("组合案例不存在");
  return {
    compoundCases: current.filter((item) => item.id !== target.id),
    memberEntryIds: [...target.memberEntryIds]
  };
}

export function materializeLogicalCases(entries = [], compoundValues = []) {
  const normalizedEntries = (Array.isArray(entries) ? entries : []).map((entry) =>
    Array.isArray(entry?.mediaAssets) ? entry : normalizeEntryVisuals(entry)
  );
  const byId = new Map(normalizedEntries.map((entry) => [entry.id, entry]));
  const compounds = normalizeCompoundCases(compoundValues, normalizedEntries);
  const memberIds = new Set(compounds.flatMap((item) => item.memberEntryIds));
  const logical = compounds.map((compound) => {
    const members = compound.memberEntryIds.map((id) => byId.get(id)).filter(Boolean);
    const visuals = members.flatMap((entry) => entryMediaAssets(entry)
      .filter((asset) => asset.kind === "image" && asset.usage !== "poster"));
    const primaryVisualId = visuals.some((visual) => visual.id === compound.coverVisualId)
      ? compound.coverVisualId
      : primaryVisual(members.find((entry) => entryMediaAssets(entry).some((asset) => asset.kind === "image" && asset.usage !== "poster")) ?? {})?.id || "";
    const mediaAssets = members.flatMap(entryMediaAssets);
    const primaryMediaId = mediaAssets.some((asset) => asset.id === compound.coverVisualId)
      ? compound.coverVisualId
      : primaryMediaAsset(members.find((entry) => entry.mediaAssets?.length) ?? {})?.id || "";
    return normalizeEntryVisuals({
      id: compound.id,
      title: compound.title,
      text: members.map((entry) => entry.text).filter(Boolean).join("\n\n"),
      url: members.find((entry) => entry.url)?.url || "",
      sourcePages: members.flatMap((entry) => entry.sourcePages ?? []),
      savedAt: members.map((entry) => entry.savedAt).filter(Boolean).sort().at(-1) || compound.createdAt,
      schemaVersion: Math.max(...members.map((entry) => Number(entry.schemaVersion) || 0), 0),
      classification: members[0]?.classification,
      contentTypeIds: [...new Set(members.map((entry) => entry.classification?.pathIds?.[0]).filter(Boolean))],
      facetAssignments: members.flatMap((entry) => entry.facetAssignments ?? []),
      analysisCandidates: members.flatMap((entry) => entry.analysisCandidates ?? []),
      analysisBreakdown: members.flatMap((entry) => entry.analysisBreakdown ?? []),
      customLabels: uniqueNames([...compound.customLabels, ...members.flatMap((entry) => entry.customLabels ?? [])]),
      metadataLabels: uniqueNames(members.flatMap((entry) => entry.metadataLabels ?? [])),
      negativeTerms: uniqueNames(members.flatMap((entry) => entry.negativeTerms ?? [])),
      legacyFacetCandidates: uniqueNames(members.flatMap((entry) => entry.legacyFacetCandidates ?? [])),
      visuals,
      primaryVisualId,
      mediaAssets,
      primaryMediaId,
      timeNotes: members.flatMap((entry) => entry.timeNotes ?? []),
      compoundCase: compound,
      memberEntries: members,
      memberEntryIds: [...compound.memberEntryIds]
    });
  });
  return [...normalizedEntries.filter((entry) => !memberIds.has(entry.id)), ...logical];
}

export function expandLogicalCaseIds(caseIds = [], compoundValues = []) {
  const compoundById = new Map((Array.isArray(compoundValues) ? compoundValues : []).map((item) => [clean(item?.id), item]));
  return uniqueIds((Array.isArray(caseIds) ? caseIds : []).flatMap((id) => {
    const cleanId = clean(id);
    return compoundById.get(cleanId)?.memberEntryIds ?? [cleanId];
  }));
}

export function compoundForEntry(compoundValues = [], entryId) {
  const id = clean(entryId);
  return (Array.isArray(compoundValues) ? compoundValues : []).find((item) => item?.memberEntryIds?.includes(id)) ?? null;
}

export function removeEntriesFromCompoundCases(compoundValues = [], entries = [], entryIds = []) {
  const removed = new Set(uniqueIds(entryIds));
  const nextEntries = (Array.isArray(entries) ? entries : []).filter((entry) => !removed.has(entry.id));
  const next = (Array.isArray(compoundValues) ? compoundValues : []).flatMap((item) => {
    const memberEntryIds = (item.memberEntryIds ?? []).filter((id) => !removed.has(id));
    return memberEntryIds.length >= 2 ? [{ ...item, memberEntryIds, updatedAt: new Date().toISOString() }] : [];
  });
  return normalizeCompoundCases(next, nextEntries);
}

function firstVisualId(memberEntryIds, entries) {
  const ids = new Set(memberEntryIds);
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!ids.has(entry.id)) continue;
    const visual = primaryVisual(normalizeEntryVisuals(entry));
    if (visual) return visual.id;
  }
  return "";
}

function uniqueIds(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
