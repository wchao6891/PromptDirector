export function libraryStoredAssets(stateValue = {}, options = {}) {
  const state = stateValue && typeof stateValue === "object" ? stateValue : {};
  const assets = durableAssets(state);
  if (options.includeLocalOnly === true) assets.push(...localOnlyAssets(state));
  return assets.filter((asset) => storedAssetId(asset));
}

export function libraryStoredAssetIds(stateValue = {}, options = {}) {
  return new Set(libraryStoredAssets(stateValue, options).map(storedAssetId));
}

export function libraryLocalOnlyAssets(stateValue = {}) {
  const state = stateValue && typeof stateValue === "object" ? stateValue : {};
  return localOnlyAssets(state).filter((asset) => storedAssetId(asset));
}

export function libraryLocalOnlyAssetIds(stateValue = {}) {
  return new Set(libraryLocalOnlyAssets(stateValue).map(storedAssetId));
}

export function libraryAssetCleanupCandidates(beforeState = {}, afterState = {}, options = {}) {
  const retained = new Set([
    ...libraryStoredAssetIds(afterState),
    ...libraryLocalOnlyAssetIds(options.localOnlyState ?? afterState)
  ]);
  return [...new Set([
    ...libraryStoredAssetIds(beforeState),
    ...(Array.isArray(options.pendingAssetIds) ? options.pendingAssetIds.map(clean) : [])
  ].filter(Boolean))].filter((assetId) => !retained.has(assetId)).sort();
}

function durableAssets(state) {
  return [
    ...entryAssets(state.entries),
    ...trashAssets(state.trashState?.items),
    ...creativeRunAssets(state.creativeRuns),
    ...creativeSkillAssets(state.creativeSkills?.items),
    ...temporarySessionAssets(state.composerSessions)
  ];
}

function localOnlyAssets(state) {
  const recoveryPoint = state.libraryReplacementRecoveryPoint;
  return [
    ...creativeJobAssets(state.creativeJobs?.items),
    ...importStagingAssets(state.importStaging?.assets),
    ...(recoveryPoint?.state && typeof recoveryPoint.state === "object"
      ? durableAssets(recoveryPoint.state)
      : []),
    ...(Array.isArray(recoveryPoint?.retainedAssetIds)
      ? recoveryPoint.retainedAssetIds.map((id) => ({ id }))
      : [])
  ];
}

function entryAssets(entries) {
  return (Array.isArray(entries) ? entries : []).flatMap((entry) =>
    Array.isArray(entry?.mediaAssets)
      ? entry.mediaAssets
      : Array.isArray(entry?.visuals) ? entry.visuals : []
  );
}

function trashAssets(items) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const snapshot = item.snapshot;
    if (!snapshot || typeof snapshot !== "object") return [];
    if (Array.isArray(snapshot.mediaAssets)) return snapshot.mediaAssets;
    return Array.isArray(snapshot.visuals) ? snapshot.visuals : [];
  });
}

function creativeRunAssets(runs) {
  return (Array.isArray(runs) ? runs : []).flatMap((run) =>
    (Array.isArray(run?.outputs) ? run.outputs : []).map((output) => output?.visual)
  );
}

function creativeSkillAssets(skills) {
  return (Array.isArray(skills) ? skills : []).flatMap((skill) =>
    Array.isArray(skill?.packageFiles) ? skill.packageFiles : []
  );
}

function temporarySessionAssets(sessions) {
  return (Array.isArray(sessions) ? sessions : []).flatMap((session) =>
    (Array.isArray(session?.referenceSnapshots) ? session.referenceSnapshots : [])
      .filter((reference) => reference?.sourceType === "temporary")
      .flatMap((reference) => Array.isArray(reference?.assetRefs) ? reference.assetRefs : [])
  );
}

function creativeJobAssets(jobs) {
  return (Array.isArray(jobs) ? jobs : []).flatMap((job) =>
    temporarySessionAssets([job?.request?.session])
  );
}

function importStagingAssets(items) {
  return (Array.isArray(items) ? items : []).flatMap((item) => [
    clean(item?.assetId) ? { id: clean(item.assetId) } : null,
    item?.posterAsset && typeof item.posterAsset === "object"
      ? item.posterAsset
      : clean(item?.posterAssetId) ? { id: clean(item.posterAssetId) } : null
  ]);
}

export function storedAssetId(asset) {
  return clean(asset?.id ?? asset?.assetId);
}

function clean(value) {
  return String(value ?? "").trim();
}
