import { assetFormatForExtension, assetFormatForFile } from "./asset-formats.js";

// A portable package resource: no browser-local IDs or executable instructions.
export const SKILL_COVER_BASENAME = "assets/cover";

export function skillPackageRoot(files = []) {
  const main = files.find(file => file.path === "SKILL.md" || file.path.endsWith("/SKILL.md"));
  return main ? main.path.slice(0, -"SKILL.md".length) : "";
}

export function isSkillCoverPath(path, root = "") {
  if (!String(path).startsWith(`${root}${SKILL_COVER_BASENAME}.`)) return false;
  const extension = String(path).slice(`${root}${SKILL_COVER_BASENAME}.`.length);
  return !extension.includes("/") && assetFormatForExtension(extension)?.kind === "image";
}

export function skillCoverFile(skill = {}) {
  const files = skill.packageFiles ?? [];
  const root = skillPackageRoot(files);
  const covers = files.filter(file => isSkillCoverPath(file.path, root));
  if (covers.length > 1) throw new Error("每个 Skill 只能包含一张封面");
  return covers[0] ?? null;
}

export async function validateSkillCover(blob, name = "", options = {}) {
  if (!(blob instanceof Blob) || !blob.size) throw new Error("封面图片缺失或为空");
  if (blob.size > (options.maxBytes ?? Number.MAX_SAFE_INTEGER)) throw new Error("封面图片超过 Skill 包文件大小限制");
  const format = assetFormatForFile({ name, type: blob.type });
  if (format?.kind !== "image") throw new Error("请选择支持的成果图片");
  const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
  const valid = {
    png: bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && ascii(12, 16) === "IHDR",
    jpeg: bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    gif: ["GIF87a", "GIF89a"].includes(ascii(0, 6)),
    webp: ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP",
    avif: ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 32))
  };
  if (!valid[format.id]) throw new Error("封面图片内容与格式不符");
  const typed = blob.slice(0, blob.size, format.mimeTypes[0]);
  if (typeof options.decode === "function") await options.decode(typed);
  return { blob: typed, path: `${SKILL_COVER_BASENAME}.${format.extensions[0]}`, mimeType: format.mimeTypes[0] };
}

export async function readSkillCover(skill, readFile) {
  const file = skillCoverFile(skill);
  if (!file) return null;
  if (typeof readFile !== "function") throw new Error("封面缺少文件读取器");
  const blob = await readFile(file.assetId);
  if (!(blob instanceof Blob) || blob.size !== file.byteSize) throw new Error("封面图片缺失或大小不一致");
  return { ...await validateSkillCover(blob, file.path), file };
}

export function normalizeSkillCoverMetadata(value) {
  if (value === undefined || value === null) return null;
  const path = String(value.path ?? "");
  const match = path.match(/^skill-previews\/[a-z0-9-]+\/[a-zA-Z0-9.-]+\/cover\.([a-z0-9]+)$/);
  const sha256 = String(value.sha256 ?? "");
  const byteSize = Number(value.byteSize);
  if (!match || path.split("/").some(part => part === "." || part === "..") ||
      assetFormatForExtension(match[1])?.kind !== "image" || !/^[a-f0-9]{64}$/.test(sha256) ||
      !Number.isSafeInteger(byteSize) || byteSize <= 0) throw new Error("精选 Skill 封面清单无效");
  return { path, sha256, byteSize };
}
