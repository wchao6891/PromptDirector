import { open, mkdir, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, isAbsolute, join } from 'node:path';
import { connectorRoot, ensurePrivateRoot } from './paths.mjs';

async function digest(handle) {
  const hash = createHash('sha256');
  for await (const data of handle.createReadStream({ autoClose: false, start: 0 })) hash.update(data);
  return hash.digest('hex');
}
export async function stageFiles(files, bodyFile, requestId, call) {
  if (bodyFile && !files.some(file => file.path === bodyFile)) throw new Error('正文文件必须同时列入附件。');
  const transferIds = []; const filePrompts = {}; let bodyTransferId;
  for (const [index, file] of files.entries()) {
    if (!isAbsolute(file.path)) throw new Error('附件必须使用绝对路径。');
    const handle = await open(file.path, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || !stat.size) throw new Error('附件必须是非空普通文件。');
      const sha256 = await digest(handle);
      const id = createHash('sha256').update(JSON.stringify([requestId, index, sha256, file.path])).digest('hex');
      const receipt = await call('begin_transfer', { id, name: basename(file.path), mimeType: file.mimeType,
        byteSize: stat.size, sha256, forceImport: file.forceImport === true });
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
  const temp = join(directory, `${randomUUID()}.partial`);
  const handle = await open(temp, 'wx', 0o600);
  let first; let offset = 0;
  const hash = createHash('sha256');
  try {
    do {
      const part = await call('read_media', { ...input, offset, ...(first ? { expectedHash: first.sha256 } : {}) });
      first ||= part;
      const bytes = Buffer.from(part.data, 'base64');
      if (part.offset !== offset || part.sha256 !== first.sha256 || part.byteSize !== first.byteSize || (!bytes.length && offset < first.byteSize)) throw new Error('媒体分块不一致。');
      await handle.writeFile(bytes); hash.update(bytes); offset += bytes.length;
      if (part.nextOffset === null) break;
      if (part.nextOffset !== offset) throw new Error('媒体分块位置错误。');
    } while (offset < first.byteSize);
    if (offset !== first.byteSize || hash.digest('hex') !== first.sha256) throw new Error('原件完整性验证失败，未交付文件。');
    await handle.close();
    const name = basename(first.name || input.assetId).replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-100) || 'media';
    const path = join(directory, `${first.sha256}-${name}`); await rename(temp, path);
    return { path, mimeType: first.mimeType, byteSize: first.byteSize, sha256: first.sha256, caseId: input.caseId, assetId: input.assetId };
  } catch (error) { await handle.close().catch(() => {}); await unlink(temp).catch(() => {}); throw error; }
}
