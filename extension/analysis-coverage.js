// An inventory of saved evidence, not a claim that every pixel or second was observed.
export function caseAnalysisCoverage(entry) {
  const assets = (entry.mediaAssets ?? []).filter(asset => ['image', 'video'].includes(asset.kind) && asset.usage !== 'poster');
  const record = (analysis, kind, assetId) => {
    const evidence = analysis.inputEvidence ?? null;
    const input = Array.isArray(evidence?.assets) ? evidence.assets.find(asset => asset?.assetId === assetId) : undefined;
    return {
      kind, id: analysis.id ?? null,
      state: analysis.invalidated ? 'invalidated' : analysis.quality === 'partial' ? 'partial' : 'recorded',
      coverage: input?.coverage ?? null, sha256: input?.sha256 ?? analysis.imageFingerprint ?? null,
      verification: input ? 'verified_at_save' : 'not_recorded',
      analysisScope: analysis.analysisScope ?? null, inputEvidence: evidence
    };
  };
  const media = assets.map(asset => {
    const analyses = [
      ...(asset.visionAnalysis ? [record(asset.visionAnalysis, 'image', asset.id)] : []),
      ...(entry.videoAnalyses ?? []).filter(analysis => analysis.assetId === asset.id).map(analysis => record(analysis, 'video', asset.id))
    ];
    return { assetId: asset.id, kind: asset.kind, state: analyses.length ? 'recorded' : 'unrecorded', analyses };
  });
  const ids = new Set(assets.map(asset => asset.id));
  return {
    totalMedia: media.length, mediaWithAnalysis: media.filter(item => item.analyses.length).length,
    mediaWithRecordedScope: media.filter(item => item.analyses.some(analysis => analysis.coverage !== null)).length,
    media,
    visualSets: (entry.visualSetAnalyses ?? []).map(analysis => ({
      id: analysis.id, state: analysis.invalidated ? 'invalidated' : 'recorded',
      assetIds: analysis.imageRoles?.map(role => role.assetId) ?? null,
      missingAssetIds: (analysis.imageRoles ?? []).map(role => role.assetId).filter(id => !ids.has(id)),
      inputEvidence: analysis.inputEvidence ?? null
    })),
    currentBytesVerified: false
  };
}
