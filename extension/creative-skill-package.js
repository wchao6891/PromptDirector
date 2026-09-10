import { PORTABLE_LIBRARY_LIMITS, portableLibraryLimits } from "./resource-limits.js";
import { createZipBlob, readZipBlob } from "./zip.js";

const encoder = new TextEncoder();
const markdownType = "text/markdown";

export function buildSkillMarkdown(input = {}) {
  const name = normalizePortableId(input.name);
  const description = cleanInline(input.description);
  const body = stripFrontmatter(input.body ?? input.skillMarkdown);
  if (!name) throw new Error("Skill 缺少有效的英文可移植 ID");
  if (!description) throw new Error("Skill 说明不能为空");
  if (!body) throw new Error("Skill 正文不能为空");
  return [
    "---",
    `name: ${yamlString(name)}`,
    `description: ${yamlString(description)}`,
    "---",
    "",
    body,
    ""
  ].join("\n");
}

export function parseSkillMarkdown(value) {
  const markdown = normalizeMarkdown(value);
  const match = markdown.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md 缺少 YAML frontmatter");
  const metadata = parseFrontmatter(match[1]);
  const name = normalizePortableId(metadata.name);
  const description = cleanInline(metadata.description);
  const body = normalizeMarkdown(match[2]);
  if (!name) throw new Error("SKILL.md 的 name 必须是英文小写字母、数字或连字符");
  if (!description) throw new Error("SKILL.md 缺少 description");
  if (!body) throw new Error("SKILL.md 正文不能为空");
  return { name, description, body, markdown, dependencies: detectSkillDependencies(body) };
}

export function buildProvenanceMarkdown(input = {}) {
  const locale = input.locale === "en" ? "en" : "zh-CN";
  const target = cleanInline(input.target);
  const contributions = (Array.isArray(input.contributions) ? input.contributions : [])
    .map((item) => normalizeMarkdown(item)).filter(Boolean);
  const heading = locale === "en" ? "# Provenance" : "# 来源证据";
  const targetHeading = locale === "en" ? "## Extraction goal" : "## 提炼目标";
  const sourceHeading = locale === "en" ? "## Anonymous source contributions" : "## 匿名来源贡献";
  const lines = [heading];
  if (target) lines.push("", targetHeading, "", target);
  if (contributions.length) {
    lines.push("", sourceHeading, "");
    contributions.forEach((item, index) => lines.push(`${index + 1}. ${item.replace(/\n+/g, " ")}`));
  }
  return `${lines.join("\n").trim()}\n`;
}

export function generatedSkillFiles(input = {}) {
  const skillMarkdown = buildSkillMarkdown({
    name: input.portableId,
    description: input.description,
    body: input.skillMarkdown
  });
  const files = new Map([["SKILL.md", new Blob([skillMarkdown], { type: markdownType })]]);
  const references = Array.isArray(input.references) ? input.references : [];
  for (const reference of references) {
    const path = normalizeReferencePath(reference?.path);
    const markdown = normalizeMarkdown(reference?.markdown);
    if (!path || !markdown || path === "references/provenance.md") continue;
    if (files.has(path)) throw new Error(`Skill 包含重复路径：${path}`);
    files.set(path, new Blob([`${markdown}\n`], { type: markdownType }));
  }
  const provenance = normalizeMarkdown(input.provenanceMarkdown);
  if (provenance) files.set("references/provenance.md", new Blob([`${provenance}\n`], { type: markdownType }));
  return files;
}

export async function exportGeneratedSkillPackage(input = {}) {
  const files = generatedSkillFiles(input);
  return createZipBlob([...files].map(([name, data]) => ({ name, data })));
}

export async function exportStoredSkillPackage(skillValue = {}, options = {}) {
  const packageFiles = Array.isArray(skillValue.packageFiles) ? skillValue.packageFiles : [];
  if (!packageFiles.length) {
    const versions = Array.isArray(skillValue.versions) ? skillValue.versions : [];
    const version = versions.find((item) => item.id === skillValue.currentVersionId) ?? versions.at(-1) ?? {};
    return exportGeneratedSkillPackage({
      portableId: skillValue.portableId,
      description: skillValue.description,
      skillMarkdown: version.skillMarkdown,
      references: version.references,
      provenanceMarkdown: version.provenanceMarkdown
    });
  }
  if (typeof options.readFile !== "function") throw new Error("Skill 导出缺少文件读取器");
  const files = [];
  for (const file of packageFiles) {
    const path = normalizePackagePath(file?.path);
    if (!path || path !== file?.path) throw new Error("Skill 包含不安全的文件路径");
    const blob = await options.readFile(file.assetId);
    if (!(blob instanceof Blob)) throw new Error(`Skill 包文件缺失：${path}`);
    if (Number(file.byteSize) > 0 && Number(file.byteSize) !== blob.size) {
      throw new Error(`Skill 包文件大小不一致：${path}`);
    }
    files.push({ name: path, data: blob });
  }
  return createZipBlob(files);
}

export async function parseSkillArchive(archive, limitsValue = {}) {
  const files = await readZipBlob(archive, skillPackageLimits(limitsValue));
  return parseSkillFiles(files, limitsValue);
}

export async function parseSkillFiles(filesValue, limitsValue = {}) {
  const limits = skillPackageLimits(limitsValue);
  const source = filesValue instanceof Map ? filesValue : new Map(filesValue ?? []);
  if (!source.size) throw new Error("Skill 包为空");
  if (source.size > limits.maxFileCount) throw new Error(`Skill 包文件数量超过 ${limits.maxFileCount} 个上限`);

  const normalized = new Map();
  let totalBytes = 0;
  for (const [rawPath, rawBlob] of source) {
    const path = normalizePackagePath(rawPath);
    if (!path || path !== String(rawPath).replace(/\\/g, "/")) throw new Error("Skill 包含不安全的文件路径");
    if (normalized.has(path)) throw new Error(`Skill 包含重复路径：${path}`);
    const blob = rawBlob instanceof Blob ? rawBlob : new Blob([rawBlob ?? ""]);
    if (blob.size > limits.maxFileBytes) throw new Error(`Skill 单个文件超过安全上限：${path}`);
    totalBytes += blob.size;
    if (totalBytes > limits.maxArchiveBytes) throw new Error("Skill 包解压内容超过安全上限");
    normalized.set(path, blob);
  }

  const root = skillRoot(normalized.keys());
  const skillPath = root ? `${root}/SKILL.md` : "SKILL.md";
  const skillBlob = normalized.get(skillPath);
  if (!skillBlob) throw new Error("Skill 包根目录缺少 SKILL.md");
  const parsed = parseSkillMarkdown(await readMarkdown(skillBlob, skillPath));
  const references = [];
  for (const [path, blob] of normalized) {
    const relativePath = root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    if (!normalizeReferencePath(relativePath)) continue;
    references.push({
      path: relativePath,
      markdown: await readMarkdown(blob, path),
      runtime: relativePath !== "references/provenance.md"
    });
  }
  references.sort((left, right) => left.path.localeCompare(right.path));
  return {
    ...parsed,
    root,
    references,
    files: normalized,
    dependencies: parsed.dependencies,
    requiresTextModeConfirmation: parsed.dependencies.length > 0
  };
}

export function detectSkillDependencies(markdown) {
  const text = normalizeMarkdown(markdown);
  const found = [];
  const rules = [
    ["scripts", /(?:^|[\s(`'"])(?:\.\/)?scripts\/[\w./-]+/imu],
    ["python", /(?:^|\n)\s*(?:python3?|pip3?)\s+[^\n]+/imu],
    ["shell", /(?:^|\n)\s*(?:bash|zsh|sh)\s+[^\n]+/imu],
    ["mcp", /\bMCP\b|Model Context Protocol/iu],
    ["external-tool", /(?:must|required to|必须|需要)(?:[^\n]{0,40})(?:execute|run|调用|执行)(?:[^\n]{0,40})(?:tool|command|script|程序|工具|脚本)/iu]
  ];
  for (const [name, pattern] of rules) if (pattern.test(text)) found.push(name);
  return found;
}

export function skillPackageLimits(value = {}) {
  const shared = portableLibraryLimits(value);
  return {
    maxArchiveBytes: shared.maxArchiveBytes,
    maxFileCount: shared.maxFileCount,
    maxFileBytes: shared.maxFileBytes || PORTABLE_LIBRARY_LIMITS.maxFileBytes
  };
}

function skillRoot(pathsValue) {
  const paths = [...pathsValue];
  const matches = paths.filter((path) => path === "SKILL.md" || path.endsWith("/SKILL.md"));
  if (matches.length !== 1) throw new Error(matches.length ? "Skill 包包含多个 SKILL.md" : "Skill 包缺少 SKILL.md");
  return matches[0] === "SKILL.md" ? "" : matches[0].slice(0, -"/SKILL.md".length);
}

async function readMarkdown(blob, path) {
  if (blob.size > PORTABLE_LIBRARY_LIMITS.maxFileBytes) throw new Error(`Markdown 文件过大：${path}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error(`Markdown 文件不是有效 UTF-8：${path}`); }
  if (encoder.encode(text).byteLength !== bytes.byteLength) throw new Error(`Markdown 文件编码无效：${path}`);
  return normalizeMarkdown(text);
}

function parseFrontmatter(value) {
  const result = {};
  const lines = String(value ?? "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!match) continue;
    const key = match[1];
    let raw = match[2] ?? "";
    if (raw === ">" || raw === "|" || raw === ">-" || raw === "|-") {
      const chunks = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) chunks.push(lines[++index].trim());
      raw = raw.startsWith(">") ? chunks.join(" ") : chunks.join("\n");
    }
    if (key === "name" || key === "description") result[key] = yamlScalar(raw);
  }
  return result;
}

function yamlScalar(value) {
  const text = String(value ?? "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.startsWith('"')) {
      try { return JSON.parse(text); } catch { return ""; }
    }
    return text.slice(1, -1).replace(/''/g, "'");
  }
  return text.replace(/\s+#.*$/, "").trim();
}

function yamlString(value) {
  return JSON.stringify(cleanInline(value));
}

function stripFrontmatter(value) {
  const markdown = normalizeMarkdown(value);
  const match = markdown.match(/^---\n[\s\S]*?\n---(?:\n|$)([\s\S]*)$/);
  return normalizeMarkdown(match ? match[1] : markdown);
}

function normalizePortableId(value) {
  const source = String(value ?? "").trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source) || source.length > 63) return "";
  return source;
}

function normalizeReferencePath(value) {
  const path = normalizePackagePath(value);
  return path.startsWith("references/") && path.toLocaleLowerCase("en-US").endsWith(".md") ? path : "";
}

function normalizePackagePath(value) {
  const path = String(value ?? "").replace(/\\/g, "/");
  if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return path;
}

function normalizeMarkdown(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function cleanInline(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}
