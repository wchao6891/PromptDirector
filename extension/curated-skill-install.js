import { normalizeCreativeSkillsState } from "./creative-skills.js";

export function planCuratedSkillInstall(stateValue, itemValue) {
  const items = Array.isArray(stateValue?.items) ? stateValue.items : [];
  const skillId = clean(itemValue?.skillId);
  const version = clean(itemValue?.version);
  const matches = items.filter((skill) => clean(skill?.curatedOrigin?.skillId) === skillId);
  const same = matches.find((skill) => skill.curatedOrigin?.version === version);
  if (same) return { action: "already-installed", skill: same };
  if (matches.length) return { action: "install-update-copy", previous: matches.at(-1) };
  return { action: "install-new" };
}

export async function installCuratedSkillTransaction(options = {}) {
  const plan = planCuratedSkillInstall(options.state, options.item);
  if (plan.action === "already-installed") return { status: "already-installed", skill: plan.skill };
  if (!(options.parsed?.files instanceof Map) || typeof options.saveBlob !== "function" || typeof options.deleteBlobs !== "function" || typeof options.createSkill !== "function") {
    throw new Error("精选 Skill 保存事务缺少必要接口");
  }
  const existingNames = new Set(normalizeCreativeSkillsState(options.state).items.map((skill) => canonical(skill.callName)));
  const baseCallName = clean(options.item?.callName || options.parsed.name || options.item?.skillId);
  const callName = uniqueCallName(existingNames, baseCallName);
  const savedIds = [];
  const packageFiles = [];
  try {
    for (const [path, blob] of options.parsed.files) {
      const assetId = typeof options.assetIdFactory === "function" ? options.assetIdFactory(path) : `skill-file:${crypto.randomUUID()}`;
      await options.saveBlob(assetId, blob);
      savedIds.push(assetId);
      packageFiles.push({ path, assetId, byteSize: blob.size, mimeType: blob.type || "application/octet-stream" });
    }
    const result = await options.createSkill({
      callName,
      portableId: options.parsed.name,
      description: options.parsed.description,
      skillMarkdown: options.parsed.body,
      references: options.parsed.references,
      provenanceMarkdown: "",
      source: "imported",
      reason: "imported",
      packageFiles,
      runtimeDependencies: [],
      textModeConfirmed: false,
      curatedOrigin: {
        catalogId: clean(options.item?.id),
        skillId: clean(options.item?.skillId),
        version: clean(options.item?.version),
        sha256: String(options.item?.sha256 ?? "").toLocaleLowerCase("en-US"),
        installedAt: new Date().toISOString()
      }
    });
    return { status: plan.action, result, packageFiles };
  } catch (error) {
    if (savedIds.length) {
      try { await options.deleteBlobs(savedIds); }
      catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "精选 Skill 保存失败，且临时文件回滚未完成");
      }
    }
    throw error;
  }
}

function uniqueCallName(used, requested) {
  const base = requested || "curated-skill";
  if (!used.has(canonical(base))) return base;
  let suffix = 2;
  let candidate;
  do {
    const ending = ` ${suffix}`;
    candidate = `${base.slice(0, 80 - ending.length).trimEnd()}${ending}`;
    suffix += 1;
  } while (used.has(canonical(candidate)));
  return candidate;
}

function canonical(value) { return clean(value).toLocaleLowerCase().replace(/\s+/g, ""); }
function clean(value) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }
