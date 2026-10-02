import { open, mkdir, rename, unlink, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { connectorRoot, ensurePrivateRoot } from './paths.mjs';

async function digest(handle) {
  const hash = createHash('sha256');
  for await (const data of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(data);
  return hash.digest('hex');
}
export async function stageFiles(files, bodyFile, requestId, call, { purpose, limits } = {}) {
  if (bodyFile && !files.some(file => file.path === bodyFile)) throw new Error('正文文件必须同时列入附件。');
  if (limits) {
    if (files.length > limits.maxFileCount) throw new Error('Skill包文件数量超过插件导入上限，未开始上传。');
    let totalBytes = 0;
    for (const file of files) {
      if (!isAbsolute(file.path)) throw new Error('附件必须使用绝对路径。');
      const info = await stat(file.path);
      if (!info.isFile()) throw new Error('Skill附件必须是普通文件。');
      if (info.size > limits.maxFileBytes) throw new Error('Skill单文件超过插件导入上限，未开始上传。');
      totalBytes += info.size;
    }
    if (totalBytes > limits.maxArchiveBytes) throw new Error('Skill包总大小超过插件导入上限，未开始上传。');
  }
  const transferIds = []; const filePrompts = {}; let bodyTransferId;
  for (const [index, file] of files.entries()) {
    if (!isAbsolute(file.path)) throw new Error('附件必须使用绝对路径。');
    const handle = await open(file.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (!stat.size && purpose !== 'skill-file')) throw new Error('附件必须是普通文件；案例附件不能为空。');
      const sha256 = await digest(handle);
      const id = createHash('sha256').update(JSON.stringify([requestId, index, sha256, file.path, ...(purpose ? [purpose] : [])])).digest('hex');
      const receipt = await call('begin_transfer', { id, name: basename(file.path), mimeType: file.mimeType,
        byteSize: stat.size, sha256, forceImport: file.forceImport === true, ...(purpose ? { purpose } : {}) });
      if (receipt.state === 'uploading') {
        let offset = receipt.offset;
        const buffer = Buffer.alloc(receipt.chunkBytes);
        while (offset < stat.size) {
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stat.size - offset), offset);
          if (!bytesRead) throw new Error('读取期间附件发生变化，请重试。');
          const next = await call('append_transfer', { id, offset, data: buffer.subarray(0, bytesRead).toString('base64') });
          offset = next.offset;
        }
      }
      await call('finish_transfer', { id });
      transferIds.push(id); if (file.originalPrompt) filePrompts[id] = file.originalPrompt; if (bodyFile === file.path) bodyTransferId = id;
    } finally { await handle.close(); }
  }
  return { transferIds, filePrompts, ...(bodyTransferId ? { bodyTransferId } : {}) };
}
export async function receiveMedia(input, call, root = connectorRoot()) {
  await ensurePrivateRoot(root);
  const directory = join(root, 'files'); await mkdir(directory, { recursive: true, mode: 0o700 });
  // Always consult the current library before reusing a file: deletion, changed
  // membership or a new original must never be hidden by the local cache.
  const first = await call('read_media', { ...input, offset: 0 });
  if (first.offset !== 0 || !/^[a-f0-9]{64}$/u.test(first.sha256) || !Number.isSafeInteger(first.byteSize) || first.byteSize < 0) {
    throw new Error('媒体分块不一致。');
  }
  const name = basename(String(first.name || input.assetId || 'media')).replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-100) || 'media';
  const path = join(directory, `${first.sha256}-${name}`);
  const result = { path, mimeType: first.mimeType, byteSize: first.byteSize, sha256: first.sha256, caseId: input.caseId, assetId: input.assetId };
  let cached;
  try {
    cached = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await cached.stat();
    if (stat.isFile() && stat.size === first.byteSize && await digest(cached) === first.sha256) return result;
  } catch (error) {
    if (!['ENOENT', 'ELOOP'].includes(error.code)) throw error;
  } finally { await cached?.close(); }
  const temp = join(directory, `${randomUUID()}.partial`);
  const handle = await open(temp, 'wx', 0o600);
  let offset = 0;
  const hash = createHash('sha256');
  try {
    do {
      const part = offset === 0 ? first : await call('read_media', { ...input, offset, expectedHash: first.sha256 });
      const bytes = Buffer.from(part.data, 'base64');
      if (part.offset !== offset || part.sha256 !== first.sha256 || part.byteSize !== first.byteSize || (!bytes.length && offset < first.byteSize)) throw new Error('媒体分块不一致。');
      await handle.writeFile(bytes); hash.update(bytes); offset += bytes.length;
      if (part.nextOffset === null) break;
      if (part.nextOffset !== offset) throw new Error('媒体分块位置错误。');
    } while (offset < first.byteSize);
    if (offset !== first.byteSize || hash.digest('hex') !== first.sha256) throw new Error('原件完整性验证失败，未交付文件。');
    await handle.close();
    await rename(temp, path);
    return result;
  } catch (error) { await handle.close().catch(() => {}); await unlink(temp).catch(() => {}); throw error; }
}
