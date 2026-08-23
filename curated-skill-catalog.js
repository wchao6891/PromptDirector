import { parseSkillArchive } from "./creative-skill-package.js";
import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";
import { sha256Hex } from "./sync-crypto.js";

export const CURATED_SKILL_CATALOG_FORMAT = "prompt-director-curated-skills";
export const CURATED_SKILL_CATALOG_VERSION = 1;

const DOWNLOAD_HOSTS = new Set(["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
const REVIEW_STATUSES = new Set(["approved"]);

export function normalizeCuratedSkillCatalog(value) {
  if (value?.format !== CURATED_SKILL_CATALOG_FORMAT || value.version !== CURATED_SKILL_CATALOG_VERSION || !Array.isArray(value.skills)) {
    throw new Error("精选 Skill 目录格式无效");
  }
  const ids = new Set();
  const versions = new Set();
  const orders = new Set();
  const skills = value.skills.map(normalizeItem).map((item) => {
    const versionKey = `${item.skillId}@${item.version}`;
    if (ids.has(item.id) || versions.has(versionKey) || orders.has(item.order)) throw new Error("精选 Skill 目录包含重复条目");
    ids.add(item.id);
    versions.add(versionKey);
    orders.add(item.order);
    return item;
  }).toSorted((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  return {
    format: CURATED_SKILL_CATALOG_FORMAT,
    version: CURATED_SKILL_CATALOG_VERSION,
    updatedAt: validIso(value.updatedAt),
    skills
  };
}

export async function verifyCuratedSkillPackageBlob(blob, expectedSha256, expectedBytes = 0) {
  if (!(blob instanceof Blob) || blob.size < 22) throw new Error("精选 Skill 包为空或无效");
  if (blob.size > PORTABLE_LIBRARY_LIMITS.maxArchiveBytes) throw new Error("精选 Skill 包超过安全大小上限");
  if (Number(expectedBytes) > 0 && blob.size !== Number(expectedBytes)) throw new Error("精选 Skill 包大小与目录不一致");
  const expected = String(expectedSha256 ?? "").toLocaleLowerCase("en-US");
  if (!/^[a-f0-9]{64}$/.test(expected) || await sha256Hex(blob) !== expected) throw new Error("精选 Skill 包校验失败");
  return true;
}

export async function validateCuratedSkillPackage(itemValue, archive) {
  const item = normalizeItem(itemValue);
  const parsed = await parseSkillArchive(archive);
  if (parsed.name !== item.skillId) throw new Error("精选 Skill 包身份与目录不一致");
  for (const path of parsed.files.keys()) {
    const relative = parsed.root && path.startsWith(`${parsed.root}/`) ? path.slice(parsed.root.length + 1) : path;
    if (relative !== "SKILL.md" && !/^references\/[A-Za-z0-9._/-]+\.md$/i.test(relative)) {
      throw new Error(`精选 Skill 包包含不允许的文件：${relative}`);
    }
  }
  if (parsed.dependencies.length) throw new Error("精选 Skill 包不能依赖脚本、程序或外部工具");
  return parsed;
}

export function isTrustedCuratedSkillResponseUrl(value) {
  const url = safeHttpsUrl(value);
  return Boolean(url && DOWNLOAD_HOSTS.has(url.hostname));
}

function normalizeItem(value = {}) {
  const id = clean(value.id);
  const skillId = portableId(value.skillId);
  const version = clean(value.version);
  const title = clean(value.title);
  const callName = localCallName(value.callName);
  const authorId = portableId(value.authorId);
  const author = clean(value.author);
  const license = clean(value.license);
  const reviewStatus = clean(value.reviewStatus);
  const reviewedAt = validIso(value.reviewedAt);
  const summary = clean(value.summary);
  const downloadUrl = trustedUrl(value.downloadUrl);
  const sha256 = String(value.sha256 ?? "").toLocaleLowerCase("en-US");
  const archiveBytes = positiveInteger(value.archiveBytes);
  const order = positiveInteger(value.order);
  if (!id || !skillId || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(version) || !title || !callName || !authorId || !author || !license ||
      !REVIEW_STATUSES.has(reviewStatus) || !reviewedAt || !summary || !downloadUrl || !/^[a-f0-9]{64}$/.test(sha256) || !archiveBytes || !order) {
    throw new Error("精选 Skill 目录条目缺少必填字段或校验值");
  }
  return { id, skillId, version, title, callName, authorId, author, license, reviewStatus, reviewedAt, summary, downloadUrl, sha256, archiveBytes, order };
}

function trustedUrl(value) {
  const url = safeHttpsUrl(value);
  if (!url || !DOWNLOAD_HOSTS.has(url.hostname) || url.username || url.password || url.search || url.hash) return "";
  return url.href;
}

function safeHttpsUrl(value) {
  try { const url = new URL(String(value ?? "")); return url.protocol === "https:" ? url : null; }
  catch { return null; }
}

function portableId(value) {
  const text = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) && text.length <= 63 ? text : "";
}

function localCallName(value) {
  const raw = String(value ?? "");
  if (/[\u0000-\u001f\u007f/\\]/.test(raw)) return "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text && text.length <= 80 ? text : "";
}

function clean(value) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim(); }
function validIso(value) { const text = clean(value); return text && !Number.isNaN(Date.parse(text)) ? new Date(text).toISOString() : ""; }
function positiveInteger(value) { const number = Math.floor(Number(value) || 0); return number > 0 ? number : 0; }
