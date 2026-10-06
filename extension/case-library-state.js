import { needsMigration } from './migration.js';
import { recoverFullyArchivedFacets } from './facets.js';
import { normalizeOrganizerState } from './organizer.js';
import { normalizeCompoundCases } from './compound-cases.js';
import { CASE_LIBRARY_KEYS, CASE_LIBRARY_REVISION_KEY } from './library-storage.js';
import { jsonBytes, startPhase } from './perf-trace.js';

// Check current records on every call without pulling in sessions, credentials, recovery copies
// and task history just to find a case. The previous snapshot is reused only when the revision
// written together with every case library change is still the same, so a reader never sees stale
// records; it is frozen because several callers share it.
export function createCaseLibraryReader({ storage, readFullState }) {
  let reusable = null;
  return async () => {
    const done = startPhase("background", "readCaseLibrary");
    const current = (await storage.get([CASE_LIBRARY_REVISION_KEY]))[CASE_LIBRARY_REVISION_KEY];
    if (current && reusable?.revision === current) {
      done();
      return reusable.state;
    }
    let state = await storage.get([...CASE_LIBRARY_KEYS, CASE_LIBRARY_REVISION_KEY]);
    let revision = state[CASE_LIBRARY_REVISION_KEY];
    if (needsMigration(state) || recoverFullyArchivedFacets(state.facetCatalog).restoredFacetIds.length) {
      // Legacy repair owns its backups and writes; never migrate a partial
      // snapshot, which could omit settings or recovery material.
      state = await readFullState();
      revision = null;
    }
    const result = deepFreeze({
      entries: state.entries,
      facetCatalog: state.facetCatalog,
      taxonomy: state.taxonomy,
      organizerState: normalizeOrganizerState(state.organizerState, state.entries.map(entry => entry.id)),
      compoundCases: normalizeCompoundCases(state.compoundCases, state.entries)
    });
    reusable = revision ? { revision, state: result } : null;
    done({ bytes: () => jsonBytes(state.entries ?? []) });
    return result;
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
