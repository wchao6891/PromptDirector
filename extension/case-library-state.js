import { needsMigration } from './migration.js';
import { recoverFullyArchivedFacets } from './facets.js';
import { normalizeOrganizerState } from './organizer.js';
import { normalizeCompoundCases } from './compound-cases.js';

// Read current records on every call. Do not cache library truth or pull in
// sessions, credentials, recovery copies and task history just to find a case.
const keys = ['schemaVersion', 'entries', 'trashState', 'compoundCases',
  'taxonomy', 'facetCatalog', 'classificationRules', 'organizerState'];

export function createCaseLibraryReader({ storage, readFullState }) {
  return async () => {
    let state = await storage.get(keys);
    if (needsMigration(state) || recoverFullyArchivedFacets(state.facetCatalog).restoredFacetIds.length) {
      // Legacy repair owns its backups and writes; never migrate a partial
      // snapshot, which could omit settings or recovery material.
      state = await readFullState();
    }
    return {
      entries: state.entries,
      facetCatalog: state.facetCatalog,
      organizerState: normalizeOrganizerState(state.organizerState, state.entries.map(entry => entry.id)),
      compoundCases: normalizeCompoundCases(state.compoundCases, state.entries)
    };
  };
}
