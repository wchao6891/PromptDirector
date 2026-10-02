import { expandLogicalCaseIds } from './compound-cases.js';
import { uniqueNames } from './facets.js';

function selection(state, caseIds) {
  const ids = new Set(uniqueNames(caseIds));
  const available = new Set([...state.entries, ...(state.compoundCases ?? [])].map(item => item.id));
  if (!ids.size || [...ids].some(id => !available.has(id))) throw new Error('部分案例已不存在，请刷新后重新选择');
  const entryIds = new Set(expandLogicalCaseIds([...ids], state.compoundCases ?? []));
  return { ids, entryIds };
}

export function selectedCaseTags(state, caseIds) {
  if (!caseIds.length) return [];
  const { ids, entryIds } = selection(state, caseIds);
  const values = new Map();
  const nodes = new Map((state.facetCatalog?.nodes ?? []).map(node => [node.id, node]));
  const facets = new Map((state.facetCatalog?.facets ?? []).map(facet => [facet.id, facet.name]));
  const add = (kind, id, label) => values.set(JSON.stringify([kind, id]), { kind, id, label });
  for (const item of [...state.entries.filter(entry => entryIds.has(entry.id)),
    ...(state.compoundCases ?? []).filter(compound => ids.has(compound.id))]) {
    for (const label of item.customLabels ?? []) add('custom', label, label);
    for (const assignment of item.facetAssignments ?? []) {
      const node = nodes.get(assignment.nodeId);
      if (node) add('facet', node.id, `${node.name}${facets.get(node.facetId) ? ` · ${facets.get(node.facetId)}` : ''}`);
    }
  }
  return [...values.values()];
}

// Remove only selected relationships. Vocabulary, original analysis, media and
// other cases are unchanged, including deliberate copies in other projects.
export function removeCaseTags(state, caseIds, { customLabels = [], nodeIds = [] }, now = new Date().toISOString()) {
  const { ids, entryIds } = selection(state, caseIds);
  const labels = new Set(uniqueNames(customLabels)), nodes = new Set(uniqueNames(nodeIds));
  if (!labels.size && !nodes.size) throw new Error('请选择要移除的标签');
  const changed = new Set();
  const remove = (item, timestamp = 'libraryUpdatedAt') => {
    const customLabels = (item.customLabels ?? []).filter(label => !labels.has(label));
    const facetAssignments = (item.facetAssignments ?? []).filter(tag => !nodes.has(tag.nodeId));
    if (customLabels.length === (item.customLabels ?? []).length && facetAssignments.length === (item.facetAssignments ?? []).length) return item;
    changed.add(item.id);
    return { ...item, ...(item.customLabels ? { customLabels } : {}), ...(item.facetAssignments ? { facetAssignments } : {}), [timestamp]: now };
  };
  const entries = state.entries.map(entry => entryIds.has(entry.id) ? remove(entry) : entry);
  const compoundCases = (state.compoundCases ?? []).map(compound => ids.has(compound.id) ? remove(compound, 'updatedAt') : compound);
  const updatedCount = [...ids].filter(id => changed.has(id) || compoundCases.some(c => c.id === id && c.memberEntryIds.some(member => changed.has(member)))).length;
  return { state: { ...state, entries, compoundCases }, updatedCount };
}
