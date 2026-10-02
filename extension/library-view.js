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

const CASE_SORT_VALUES = new Set([
  ...Object.values(CASE_SORT_MODES), "added-asc", "updated-asc", "title-desc",
  ...["type", "count", "tags", "source", "size"].flatMap(key => [`${key}-asc`, `${key}-desc`])
]);
export function normalizeCaseSortMode(value) { return CASE_SORT_VALUES.has(value) ? value : "added-desc"; }
export function caseSortColumn(mode) { return mode === "title" ? "title" : mode === "project-manual" ? "" : mode.replace(/-(asc|desc)$/, ""); }
export function nextCaseSortMode(current, column) {
  const descending = caseSortColumn(current) === column ? !current.endsWith("-desc") : ["added", "updated"].includes(column);
  return column === "title" && !descending ? "title" : `${column}-${descending ? "desc" : "asc"}`;
}
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
  const mode = normalizeCaseSortMode(options.mode);
  const column = caseSortColumn(mode);
  const direction = mode.endsWith("-desc") ? -1 : 1;
  const manualRank = projectManualRank(options.projectEntryIds);
  const sortValues = new Map(entries.map(entry => {
    if (column === "title") return [entry, entry?.title];
    if (!["added", "updated", ""].includes(column)) return [entry, options.columnValues?.(entry)?.[column]];
    const projection = caseViewProjection(entry);
    return [entry, mode === CASE_SORT_MODES.projectManual ? rankProjection(projection, manualRank)
      : timestamp(column === "updated" ? projection.updatedAt : projection.addedAt)];
  }));
  return stableSort(entries, (left, right) => {
    const a = sortValues.get(left), b = sortValues.get(right);
    if (mode === CASE_SORT_MODES.projectManual) return a - b;
    const missing = value => value == null || value === "" || (typeof value === "number" && !Number.isFinite(value));
    if (missing(a) || missing(b)) return Number(missing(a)) - Number(missing(b));
    return (typeof a === "number" && typeof b === "number" ? a - b : compareNames(a, b)) * direction;
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
  return compareTimes(timestamp(left), timestamp(right), direction);
}

function compareTimes(leftTime, rightTime, direction) {
  if (leftTime === rightTime) return 0;
  if (!Number.isFinite(leftTime)) return 1;
  if (!Number.isFinite(rightTime)) return -1;
  return (leftTime - rightTime) * direction;
}

function compareNames(left, right) {
  return clean(left).localeCompare(clean(right), undefined, { numeric: true, sensitivity: "base" });
}

function latestIso(values) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const value of Array.isArray(values) ? values : []) {
    const time = Date.parse(clean(value));
    if (Number.isFinite(time) && time > latest) latest = time;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : "";
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
