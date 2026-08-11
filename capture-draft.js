import { normalizeVisual } from "./visuals.js";
import { uniqueNames } from "./facets.js";

export const CAPTURE_DRAFT_VERSION = 2;

export function createCaptureDraft(value = {}) {
  const now = new Date().toISOString();
  const fragments = uniqueFragments(value.fragments);
  const visuals = uniqueDraftVisuals(value.visuals);
  const visualIds = new Set(visuals.map((item) => item.id));
  return {
    version: CAPTURE_DRAFT_VERSION,
    id: clean(value.id) || globalThis.crypto.randomUUID(),
    targetCaseId: clean(value.targetCaseId) || clean(value.targetEntryId),
    targetPartEntryId: clean(value.targetPartEntryId),
    title: clean(value.title),
    fragments,
    visuals,
    primaryVisualId: visualIds.has(clean(value.primaryVisualId)) ? clean(value.primaryVisualId) : visuals[0]?.id || "",
    primaryVisualExplicit: value.primaryVisualExplicit === true,
    contentTypeId: clean(value.contentTypeId),
    contentTypeExplicit: value.contentTypeExplicit === true,
    customLabels: uniqueNames(value.customLabels),
    customLabelsExplicit: value.customLabelsExplicit === true,
    createdAt: validIso(value.createdAt) || now,
    updatedAt: validIso(value.updatedAt) || now
  };
}

export function addDraftFragment(draftValue, fragmentValue = {}) {
  const draft = createCaptureDraft(draftValue);
  const fragment = normalizeFragment(fragmentValue);
  if (!fragment) throw new Error("没有检测到高亮文字");
  const duplicate = draft.fragments.some((item) =>
    fragment.textFingerprint && item.textFingerprint
      ? item.textFingerprint === fragment.textFingerprint && item.sourceKind === fragment.sourceKind
      : item.text === fragment.text && item.sourceUrl === fragment.sourceUrl
  );
  if (duplicate) return { draft, added: false };
  draft.fragments.push(fragment);
  if (!draft.title) draft.title = captureTitleForSource(fragment.sourceUrl, fragment.sourceTitle);
  touch(draft);
  return { draft, added: true };
}

export function updateDraftFragment(draftValue, fragmentId, text) {
  const draft = createCaptureDraft(draftValue);
  const fragment = draft.fragments.find((item) => item.id === clean(fragmentId));
  const content = normalizeText(text);
  if (!fragment) throw new Error("没有找到这段高亮文字");
  if (!content) throw new Error("高亮文字不能为空");
  fragment.text = content;
  touch(draft);
  return draft;
}

export function removeDraftFragment(draftValue, fragmentId) {
  const draft = createCaptureDraft(draftValue);
  draft.fragments = draft.fragments.filter((item) => item.id !== clean(fragmentId));
  touch(draft);
  return draft;
}

export function reorderDraftFragments(draftValue, fragmentIds = []) {
  const draft = createCaptureDraft(draftValue);
  draft.fragments = reorderByIds(draft.fragments, fragmentIds);
  touch(draft);
  return draft;
}

export function addDraftVisual(draftValue, visualValue) {
  const draft = createCaptureDraft(draftValue);
  const visual = normalizeVisual(visualValue);
  if (!visual) throw new Error("截图缺少有效编号");
  draft.visuals = [...draft.visuals.filter((item) => item.id !== visual.id), visual];
  if (!draft.primaryVisualId) draft.primaryVisualId = visual.id;
  if (!draft.title) draft.title = captureTitleForSource(visual.sourceUrl, visual.sourceTitle);
  touch(draft);
  return draft;
}

export function removeDraftVisual(draftValue, visualId) {
  const draft = createCaptureDraft(draftValue);
  const id = clean(visualId);
  draft.visuals = draft.visuals.filter((item) => item.id !== id);
  if (draft.primaryVisualId === id) draft.primaryVisualId = draft.visuals[0]?.id || "";
  touch(draft);
  return draft;
}

export function reorderDraftVisuals(draftValue, visualIds = []) {
  const draft = createCaptureDraft(draftValue);
  draft.visuals = reorderByIds(draft.visuals, visualIds);
  touch(draft);
  return draft;
}

export function setDraftPrimaryVisual(draftValue, visualId) {
  const draft = createCaptureDraft(draftValue);
  const id = clean(visualId);
  if (!draft.visuals.some((item) => item.id === id)) throw new Error("没有找到这张截图");
  draft.primaryVisualId = id;
  draft.primaryVisualExplicit = true;
  touch(draft);
  return draft;
}

export function draftText(draftValue) {
  return createCaptureDraft(draftValue).fragments.map((item) => item.text).join("\n\n");
}

export function captureTitleForSource(sourceUrlValue, sourceTitleValue) {
  const sourceTitle = clean(sourceTitleValue);
  try {
    const url = new URL(clean(sourceUrlValue));
    const hostname = url.hostname.toLocaleLowerCase("en-US").replace(/^www\./, "");
    if (!["x.com", "twitter.com"].includes(hostname)) return sourceTitle;
    const parts = url.pathname.split("/").filter(Boolean);
    const handle = parts[0] && parts[1] === "status" ? parts[0] : "";
    if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return "X";
    return `X · @${handle}`;
  } catch {
    return sourceTitle;
  }
}

export function draftSourcePages(draftValue) {
  const seen = new Set();
  return createCaptureDraft(draftValue).fragments.flatMap((item) => {
    if (!item.sourceUrl || seen.has(item.sourceUrl)) return [];
    seen.add(item.sourceUrl);
    return [{ url: item.sourceUrl, title: item.sourceTitle }];
  });
}

export function draftParts(draftValue) {
  const draft = createCaptureDraft(draftValue);
  const groups = new Map();
  const ordered = [
    ...draft.fragments.map((fragment, index) => ({ kind: "fragment", value: fragment, index, time: fragment.addedAt })),
    ...draft.visuals.map((visual, index) => ({ kind: "visual", value: visual, index, time: visual.capturedAt }))
  ].toSorted((left, right) => {
    const byTime = String(left.time || "").localeCompare(String(right.time || ""));
    return byTime || Number(left.kind === "visual") - Number(right.kind === "visual") || left.index - right.index;
  });
  for (const item of ordered) {
    const sourceUrl = safeHttpUrl(item.value.sourceUrl);
    const key = sourceUrl || "source:unknown";
    if (!groups.has(key)) {
      groups.set(key, {
        sourceUrl,
        sourceTitle: clean(item.value.sourceTitle),
        fragments: [],
        visuals: []
      });
    }
    const group = groups.get(key);
    if (!group.sourceTitle) group.sourceTitle = clean(item.value.sourceTitle);
    group[item.kind === "fragment" ? "fragments" : "visuals"].push(item.value);
  }
  return [...groups.values()].map((part) => ({
    ...part,
    text: part.fragments.map((fragment) => fragment.text).join("\n\n")
  }));
}

export function isMeaningfulCaptureDraft(draftValue) {
  const draft = createCaptureDraft(draftValue);
  return Boolean(draft.fragments.length || draft.visuals.length || draft.targetCaseId);
}

function normalizeFragment(value = {}) {
  const text = normalizeText(value.text);
  if (!text) return null;
  return {
    id: clean(value.id) || globalThis.crypto.randomUUID(),
    text,
    sourceUrl: safeHttpUrl(value.sourceUrl),
    sourceTitle: clean(value.sourceTitle),
    sourceKind: ["selection", "clipboard"].includes(value.sourceKind) ? value.sourceKind : "",
    textFingerprint: /^[a-f0-9]{64}$/.test(clean(value.textFingerprint)) ? clean(value.textFingerprint) : "",
    addedAt: validIso(value.addedAt) || new Date().toISOString()
  };
}

function uniqueFragments(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const fragment = normalizeFragment(value);
    const key = fragment ? `${fragment.sourceUrl}\n${fragment.text}` : "";
    if (!fragment || seen.has(key)) return [];
    seen.add(key);
    return [fragment];
  });
}

function uniqueDraftVisuals(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).flatMap((value) => {
    const visual = normalizeVisual(value);
    if (!visual || seen.has(visual.id)) return [];
    seen.add(visual.id);
    return [visual];
  });
}

function reorderByIds(items, ids) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = [];
  for (const id of (Array.isArray(ids) ? ids : []).map(clean)) {
    const item = byId.get(id);
    if (!item) continue;
    ordered.push(item);
    byId.delete(id);
  }
  return [...ordered, ...byId.values()];
}

function touch(draft) {
  draft.updatedAt = new Date().toISOString();
}

function normalizeText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).join("\n").trim();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(clean(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? text : "";
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
