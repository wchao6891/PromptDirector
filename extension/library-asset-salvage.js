import { removeEntryMedia } from "./media.js";

const AI_ASSIGNMENT_SOURCES = new Set(["deepseek_text", "local_image_review", "vision_model"]);

export function salvageMissingLibraryAssets(stateValue = {}, missingAssetIdsValue = []) {
  const state = stateValue && typeof stateValue === "object" ? structuredClone(stateValue) : {};
  const missing = new Set([...(missingAssetIdsValue instanceof Set
    ? missingAssetIdsValue
    : Array.isArray(missingAssetIdsValue) ? missingAssetIdsValue : [])].map(clean).filter(Boolean));
  const issues = new Map([...missing].map((assetId) => [assetId, { assetId }]));
  if (!missing.size) return { state, issues: [] };

  const annotate = (assetIdValue, owner) => {
    const assetId = clean(assetIdValue);
    if (!missing.has(assetId)) return;
    const current = issues.get(assetId) ?? { assetId };
    if (!current.ownerType) issues.set(assetId, { ...current, ...owner });
  };

  state.entries = (Array.isArray(state.entries) ? state.entries : []).flatMap((entry) => {
    const result = salvageEntry(entry, missing, (assetId, asset) => annotate(assetId, {
      ownerType: "case",
      ownerId: clean(entry?.id),
      ownerTitle: clean(entry?.title),
      sourceTitle: clean(asset?.sourceTitle)
    }));
    return hasRecoverableCaseContent(result) ? [result] : [];
  });
  const activeEntryIds = new Set(state.entries.map((entry) => clean(entry?.id)).filter(Boolean));

  if (state.organizerState && typeof state.organizerState === "object") {
    state.organizerState.collections = (Array.isArray(state.organizerState.collections)
      ? state.organizerState.collections
      : []).map((collection) => ({
        ...collection,
        entryIds: uniqueIds(collection?.entryIds).filter((entryId) => activeEntryIds.has(entryId))
      }));
  }
  state.compoundCases = (Array.isArray(state.compoundCases) ? state.compoundCases : []).flatMap((compound) => {
    const memberEntryIds = uniqueIds(compound?.memberEntryIds).filter((entryId) => activeEntryIds.has(entryId));
    if (memberEntryIds.length < 2) return [];
    return [{
      ...compound,
      memberEntryIds,
      coverVisualId: missing.has(clean(compound?.coverVisualId)) ? "" : clean(compound?.coverVisualId)
    }];
  });

  if (state.trashState && typeof state.trashState === "object") {
    state.trashState.items = (Array.isArray(state.trashState.items) ? state.trashState.items : []).flatMap((item) => {
      if (!item || !["entry", "media"].includes(item.kind)) return [item];
      const assets = Array.isArray(item?.snapshot?.mediaAssets) ? item.snapshot.mediaAssets : [];
      for (const asset of assets) annotate(asset?.id, {
        ownerType: "trash",
        ownerId: clean(item?.targetId),
        ownerTitle: clean(item?.snapshot?.title || item?.snapshot?.sourceTitle),
        sourceTitle: clean(asset?.sourceTitle)
      });
      if (item.kind === "entry") {
        const snapshot = salvageEntry(item.snapshot, missing);
        return hasRecoverableCaseContent(snapshot) ? [{ ...item, snapshot }] : [];
      }
      const mediaAssets = assets.filter((asset) => !missing.has(clean(asset?.id)));
      if (!mediaAssets.some((asset) => clean(asset?.id) === clean(item.targetId))) return [];
      const retained = new Set(mediaAssets.map((asset) => clean(asset?.id)).filter(Boolean));
      return [{
        ...item,
        snapshot: {
          ...item.snapshot,
          mediaAssets,
          facetAssignments: salvageFacetAssignments(item.snapshot?.facetAssignments, missing)
        },
        relationships: {
          ...(item.relationships ?? {}),
          positions: (Array.isArray(item.relationships?.positions) ? item.relationships.positions : [])
            .filter((position) => retained.has(clean(position?.id))),
          primaryMediaId: retained.has(clean(item.relationships?.primaryMediaId))
            ? item.relationships.primaryMediaId
            : "",
          facetAssignments: salvageFacetAssignments(item.relationships?.facetAssignments, missing)
        }
      }];
    });
  }

  state.creativeRuns = (Array.isArray(state.creativeRuns) ? state.creativeRuns : []).map((run) => {
    const outputs = (Array.isArray(run?.outputs) ? run.outputs : []).filter((output) => {
      const assetId = clean(output?.visual?.id);
      annotate(assetId, {
        ownerType: "creative_run",
        ownerId: clean(run?.id),
        ownerTitle: clean(run?.title),
        sourceTitle: clean(output?.visual?.sourceTitle)
      });
      return !missing.has(assetId);
    });
    const retained = new Set(outputs.map((output) => clean(output?.visual?.id)).filter(Boolean));
    return {
      ...run,
      outputs,
      events: (Array.isArray(run?.events) ? run.events : []).filter((event) => retained.has(clean(event?.visualId)))
    };
  });

  if (state.creativeSkills && typeof state.creativeSkills === "object") {
    state.creativeSkills.items = (Array.isArray(state.creativeSkills.items) ? state.creativeSkills.items : []).map((skill) => ({
      ...skill,
      packageFiles: (Array.isArray(skill?.packageFiles) ? skill.packageFiles : []).filter((file) => {
        const assetId = clean(file?.assetId);
        annotate(assetId, {
          ownerType: "creative_skill",
          ownerId: clean(skill?.id),
          ownerTitle: clean(skill?.name || skill?.callName),
          sourceTitle: clean(file?.path)
        });
        return !missing.has(assetId);
      })
    }));
  }

  state.composerSessions = (Array.isArray(state.composerSessions) ? state.composerSessions : []).map((session) => ({
    ...session,
    referenceSnapshots: (Array.isArray(session?.referenceSnapshots) ? session.referenceSnapshots : []).flatMap((reference) => {
      if (reference?.sourceType !== "temporary") return [reference];
      for (const asset of Array.isArray(reference?.assetRefs) ? reference.assetRefs : []) annotate(asset?.assetId, {
        ownerType: "composer_session",
        ownerId: clean(session?.id),
        ownerTitle: clean(session?.title),
        sourceTitle: clean(asset?.name)
      });
      const next = {
        ...reference,
        assetId: missing.has(clean(reference?.assetId)) ? "" : clean(reference?.assetId),
        assetRefs: (Array.isArray(reference?.assetRefs) ? reference.assetRefs : [])
          .filter((asset) => !missing.has(clean(asset?.assetId))),
        imageRefs: (Array.isArray(reference?.imageRefs) ? reference.imageRefs : [])
          .filter((asset) => !missing.has(clean(asset?.visualId))),
        assets: (Array.isArray(reference?.assets) ? reference.assets : [])
          .filter((asset) => !missing.has(clean(asset?.assetId)))
      };
      return clean(next.referenceText) || next.assetRefs.length || next.imageRefs.length ? [next] : [];
    })
  }));

  return { state, issues: [...issues.values()].sort((left, right) => compareIds(left.assetId, right.assetId)) };
}

function salvageEntry(entryValue, missing, onMissing = () => undefined) {
  let entry = entryValue && typeof entryValue === "object" ? structuredClone(entryValue) : {};
  const assets = Array.isArray(entry.mediaAssets) ? entry.mediaAssets : Array.isArray(entry.visuals) ? entry.visuals : [];
  for (const asset of assets) {
    if (!missing.has(clean(asset?.id))) continue;
    onMissing(clean(asset.id), asset);
    entry = removeEntryMedia(entry, asset.id);
  }
  entry.facetAssignments = salvageFacetAssignments(entry.facetAssignments, missing);
  return entry;
}

function salvageFacetAssignments(values, missing) {
  return (Array.isArray(values) ? values : []).flatMap((assignment) => {
    if (!missing.has(clean(assignment?.visualId))) return [assignment];
    if (AI_ASSIGNMENT_SOURCES.has(assignment?.source)) return [];
    const { visualId: _visualId, ...rest } = assignment;
    return [rest];
  });
}

function hasRecoverableCaseContent(entry = {}) {
  if ([entry.title, entry.text, entry.note, entry.url].some((value) => clean(value))) return true;
  if ((entry.mediaAssets ?? []).some((asset) => asset && typeof asset === "object")) return true;
  return (entry.articleDocument?.blocks ?? []).some((block) => clean(block?.text) || clean(block?.assetId));
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean))];
}

function compareIds(leftValue, rightValue) {
  const left = clean(leftValue);
  const right = clean(rightValue);
  return left < right ? -1 : left > right ? 1 : 0;
}

function clean(value) {
  return String(value ?? "").trim();
}
