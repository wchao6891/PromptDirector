import { parseLibraryPackage } from "./library-package.js";
import { LIBRARY_TRANSFER_LIMITS } from "./resource-limits.js";
import { createZipBlob, readZipBlob } from "./zip.js";
import { sharedLibraryMediaFiles } from './library-shared-media.js';
import { t } from "./i18n.js";

export async function createVerifiedLibraryZip(files, expectedLibraryJson) {
  const archive = await createZipBlob(files);
  await verifyLibraryZipRoundtrip(archive, expectedLibraryJson);
  return archive;
}

export async function verifyLibraryZipRoundtrip(archive, expectedLibraryJson) {
  try {
    return await verifyRoundtrip(archive, expectedLibraryJson);
  } catch (error) {
    if (error?.exportSelfCheckFailed) throw error;
    throw selfCheckError(t("导出自检失败：{reason}", { reason: String(error?.message ?? t("无法重新读取导出的 ZIP")) }), error);
  }
}

async function verifyRoundtrip(archive, expectedLibraryJson) {
  const limits = LIBRARY_TRANSFER_LIMITS;
  const extracted = await readZipBlob(archive, limits);
  const libraryFile = extracted.get("library.json");
  if (!(libraryFile instanceof Blob)) throw new Error(t("导出的 ZIP 缺少 library.json"));
  if (libraryFile.size > limits.maxLibraryJsonBytes) throw new Error(t("导出的 library.json 超过安全上限"));
  const expectedData = JSON.parse(String(expectedLibraryJson ?? ''));
  const actualData = JSON.parse(await libraryFile.text());
  const expected = parseLibraryPackage(expectedData, await sharedLibraryMediaFiles(expectedData, extracted), limits);
  const actual = parseLibraryPackage(actualData, await sharedLibraryMediaFiles(actualData, extracted), limits);
  if (stableJson(packageSemantics(actual)) !== stableJson(packageSemantics(expected))) {
    throw selfCheckError(t("导出自检失败：ZIP 内容与生成前不一致"));
  }
  return actual;
}

function selfCheckError(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.exportSelfCheckFailed = true;
  return error;
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
