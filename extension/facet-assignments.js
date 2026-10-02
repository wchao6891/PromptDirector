// The same vocabulary node can belong to a case and to several different media.
export function facetAssignmentIdentity(value = {}) {
  const nodeId = String(value.nodeId ?? '').trim();
  return nodeId ? JSON.stringify([nodeId, String(value.visualId ?? '').trim()]) : '';
}

export function libraryFacetAssignments(state = {}) {
  const containers = [...(state.entries ?? []), ...(state.trashState?.items ?? []).flatMap(item =>
    item.kind === 'entry' ? [item.snapshot] : item.kind === 'media' ? [item.snapshot, item.relationships] : [])];
  return containers.flatMap(value => value?.facetAssignments ?? []);
}
