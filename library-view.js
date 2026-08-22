export const CASE_SORT_MODES = Object.freeze({
  addedDesc: "added-desc",
  updatedDesc: "updated-desc",
  title: "title",
  projectManual: "project-manual"
});

export const PROJECT_SORT_MODES = Object.freeze({
  manual: "manual",
  recent: "recent",
  name: "name"
});

const CASE_SORT_VALUES = new Set(Object.values(CASE_SORT_MODES));
const PROJECT_SORT_VALUES = new Set(Object.values(PROJECT_SORT_MODES));

/**
 * Projects the dates and physical membership of one gallery item without
 * mutating or backfilling stored cases. Historical cases only fall back to
 * their saved time while the view is being calculated.
 */
export function caseViewProjection(entry = {}) {
  const members = logicalMembers(entry);
  const compound = entry?.compoundCase && typeof entry.compoundCase === "object"
    ? entry.compoundCase
    : null;
  const memberEntryIds = logicalMemberIds(entry, members);
  const importBatchIds = uniqueStrings([
    entry?.importBatchId,
    ...members.map((member) => member?.importBatchId)
  ]);
  const memberAddedAt = members.map(memberAddedTime).filter(Boolean);
  const addedAt = latestIso([
    ...memberAddedAt,
    compound?.createdAt,
    !compound ? entry?.libraryAddedAt : "",
    !compound ? entry?.savedAt : ""
  ]);
  const updatedAt = latestIso([
    ...members.map(memberUpdatedTime),
    libraryUpdatedTime(compound),
    libraryUpdatedTime(entry)
  ]);

  return {
    memberEntryIds,
    importBatchIds,
    addedAt,
    updatedAt
  };
}

export function sortLibraryCases(entriesValue = [], options = {}) {
  const entries = Array.isArray(entriesValue) ? entriesValue : [];
  const mode = CASE_SORT_VALUES.has(options.mode) ? options.mode : CASE_SORT_MODES.addedDesc;
  const manualRank = projectManualRank(options.projectEntryIds);
  const projections = new Map(entries.map((entry) => [entry, caseViewProjection(entry)]));
  return stableSort(entries, (left, right) => {
    if (mode === CASE_SORT_MODES.title) return compareNames(left?.title, right?.title);
    if (mode === CASE_SORT_MODES.projectManual) {
      return rankProjection(projections.get(left), manualRank) - rankProjection(projections.get(right), manualRank);
    }
    const leftProjection = projections.get(left);
    const rightProjection = projections.get(right);
    if (mode === CASE_SORT_MODES.updatedDesc) {
      return compareIsoDescending(leftProjection.updatedAt, rightProjection.updatedAt);
    }
    return compareIsoDescending(leftProjection.addedAt, rightProjection.addedAt);
  });
}

export function sortProjects(collectionsValue = [], modeValue = PROJECT_SORT_MODES.manual) {
  const collections = Array.isArray(collectionsValue) ? collectionsValue : [];
  const mode = PROJECT_SORT_VALUES.has(modeValue) ? modeValue : PROJECT_SORT_MODES.manual;
  return stableSort(collections, (left, right) => {
    if (mode === PROJECT_SORT_MODES.name) return compareNames(left?.name, right?.name);
    if (mode === PROJECT_SORT_MODES.recent) {
      return compareIsoDescending(validIso(left?.createdAt), validIso(right?.createdAt));
    }
    return finiteOrder(left?.order) - finiteOrder(right?.order);
  });
}

export function moveProjectLogicalCase(entryIdsValue = [], currentEntry, adjacentEntry, direction) {
  const entryIds = (Array.isArray(entryIdsValue) ? entryIdsValue : []).map(clean).filter(Boolean);
  if (!["up", "down"].includes(direction)) return [...entryIds];
  const currentIds = new Set(caseViewProjection(currentEntry).memberEntryIds);
  const adjacentIds = new Set(caseViewProjection(adjacentEntry).memberEntryIds);
  const moving = entryIds.filter((id) => currentIds.has(id));
  if (!moving.length) return [...entryIds];
  const remaining = entryIds.filter((id) => !currentIds.has(id));
  const adjacentIndexes = remaining
    .map((id, index) => adjacentIds.has(id) ? index : -1)
    .filter((index) => index >= 0);
  if (!adjacentIndexes.length) return [...entryIds];
  const insertAt = direction === "up"
    ? Math.min(...adjacentIndexes)
    : Math.max(...adjacentIndexes) + 1;
  return [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)];
}

function logicalMembers(entry) {
  if (Array.isArray(entry?.memberEntries) && entry.memberEntries.length) return entry.memberEntries;
  return entry && typeof entry === "object" ? [entry] : [];
}

function logicalMemberIds(entry, members) {
  const declared = uniqueStrings(entry?.memberEntryIds);
  if (declared.length) return declared;
  const memberIds = uniqueStrings(members.map((member) => member?.id));
  return memberIds.length ? memberIds : uniqueStrings([entry?.id]);
}

function memberAddedTime(member) {
  return validIso(member?.libraryAddedAt) || validIso(member?.savedAt);
}

function memberUpdatedTime(member) {
  return libraryUpdatedTime(member) || validIso(member?.savedAt);
}

function libraryUpdatedTime(value) {
  return validIso(value?.libraryUpdatedAt) || validIso(value?.updatedAt);
}

function projectManualRank(entryIdsValue) {
  const result = new Map();
  uniqueStrings(entryIdsValue).forEach((id, index) => result.set(id, index));
  return result;
}

function rankProjection(projection, rank) {
  const positions = (projection?.memberEntryIds ?? [])
    .map((id) => rank.get(id))
    .filter(Number.isFinite);
  return positions.length ? Math.min(...positions) : Number.POSITIVE_INFINITY;
}

function stableSort(values, compare) {
  return values
    .map((value, index) => ({ value, index }))
    .sort((left, right) => compare(left.value, right.value) || left.index - right.index)
    .map(({ value }) => value);
}

function compareIsoDescending(left, right) {
  return compareDates(left, right, -1);
}

function compareDates(left, right, direction) {
  const leftTime = timestamp(left);
  const rightTime = timestamp(right);
  if (leftTime === rightTime) return 0;
  if (!Number.isFinite(leftTime)) return 1;
  if (!Number.isFinite(rightTime)) return -1;
  return (leftTime - rightTime) * direction;
}

function compareNames(left, right) {
  return clean(left).localeCompare(clean(right), undefined, { numeric: true, sensitivity: "base" });
}

function latestIso(values) {
  const valid = (Array.isArray(values) ? values : [])
    .map(validIso)
    .filter(Boolean);
  return valid.sort((left, right) => timestamp(right) - timestamp(left))[0] || "";
}

function validIso(value) {
  const text = clean(value);
  return text && Number.isFinite(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function timestamp(value) {
  const text = validIso(value);
  return text ? Date.parse(text) : Number.NaN;
}

function finiteOrder(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
