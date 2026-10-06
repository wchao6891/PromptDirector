import { sha256Blob } from './blob-digest.js';
import { assetFormatForExtension, portableAssetDirectory } from './asset-formats.js';
import { CONTENT_IDS, createDefaultTaxonomy, SCHEMA_VERSION } from './taxonomy.js';
import { createDefaultFacetCatalog } from './facets.js';
import { CURRENT_LIBRARY_PACKAGE_VERSION } from './library-package-format.js';
import { readJsonWithResourceBudget } from './resource-policy.js';

export function eagleDirectorySource(items = []) {
  const manifests = items.filter(item => /(?:^|\/)pack\.json$/i.test(item.relativePath || item.file?.name || ''));
  if (manifests.length !== 1) return null;
  const item = manifests[0], path = item.relativePath || item.file.name;
  const prefix = path.slice(0, -'pack.json'.length);
  return { file: item.file, relativePath: prefix.replace(/\/$/, '') || item.file.name, sourceFiles: items.filter(value => (value.relativePath || value.file.name).startsWith(prefix)) };
}

export async function readEaglePackage(reader, options = {}) {
  const manifests = reader.names.filter(path => /(?:^|\/)pack\.json$/i.test(path));
  if (manifests.length !== 1) throw new Error('Eagle 包需包含唯一 pack.json，请选择 Eagle 导出的 .eaglepack 或解包文件夹');
  const source = await reader.read(manifests, { signal: options.signal });
  return convertEagleSource({ names: reader.names, read: names => reader.read(names, { signal: options.signal }), manifestPath: manifests[0], manifest: source.get(manifests[0]) }, options);
}

export async function readEagleDirectory(items, options = {}) {
  const files = new Map(items.map(item => [item.relativePath || item.file.name, item.file]));
  const manifests = [...files.keys()].filter(path => /(?:^|\/)pack\.json$/i.test(path));
  if (manifests.length !== 1) throw new Error('请选择包含唯一 pack.json 的完整 Eagle 导出文件夹');
  return convertEagleSource({ names: [...files.keys()], read: async names => new Map(names.map(name => [name, files.get(name)])), manifestPath: manifests[0], manifest: files.get(manifests[0]) }, options);
}

async function convertEagleSource(source, { signal, onProgress = () => {} } = {}) {
  const pack = await readJsonWithResourceBudget(source.manifest, { signal, label: 'Eagle pack.json' });
  if (!Array.isArray(pack.images) || !pack.folder || typeof pack.folder !== 'object') throw new Error('Eagle pack.json 缺少案例与分类索引');
  const prefix = source.manifestPath.slice(0, -'pack.json'.length);
  const folders = new Map(), collections = [], entries = [], files = new Map(), diagnostics = [];
  const roots = Array.isArray(pack.folder) ? pack.folder : [pack.folder];
  const walk = (folder, parentId = null) => {
    if (!folder || typeof folder !== 'object') throw new Error('Eagle 分类结构无效');
    const id = String(folder.id ?? (parentId ? '' : 'root'));
    if (!id || folders.has(id)) throw new Error('Eagle 分类编号缺失或重复');
    const collection = { id: `eagle:folder:${id}`, name: String(folder.name || 'Eagle'), parentId, entryIds: [], order: collections.filter(item => item.parentId === parentId).length, visibility: 'library' };
    folders.set(id, collection); collections.push(collection);
    for (const child of folder.children ?? []) walk(child, collection.id);
  };
  roots.forEach(folder => walk(folder));
  const originalFiles = new Map();
  for (const path of source.names) {
    const directory = path.slice(0, path.lastIndexOf("/") + 1);
    if (!originalFiles.has(directory)) originalFiles.set(directory, []);
    originalFiles.get(directory).push(path);
  }
  const seen = new Set();
  for (const [index, record] of pack.images.entries()) {
    signal?.throwIfAborted();
    onProgress({ completed: index, total: pack.images.length });
    if (record?.isDeleted) continue;
    const id = String(record?.id ?? ''), title = String(record?.name || id), extension = String(record?.ext || '').replace(/^\./, '').toLowerCase();
    const skip = reason => diagnostics.push({ code: 'eagle_record_skipped', action: 'skipped', reason, entryId: id, title });
    if (!id || id.includes('/') || id.includes('\\') || id === '.' || id === '..' || seen.has(id)) throw new Error('Eagle 案例编号缺失、重复或不安全');
    seen.add(id);
    const format = assetFormatForExtension(extension);
    if (!format) { skip(`暂不支持 .${extension || '未知格式'} 原件`); continue; }
    const directory = `${prefix}${id}.info/`;
    const candidates = (originalFiles.get(directory) ?? []).filter(path => path.toLowerCase().endsWith(`.${extension}`) && !/_thumbnail\.[^/]+$/i.test(path));
    const expected = directory + id + '.' + extension;
    const original = candidates.includes(expected) ? expected : candidates.length === 1 ? candidates[0] : '';
    if (!original) { skip(candidates.length ? '存在多个候选原件，请先核对 Eagle 导出包' : '原件缺失，未用缩略图代替'); continue; }
    const memberships = Array.isArray(record.folders) && record.folders.length ? record.folders : [roots[0].id ?? 'root'];
    if (memberships.some(id => !folders.has(String(id)))) { skip('分类索引不完整，未丢弃分类后强行导入'); continue; }
    const blob = (await source.read([original])).get(original);
    if (!(blob instanceof Blob) || !blob.size) { skip('原件为空或无法读取'); continue; }
    const contentHash = await sha256Blob(blob);
    signal?.throwIfAborted();
    const assetId = `eagle:media:${id}`, entryId = `eagle:case:${id}`;
    const directoryName = portableAssetDirectory(format.kind);
    const assetPath = `${directoryName}/${encodeURIComponent(id)}.${extension}`;
    const url = safeSourceUrl(record.url), savedAt = timestamp(record.modificationTime ?? record.mtime ?? record.btime);
    const role = { image: CONTENT_IDS.imageCase, video: CONTENT_IDS.videoCase, audio: CONTENT_IDS.audio, document: CONTENT_IDS.reference, attachment: CONTENT_IDS.sourceFile }[format.kind];
    entries.push({ id: entryId, schemaVersion: SCHEMA_VERSION, title, text: String(record.annotation ?? ''), url, sourcePages: url ? [{ title, url }] : [], savedAt,
      classification: { pathIds: [role], status: 'confirmed', source: 'manual' }, customLabels: Array.isArray(record.tags) ? record.tags.map(String) : [],
      mediaAssets: [{ id: assetId, kind: format.kind, usage: 'content', storageMode: 'managed', assetPath, sourceFormat: format.id, contentHash, mimeType: format.mimeTypes[0], byteSize: blob.size,
        width: Number(record.width) > 0 ? Math.round(record.width) : undefined, height: Number(record.height) > 0 ? Math.round(record.height) : undefined,
        sourceTitle: original.slice(directory.length), sourceUrl: url, capturedAt: savedAt }], primaryMediaId: assetId });
    files.set(assetPath, blob.slice(0, blob.size, format.mimeTypes[0]));
    for (const folderId of memberships) folders.get(String(folderId)).entryIds.push(entryId);
  }
  onProgress({ completed: pack.images.length, total: pack.images.length });
  if (!entries.length) throw new Error(`Eagle 包没有可完整导入的案例${diagnostics[0] ? `：${diagnostics[0].reason}` : ''}`);
  return { library: { format: 'prompt-case-library', version: CURRENT_LIBRARY_PACKAGE_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
    settings: { libraryTitle: String(roots[0]?.name || 'Eagle') }, taxonomy: createDefaultTaxonomy(), facetCatalog: createDefaultFacetCatalog(), classificationRules: [],
    organizerState: { version: 7, collections }, compoundCases: [], entries }, files,
    report: { diagnostics, stats: { skippedCases: diagnostics.length } } };
}

function safeSourceUrl(value) { try { const url = new URL(String(value || '')); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } }
function timestamp(value) { const date = new Date(typeof value === 'number' ? value : value || Date.now()); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); }
