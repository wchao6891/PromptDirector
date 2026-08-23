import { currentCreativeSkillVersion } from "./creative-skills.js";
import { generatedSkillFiles } from "./creative-skill-package.js";
import { sha256Hex } from "./sync-crypto.js";
import { createZipBlob } from "./zip.js";

export const CURATED_SKILL_SUBMISSION_FORMAT = "prompt-director-curated-skill-submission";
export const CURATED_SKILL_SUBMISSION_VERSION = 1;

const PUBLIC_LICENSE = "CC BY 4.0";
const encoder = new TextEncoder();

export async function buildCuratedSkillSnapshot(skillValue, metadata = {}) {
  const skill = structuredClone(skillValue ?? {});
  const version = currentCreativeSkillVersion(skill);
  if (!version) throw new Error("没有可投稿的 Skill 当前版本");
  const manifest = normalizeSubmissionMetadata(metadata, skill);
  const files = generatedSkillFiles({
    portableId: manifest.skillId,
    description: skill.description,
    skillMarkdown: version.skillMarkdown,
    references: version.references,
    provenanceMarkdown: metadata.includeProvenance === true ? version.provenanceMarkdown : ""
  });
  const preview = [];
  const findings = [];
  for (const [path, blob] of files) {
    const text = await blob.text();
    preview.push({ path, text, byteSize: encoder.encode(text).byteLength });
    findings.push(...findPrivacyRisks(text, path));
  }
  const digestInput = preview.map((item) => `${item.path}\0${item.text}\0`).join("");
  const digest = await sha256Hex(digestInput);
  return {
    manifest: { ...manifest, digest, fileCount: files.size },
    files,
    preview,
    findings,
    digest
  };
}

export async function buildCuratedSkillSubmissionArchive(snapshotValue = {}) {
  const findings = Array.isArray(snapshotValue.findings) ? snapshotValue.findings : [];
  if (findings.length) throw new Error("投稿快照包含隐私风险，请修改 Skill 后重新预览");
  const files = snapshotValue.files instanceof Map ? snapshotValue.files : new Map();
  if (!files.size || !snapshotValue.manifest) throw new Error("投稿快照无效");
  const payload = await createZipBlob([...files].map(([name, data]) => ({ name, data })));
  const payloadSha256 = await sha256Hex(payload);
  const manifest = {
    ...snapshotValue.manifest,
    format: CURATED_SKILL_SUBMISSION_FORMAT,
    version: CURATED_SKILL_SUBMISSION_VERSION,
    payloadSha256,
    payloadBytes: payload.size
  };
  return createZipBlob([
    { name: "submission.json", data: new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }) },
    { name: "payload.zip", data: payload }
  ]);
}

export function findPrivacyRisks(textValue, path = "") {
  const text = String(textValue ?? "");
  const rules = [
    ["credential", /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{8,}["']?/giu, "可能包含密钥或口令"],
    ["credential", /\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/gu, "可能包含访问令牌"],
    ["local-path", /(?:\/Users\/[^\s/]+|[A-Za-z]:\\Users\\[^\s\\]+)/gu, "包含本机用户路径"],
    ["private-url", /https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(?=[:/\s]|$)/gu, "包含本机或内网地址"],
    ["personal-identifier", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "可能包含个人邮箱"]
  ];
  const findings = [];
  for (const [kind, pattern, message] of rules) {
    for (const match of text.matchAll(pattern)) findings.push({ kind, path, message, excerpt: match[0] });
  }
  return findings;
}

function normalizeSubmissionMetadata(value, skill) {
  const skillId = portableId(skill.portableId);
  const callName = clean(skill.callName);
  const author = clean(value.author);
  const summary = clean(value.summary);
  if (!skillId) throw new Error("当前 Skill 缺少稳定公开 ID");
  if (!callName) throw new Error("当前 Skill 缺少可读调用名");
  if (!author) throw new Error("请填写公开署名");
  if (!summary) throw new Error("请填写公开摘要");
  if (value.rightsConfirmed !== true) throw new Error("请确认允许其他用户在保留署名的前提下保存、使用和修改");
  return {
    skillId,
    callName,
    title: callName,
    author,
    license: PUBLIC_LICENSE,
    reviewStatus: "pending",
    summary,
    createdAt: new Date().toISOString()
  };
}

function portableId(value) {
  const text = String(value ?? "").trim().toLocaleLowerCase("en-US");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text) && text.length <= 63 ? text : "";
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
