export const CREATIVE_SKILLS_VERSION = 1;
export const CREATIVE_SKILL_VERSION_LIMIT = 10;

export function createCreativeSkillsState() {
  return { version: CREATIVE_SKILLS_VERSION, items: [] };
}

export function normalizeCreativeSkillsState(value = {}) {
  const seen = new Set();
  const items = [];
  for (const candidate of Array.isArray(value?.items) ? value.items : []) {
    const skill = normalizeCreativeSkill(candidate);
    if (!skill || seen.has(skill.id)) continue;
    seen.add(skill.id);
    items.push(skill);
  }
  return { version: CREATIVE_SKILLS_VERSION, items };
}

export function createCreativeSkill(stateValue, input = {}, options = {}) {
  const state = structuredClone(normalizeCreativeSkillsState(stateValue));
  const callName = cleanCallName(input.callName);
  assertUniqueCallName(state, callName);
  const now = cleanText(options.now) || new Date().toISOString();
  const id = cleanText(options.id) || `skill:${crypto.randomUUID()}`;
  const versionId = cleanText(options.versionId) || `skill-version:${crypto.randomUUID()}`;
  const portableId = uniquePortableId(state, cleanPortableId(input.portableId) || fallbackPortableId(callName, id));
  const version = normalizeCreativeSkillVersion({
    id: versionId,
    createdAt: now,
    reason: input.reason || "created",
    skillMarkdown: input.skillMarkdown,
    references: input.references,
    provenanceMarkdown: input.provenanceMarkdown,
    source: input.source || "generated"
  });
  if (!version) throw new Error("Skill 正文不能为空");
  const skill = {
    id,
    callName,
    portableId,
    description: cleanText(input.description),
    currentVersionId: version.id,
    versions: [version],
    packageFiles: normalizePackageFiles(input.packageFiles),
    ...(normalizeCuratedOrigin(input.curatedOrigin) ? { curatedOrigin: normalizeCuratedOrigin(input.curatedOrigin) } : {}),
    textModeConfirmed: input.textModeConfirmed === true,
    runtimeDependencies: normalizeStringList(input.runtimeDependencies),
    createdAt: now,
    updatedAt: now
  };
  state.items.push(skill);
  return { state, skill };
}

export function saveCreativeSkillVersion(stateValue, skillId, input = {}, options = {}) {
  const state = structuredClone(normalizeCreativeSkillsState(stateValue));
  const skill = requireCreativeSkill(state, skillId);
  const callName = cleanCallName(input.callName ?? skill.callName);
  assertUniqueCallName(state, callName, skill.id);
  const now = cleanText(options.now) || new Date().toISOString();
  const version = normalizeCreativeSkillVersion({
    id: cleanText(options.versionId) || `skill-version:${crypto.randomUUID()}`,
    createdAt: now,
    reason: input.reason || "improved",
    skillMarkdown: input.skillMarkdown,
    references: input.references,
    provenanceMarkdown: input.provenanceMarkdown,
    source: input.source || "generated"
  });
  if (!version) throw new Error("Skill 正文不能为空");
  skill.callName = callName;
  skill.description = cleanText(input.description ?? skill.description);
  skill.currentVersionId = version.id;
  skill.versions = [...skill.versions, version].slice(-CREATIVE_SKILL_VERSION_LIMIT);
  skill.updatedAt = now;
  return { state, skill, version };
}

export function restoreCreativeSkillVersion(stateValue, skillId, versionId, options = {}) {
  const state = structuredClone(normalizeCreativeSkillsState(stateValue));
  const skill = requireCreativeSkill(state, skillId);
  const source = skill.versions.find((item) => item.id === cleanText(versionId));
  if (!source) throw new Error("没有找到需要恢复的 Skill 版本");
  return saveCreativeSkillVersion(state, skill.id, {
    callName: skill.callName,
    description: skill.description,
    skillMarkdown: source.skillMarkdown,
    references: source.references,
    provenanceMarkdown: source.provenanceMarkdown,
    source: source.source,
    reason: "restored"
  }, options);
}

export function deleteCreativeSkill(stateValue, skillId) {
  const state = structuredClone(normalizeCreativeSkillsState(stateValue));
  const id = cleanText(skillId);
  const skill = state.items.find((item) => item.id === id);
  if (!skill) throw new Error("Skill 不存在");
  state.items = state.items.filter((item) => item.id !== id);
  return { state, skill };
}

export function currentCreativeSkillVersion(skillValue) {
  const skill = normalizeCreativeSkill(skillValue);
  if (!skill) return null;
  return skill.versions.find((item) => item.id === skill.currentVersionId) ?? skill.versions.at(-1) ?? null;
}

export function createAppliedSkillSnapshot(skillValue) {
  const skill = normalizeCreativeSkill(skillValue);
  const version = currentCreativeSkillVersion(skill);
  if (!skill || !version) throw new Error("Skill 当前版本无效");
  return {
    skillId: skill.id,
    versionId: version.id,
    callName: skill.callName,
    portableId: skill.portableId,
    description: skill.description,
    skillMarkdown: version.skillMarkdown,
    references: version.references.filter((item) => item.runtime === true),
    source: version.source,
    textMode: skill.textModeConfirmed === true
  };
}

export function normalizeAppliedSkillSnapshots(values = []) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const skillId = cleanText(value?.skillId);
    const versionId = cleanText(value?.versionId);
    const callName = cleanCallName(value?.callName, false);
    const portableId = cleanPortableId(value?.portableId);
    const skillMarkdown = normalizeMarkdown(value?.skillMarkdown);
    if (!skillId || !versionId || !callName || !portableId || !skillMarkdown || seen.has(skillId)) continue;
    seen.add(skillId);
    result.push({
      skillId,
      versionId,
      callName,
      portableId,
      description: cleanText(value?.description),
      skillMarkdown,
      references: normalizeReferences(value?.references).filter((item) => item.runtime === true),
      source: normalizeSource(value?.source),
      textMode: value?.textMode === true
    });
  }
  return result;
}

export function reorderAppliedSkills(values, skillId, direction) {
  const snapshots = normalizeAppliedSkillSnapshots(values);
  const index = snapshots.findIndex((item) => item.skillId === cleanText(skillId));
  const target = direction < 0 ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= snapshots.length) return snapshots;
  [snapshots[index], snapshots[target]] = [snapshots[target], snapshots[index]];
  return snapshots;
}

export function findCreativeSkillsBySlashQuery(stateValue, query) {
  const state = normalizeCreativeSkillsState(stateValue);
  const needle = canonicalCallName(query);
  return state.items
    .filter((item) => !needle || canonicalCallName(item.callName).includes(needle))
    .sort((left, right) => left.callName.localeCompare(right.callName));
}

export function skillPackageAssetIds(skillValue) {
  return normalizeCreativeSkill(skillValue)?.packageFiles.map((item) => item.assetId) ?? [];
}

export function mergeCreativeSkillsState(currentValue, importedValue, options = {}) {
  const state = structuredClone(normalizeCreativeSkillsState(currentValue));
  const imported = normalizeCreativeSkillsState(importedValue);
  const usedSkillIds = new Set(state.items.map((item) => item.id));
  const usedVersionIds = new Set(state.items.flatMap((item) => item.versions.map((version) => version.id)));
  const usedAssetIds = new Set(state.items.flatMap((item) => item.packageFiles.map((file) => file.assetId)));
  const skillIdMap = {};
  const packageAssetIdMap = { ...(options.packageAssetIdMap ?? {}) };
  let importedSkillCount = 0;
  let skippedSkillCount = 0;

  for (const source of imported.items) {
    if (usedSkillIds.has(source.id)) {
      skillIdMap[source.id] = source.id;
      skippedSkillCount += 1;
      continue;
    }
    const skill = structuredClone(source);
    const preferredSkillId = cleanText(options.skillIdMap?.[source.id]);
    skill.id = preferredSkillId && !usedSkillIds.has(preferredSkillId)
      ? preferredSkillId
      : source.id;
    if (usedSkillIds.has(skill.id)) skill.id = uniqueEntityId("skill", usedSkillIds);
    usedSkillIds.add(skill.id);
    skillIdMap[source.id] = skill.id;
    skill.callName = uniqueCallName(state, skill.callName);
    skill.portableId = uniquePortableId(state, skill.portableId);
    skill.versions = skill.versions.map((version) => {
      const next = { ...version };
      if (usedVersionIds.has(next.id)) next.id = uniqueEntityId("skill-version", usedVersionIds);
      usedVersionIds.add(next.id);
      return next;
    });
    const currentVersionIndex = source.versions.findIndex((version) => version.id === source.currentVersionId);
    skill.currentVersionId = skill.versions[Math.max(0, currentVersionIndex)]?.id ?? skill.versions.at(-1)?.id;
    skill.packageFiles = skill.packageFiles.map((file) => {
      const preferredAssetId = cleanText(options.packageAssetIdMap?.[file.assetId]);
      let assetId = preferredAssetId && !usedAssetIds.has(preferredAssetId) ? preferredAssetId : file.assetId;
      if (usedAssetIds.has(assetId)) assetId = uniqueEntityId("skill-file", usedAssetIds);
      usedAssetIds.add(assetId);
      packageAssetIdMap[file.assetId] = assetId;
      const { archivePath: _archivePath, syncObjectId: _syncObjectId, syncContentType: _syncContentType, ...rest } = file;
      return { ...rest, assetId };
    });
    state.items.push(skill);
    importedSkillCount += 1;
  }
  return { state, skillIdMap, packageAssetIdMap, importedSkillCount, skippedSkillCount };
}

function normalizeCreativeSkill(value) {
  const id = cleanText(value?.id);
  const callName = cleanCallName(value?.callName, false);
  const portableId = cleanPortableId(value?.portableId);
  if (!id || !callName || !portableId) return null;
  const versions = (Array.isArray(value?.versions) ? value.versions : [])
    .map(normalizeCreativeSkillVersion).filter(Boolean)
    .slice(-CREATIVE_SKILL_VERSION_LIMIT);
  if (!versions.length) return null;
  const currentVersionId = versions.some((item) => item.id === value?.currentVersionId)
    ? value.currentVersionId : versions.at(-1).id;
  return {
    id,
    callName,
    portableId,
    description: cleanText(value?.description),
    currentVersionId,
    versions,
    packageFiles: normalizePackageFiles(value?.packageFiles),
    ...(normalizeCuratedOrigin(value?.curatedOrigin) ? { curatedOrigin: normalizeCuratedOrigin(value.curatedOrigin) } : {}),
    textModeConfirmed: value?.textModeConfirmed === true,
    runtimeDependencies: normalizeStringList(value?.runtimeDependencies),
    createdAt: cleanText(value?.createdAt) || versions[0].createdAt,
    updatedAt: cleanText(value?.updatedAt) || versions.at(-1).createdAt
  };
}

function normalizeCreativeSkillVersion(value) {
  const id = cleanText(value?.id);
  const skillMarkdown = normalizeMarkdown(value?.skillMarkdown);
  if (!id || !skillMarkdown) return null;
  return {
    id,
    createdAt: cleanText(value?.createdAt) || new Date(0).toISOString(),
    reason: ["created", "improved", "repaired", "restored", "imported"].includes(value?.reason) ? value.reason : "improved",
    source: normalizeSource(value?.source),
    skillMarkdown,
    references: normalizeReferences(value?.references),
    provenanceMarkdown: normalizeMarkdown(value?.provenanceMarkdown)
  };
}

function normalizeReferences(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const path = normalizeReferencePath(value?.path);
    const markdown = normalizeMarkdown(value?.markdown);
    if (!path || !markdown || seen.has(path)) continue;
    seen.add(path);
    result.push({ path, markdown, runtime: value?.runtime === true });
  }
  return result;
}

function normalizePackageFiles(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const path = normalizePackagePath(value?.path);
    const assetId = cleanText(value?.assetId);
    const byteSize = Math.max(0, Number(value?.byteSize) || 0);
    if (!path || !assetId || seen.has(path)) continue;
    seen.add(path);
    const archivePath = normalizePackagePath(value?.archivePath);
    const syncObjectId = /^[a-f0-9]{64}$/.test(String(value?.syncObjectId ?? "")) ? String(value.syncObjectId) : "";
    result.push({
      path,
      assetId,
      byteSize,
      mimeType: cleanText(value?.mimeType) || "application/octet-stream",
      ...(archivePath ? { archivePath } : {}),
      ...(syncObjectId ? {
        syncObjectId,
        syncContentType: cleanText(value?.syncContentType) || cleanText(value?.mimeType) || "application/octet-stream"
      } : {})
    });
  }
  return result;
}

function normalizeCuratedOrigin(value) {
  const catalogId = cleanText(value?.catalogId);
  const skillId = cleanPortableId(value?.skillId);
  const version = cleanText(value?.version);
  const sha256 = String(value?.sha256 ?? "").toLocaleLowerCase("en-US");
  if (!catalogId || !skillId || !version || !/^[a-f0-9]{64}$/.test(sha256)) return null;
  return {
    catalogId,
    skillId,
    version,
    sha256,
    installedAt: validIso(value?.installedAt) || new Date(0).toISOString()
  };
}

function validIso(value) {
  const text = cleanText(value);
  return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : "";
}

function assertUniqueCallName(state, callName, exceptId = "") {
  if (state.items.some((item) => item.id !== exceptId && canonicalCallName(item.callName) === canonicalCallName(callName))) {
    throw new Error("这个 Skill 调用名已经存在");
  }
}

function requireCreativeSkill(state, skillId) {
  const skill = state.items.find((item) => item.id === cleanText(skillId));
  if (!skill) throw new Error("Skill 不存在");
  return skill;
}

function uniquePortableId(state, requested) {
  const used = new Set(state.items.map((item) => item.portableId));
  if (!used.has(requested)) return requested;
  let suffix = 2;
  while (used.has(`${requested}-${suffix}`)) suffix += 1;
  return `${requested}-${suffix}`;
}

function uniqueCallName(state, requested) {
  const used = new Set(state.items.map((item) => canonicalCallName(item.callName)));
  if (!used.has(canonicalCallName(requested))) return requested;
  let suffix = 2;
  while (used.has(canonicalCallName(`${requested} ${suffix}`))) suffix += 1;
  return `${requested} ${suffix}`;
}

function uniqueEntityId(prefix, used) {
  let id;
  do id = `${prefix}:${crypto.randomUUID()}`; while (used.has(id));
  return id;
}

function fallbackPortableId(callName, id) {
  const latin = String(callName).toLocaleLowerCase("en-US")
    .normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (latin) return latin;
  return `creative-skill-${stableHash(id).slice(0, 10)}`;
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cleanCallName(value, required = true) {
  const name = cleanText(value).replace(/^\/+/, "").slice(0, 80);
  if (required && !name) throw new Error("Skill 调用名不能为空");
  if (/[\/\\]/.test(name)) throw new Error("Skill 调用名不能包含斜杠");
  return name;
}

function canonicalCallName(value) {
  return cleanCallName(value, false).toLocaleLowerCase().replace(/\s+/g, "");
}

function cleanPortableId(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

function normalizeReferencePath(value) {
  const path = normalizePackagePath(value);
  return path?.startsWith("references/") && path.toLocaleLowerCase("en-US").endsWith(".md") ? path : "";
}

function normalizePackagePath(value) {
  const path = String(value ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return path;
}

function normalizeMarkdown(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function normalizeStringList(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))];
}

function normalizeSource(value) {
  return ["generated", "imported", "external"].includes(value) ? value : "generated";
}

function cleanText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
