// Match the same folder paths as organizer import, without folding independent
// copies in different folders (or different compound members) into one case.
export function libraryCaseScopes(state = {}) {
  const collections = state.organizerState?.collections ?? [];
  const byId = new Map(collections.map(collection => [collection.id, collection]));
  const paths = new Map();
  function pathFor(collection, visiting = new Set()) {
    if (paths.has(collection.id)) return paths.get(collection.id);
    if (visiting.has(collection.id)) return ["invalid-cycle", collection.id];
    visiting.add(collection.id);
    const parent = byId.get(collection.parentId);
    const name = String(collection.name ?? "").trim().toLocaleLowerCase().replace(/[\s._-]+/g, "");
    const path = [...(parent ? pathFor(parent, visiting) : []), name || ["unnamed", collection.id]];
    visiting.delete(collection.id);
    paths.set(collection.id, path);
    return path;
  }
  const memberships = new Map();
  for (const collection of collections) {
    const path = JSON.stringify(pathFor(collection));
    for (const id of collection.entryIds ?? []) {
      if (!memberships.has(id)) memberships.set(id, new Set());
      memberships.get(id).add(path);
    }
  }
  const compounds = new Map();
  for (const compound of state.compoundCases ?? []) {
    for (const [index, id] of (compound.memberEntryIds ?? []).entries()) {
      compounds.set(id, [compound.id, index]);
    }
  }
  return new Map((state.entries ?? []).map(entry => [entry.id, JSON.stringify([
    [...(memberships.get(entry.id) ?? [])].sort(),
    compounds.get(entry.id) ?? null
  ])]));
}
