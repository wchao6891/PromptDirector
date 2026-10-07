import { uniqueNames } from "./facets.js";

// A label edit made from an earlier view sends only what it added and removed. Applying that delta
// to the latest labels inside the write queue keeps a concurrent Agent or batch change. A plain
// customLabels list still replaces the labels for callers that read and send the whole list.
export function editedLabels(currentLabels, edit = {}) {
  if (!Array.isArray(edit.addLabels) && !Array.isArray(edit.removeLabels)) return uniqueNames(edit.customLabels);
  const removed = new Set(uniqueNames(edit.removeLabels));
  return uniqueNames([...(currentLabels ?? []).filter(label => !removed.has(label)), ...uniqueNames(edit.addLabels)]);
}
