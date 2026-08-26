import { parseLibraryPackage } from "./library-package.js";
import { PORTABLE_LIBRARY_LIMITS } from "./resource-limits.js";
import { createZipBlob, readZipBlob } from "./zip.js";

export async function createVerifiedLibraryZip(files, expectedLibraryJson) {
  const archive = await createZipBlob(files);
  await verifyLibraryZipRoundtrip(archive, expectedLibraryJson);
  return archive;
}

export async function verifyLibraryZipRoundtrip(archive, expectedLibraryJson) {
  try {
    return await verifyRoundtrip(archive, expectedLibraryJson);
  } catch (error) {
    if (String(error?.message ?? "").startsWith("导出自检失败")) throw error;
    throw new Error(`导出自检失败：${String(error?.message ?? "无法重新读取导出的 ZIP")}`, { cause: error });
  }
}

async function verifyRoundtrip(archive, expectedLibraryJson) {
  const limits = {
    ...PORTABLE_LIBRARY_LIMITS,
    maxArchiveBytes: archive.size,
    maxFileBytes: archive.size,
    maxImageBytes: archive.size,
    maxVideoBytes: archive.size
  };
  const extracted = await readZipBlob(archive, limits);
  const libraryFile = extracted.get("library.json");
  if (!(libraryFile instanceof Blob)) throw new Error("导出的 ZIP 缺少 library.json");
  if (libraryFile.size > limits.maxLibraryJsonBytes) throw new Error("导出的 library.json 超过安全上限");
  const expected = parseLibraryPackage(JSON.parse(String(expectedLibraryJson ?? "")), extracted, limits);
  const actual = parseLibraryPackage(JSON.parse(await libraryFile.text()), extracted, limits);
  if (stableJson(packageSemantics(actual)) !== stableJson(packageSemantics(expected))) {
    throw new Error("导出自检失败：ZIP 内容与生成前不一致");
  }
  return actual;
}

function packageSemantics(value) {
  const {
    assets: _assets,
    images: _images,
    skillAssets: _skillAssets,
    importDiagnostics: _importDiagnostics,
    importStats: _importStats,
    exportedAt: _exportedAt,
    ...persistent
  } = value;
  return persistent;
}

function stableJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}
