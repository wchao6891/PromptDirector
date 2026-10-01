#!/usr/bin/env node

import { createWriteStream, openAsBlob } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { createDefaultFacetCatalog } from "../extension/facets.js";
import { renderLibraryJson } from "../extension/lib.js";
import { createZipBlob } from "../extension/zip.js";
import { CONTENT_IDS, createDefaultTaxonomy, SCHEMA_VERSION } from "../extension/taxonomy.js";

const DEFAULT_CHUNK_SIZE = 150;
const EXTENSION_MIME_TYPES = Object.freeze({
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4"
});

export async function buildImageImportPackages({ source, output, chunkSize = DEFAULT_CHUNK_SIZE, limit = Infinity } = {}) {
  if (!source || !output) throw new Error("必须指定 --source 和 --output");
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("--chunk-size 必须是正整数");

  const sourceRoot = source;
  const pack = JSON.parse(await readFile(join(sourceRoot, "pack.json"), "utf8"));
  const libraryLabel = clean(pack.folder?.name) || basename(sourceRoot);
  const packagePrefix = `PromptDirector-${safeName(libraryLabel)}`;
  const folders = flattenFolders(pack.folder);
  const folderById = new Map(folders.map((item) => [item.id, item]));
  const sourceRecords = [];
  const missing = [];
  for (const image of Array.isArray(pack.images) ? pack.images : []) {
    if (image?.isDeleted) continue;
    const format = normalizeExtension(image.ext);
    const kind = format === "mp4" ? "video" : "image";
    if (!EXTENSION_MIME_TYPES[format]) throw new Error(`未识别的媒体格式：${image.id}（${format}）`);
    const foldersForImage = (Array.isArray(image.folders) ? image.folders : [])
      .map((id) => folderById.get(id))
      .filter(Boolean);
    const primaryFolder = foldersForImage[0];
    if (!primaryFolder) throw new Error(`记录没有有效分类：${image.id}`);
    const infoDirectory = join(sourceRoot, `${image.id}.info`);
    const original = await findOriginal(infoDirectory, image.id, format);
    if (!original) {
      missing.push({ id: image.id, expectedDirectory: infoDirectory, ext: format });
      continue;
    }
    sourceRecords.push({ image: { ...image, size: (await stat(original)).size }, format, kind, original, folders: foldersForImage, primaryFolder });
    if (sourceRecords.length >= limit) break;
  }
  if (missing.length) throw new Error(`有 ${missing.length} 条记录找不到原件，已停止生成；首条：${missing[0].id}`);

  const groups = new Map();
  for (const record of sourceRecords) {
    const root = record.primaryFolder.root;
    const list = groups.get(root.id) ?? [];
    list.push(record);
    groups.set(root.id, list);
  }

  await mkdir(output, { recursive: true });
  const manifest = {
    format: "promptdirector-image-import-manifest",
    version: 1,
    source: sourceRoot,
    sourcePack: join(sourceRoot, "pack.json"),
    generatedAt: new Date().toISOString(),
    chunkSize,
    sourceRecords: sourceRecords.length,
    missingRecords: missing.length,
    multiCategoryRecords: sourceRecords.filter((item) => item.folders.length > 1).length,
    packages: []
  };

  for (const root of folders.filter((item) => item.parentId === null)) {
    const records = groups.get(root.id) ?? [];
    if (!records.length) continue;
    const chunks = balancedChunks(records, chunkSize);
    for (let index = 0; index < chunks.length; index += 1) {
      const packageRecords = chunks[index];
      const packageName = `${packagePrefix}-${safeName(root.name)}-${String(index + 1).padStart(2, "0")}`;
      const packagePath = join(output, `${packageName}.zip`);
      const built = await createPackage({ packageRecords, packageName, libraryLabel });
      const archive = await createZipBlob(built.files);
      await writeBlob(packagePath, archive);
      const report = {
        file: `${packageName}.zip`,
        packageName,
        rootCategory: root.name,
        rootPath: root.path,
        chunk: index + 1,
        chunks: chunks.length,
        caseCount: packageRecords.length,
        mediaCount: built.mediaCount,
        byteSize: archive.size,
        categories: built.categories
      };
      manifest.packages.push(report);
      process.stdout.write(`${report.file}\t${report.caseCount} cases\t${formatBytes(report.byteSize)}\n`);
    }
  }

  const readme = renderManifestReadme(manifest);
  await writeFile(join(output, "导入包清单.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(output, "README.md"), readme);
  return manifest;
}

async function createPackage({ packageRecords, packageName, libraryLabel }) {
  const folderCollectionById = new Map();
  const collections = [];
  const entries = [];
  const files = [];
  const categoryNames = new Set();
  for (const record of packageRecords) {
    const entryId = `case:${record.image.id}`;
    const assetId = `media:${record.image.id}`;
    const assetDirectory = record.kind === "video" ? "videos" : "images";
    const assetPath = `${assetDirectory}/${record.image.id}.${record.format}`;
    const title = clean(record.image.name) || basename(record.original, extname(record.original));
    const categoryPaths = record.folders.map((folder) => folder.path);
    categoryPaths.forEach((path) => categoryNames.add(path));
    entries.push({
      id: entryId,
      schemaVersion: SCHEMA_VERSION,
      title,
      text: clean(record.image.annotation),
      url: safeHttpUrl(record.image.url),
      savedAt: isoTimestamp(record.image.modificationTime ?? record.image.mtime),
      classification: { pathIds: [record.kind === "video" ? CONTENT_IDS.videoCase : CONTENT_IDS.imageCase], status: "confirmed", source: "manual" },
      customLabels: [libraryLabel, ...(Array.isArray(record.image.tags) ? record.image.tags.map(clean).filter(Boolean) : [])],
      metadataLabels: categoryPaths,
      mediaAssets: [{
        id: assetId,
        kind: record.kind,
        storageMode: "managed",
        sourceFormat: record.format,
        mimeType: EXTENSION_MIME_TYPES[record.format],
        assetPath,
        sourceTitle: basename(record.original),
        sourceUrl: safeHttpUrl(record.image.url),
        byteSize: record.image.size,
        width: positiveInteger(record.image.width),
        height: positiveInteger(record.image.height),
        capturedAt: isoTimestamp(record.image.modificationTime ?? record.image.mtime)
      }],
      primaryMediaId: assetId
    });
    files.push({ name: assetPath, data: await openBlob(record.original, EXTENSION_MIME_TYPES[record.format]) });
    addCollectionMembership(record.primaryFolder, entryId, folderCollectionById, collections);
  }
  const libraryJson = renderLibraryJson(
    entries,
    { libraryTitle: packageName },
    createDefaultTaxonomy(),
    createDefaultFacetCatalog(),
    [],
    { version: 7, collections }
  );
  files.unshift({ name: "library.json", data: libraryJson });
  return { files, mediaCount: packageRecords.length, categories: [...categoryNames].sort() };
}

function addCollectionMembership(folder, entryId, byId, collections) {
  const chain = [];
  let current = folder;
  while (current) {
    chain.unshift(current);
    current = current.parentId ? current.parent : null;
  }
  for (const item of chain) {
    let collection = byId.get(item.id);
    if (!collection) {
      collection = {
        id: `collection:source:${item.id}`,
        name: item.name,
        parentId: item.parentId ? `collection:source:${item.parentId}` : null,
        order: collections.filter((value) => value.parentId === (item.parentId ? `collection:source:${item.parentId}` : null)).length,
        entryIds: [],
        visibility: "library"
      };
      byId.set(item.id, collection);
      collections.push(collection);
    }
  }
  const leaf = byId.get(folder.id);
  if (!leaf.entryIds.includes(entryId)) leaf.entryIds.push(entryId);
}

function flattenFolders(root) {
  const result = [];
  const walk = (value, parent = null, path = []) => {
    const item = {
      id: String(value.id),
      name: clean(value.name) || "未命名分类",
      parentId: parent?.id ?? null,
      parent,
      root: parent?.root ?? null,
      path: [...path, clean(value.name) || "未命名分类"].join(" / ")
    };
    item.root = parent?.root ?? item;
    result.push(item);
    for (const child of Array.isArray(value.children) ? value.children : []) walk(child, item, [...path, item.name]);
  };
  for (const child of Array.isArray(root?.children) ? root.children : []) walk(child);
  return result;
}

async function findOriginal(directory, id, format) {
  let names;
  try { names = await readdir(directory); } catch { return ""; }
  const candidates = names.filter((name) => {
    if (name === "metadata.json" || name.toLowerCase().endsWith(`_thumbnail.${format}`)) return false;
    return normalizeExtension(extname(name)) === format;
  });
  if (!candidates.length) return "";
  const preferred = candidates.find((name) => name.startsWith(id));
  return join(directory, preferred ?? candidates[0]);
}

function balancedChunks(items, size) {
  const count = Math.max(1, Math.ceil(items.length / 200), Math.round(items.length / size));
  const result = [];
  for (let index = 0; index < count; index += 1) {
    result.push(items.slice(Math.floor(index * items.length / count), Math.floor((index + 1) * items.length / count)));
  }
  return result;
}

async function openBlob(path, type) {
  return openAsBlob(path, { type });
}

async function writeBlob(path, blob) {
  await pipeline(Readable.fromWeb(blob.stream()), createWriteStream(path));
}

function renderManifestReadme(manifest) {
  const firstPackage = manifest.packages[0]?.file ?? "第一个 ZIP";
  const lines = ["# PromptDirector 分类导入包", "", `共 ${manifest.packages.length} 个 ZIP，${manifest.sourceRecords} 条案例。`, "", `建议先导入 \`${firstPackage}\` 做一轮检查：打开 PromptDirector 的资料管理，选择“导入分享包”，选中 ZIP，确认预览数量后导入。导入后按一级分类项目进入案例，选中不需要的案例移入回收站，再继续导入下一个包。`, "", "每个 ZIP 都是独立批次，导入顺序不影响案例内容。包内只包含原始媒体文件和分类索引，不包含缩略图或来源图库色卡；插件后续可按自己的分析流程生成色卡。", "", "| 文件 | 一级分类 | 案例数 | 大小 |", "| --- | --- | ---: | ---: |"];
  for (const item of manifest.packages) lines.push(`| ${item.file} | ${item.rootCategory} | ${item.caseCount} | ${formatBytes(item.byteSize)} |`);
  lines.push("", "说明：原分类路径保存在案例的元数据标签中，并按原层级创建项目；跨多个分类的图片只生成一个案例，放在原图库列出的第一个分类项目中，其余分类路径保存在标签里。", "");
  return lines.join("\n");
}

function safeName(value) { return clean(value).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim() || "未命名"; }
function normalizeExtension(value) { return String(value ?? "").replace(/^\./, "").toLowerCase(); }
function clean(value) { return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim(); }
function positiveInteger(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? number : undefined; }
function isoTimestamp(value) { const number = Number(value); return Number.isFinite(number) ? new Date(number).toISOString() : new Date().toISOString(); }
function safeHttpUrl(value) { const text = clean(value); return /^https?:\/\//i.test(text) ? text : ""; }
function formatBytes(value) { const bytes = Number(value) || 0; return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`; }

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--source") result.source = argv[++index];
    else if (arg === "--output") result.output = argv[++index];
    else if (arg === "--chunk-size") result.chunkSize = Number(argv[++index]);
    else if (arg === "--limit") result.limit = Number(argv[++index]);
    else if (arg === "--help") result.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return result;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.source || !args.output) {
    process.stdout.write("用法：node tools/build-image-import-packages.mjs --source <原图库> --output <输出目录> [--chunk-size 150] [--limit N]\n");
    process.exit(args.help ? 0 : 1);
  }
  buildImageImportPackages(args).then((manifest) => {
    process.stdout.write(`完成：${manifest.packages.length} 个包，${manifest.sourceRecords} 条案例\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
