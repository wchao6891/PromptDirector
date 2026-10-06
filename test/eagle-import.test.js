import assert from 'node:assert/strict';
import test from 'node:test';
import { createZipBlob, openZipBlob } from '../extension/zip.js';
import { readEaglePackage, readEagleDirectory, eagleDirectorySource } from '../extension/eagle-import.js';
import { parseLibraryPackage, mergeLibraryPackage } from '../extension/library-package.js';
import { importContainerKindForFile } from '../extension/asset-formats.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf2kAAAAASUVORK5CYII=', 'base64');
function fixture() {
  const pack = { folder: { id: 'root', name: '参考库', children: [{ id: 'a', name: '色彩', children: [{ id: 'b', name: '暖色' }] }, { id: 'c', name: '构图' }] }, images: [
    { id: 'img1', name: '原图', ext: 'png', width: 1, height: 1, modificationTime: 1700000000000, folders: ['b', 'c'], tags: ['参考', 'Tag'], annotation: '完整说明\n  原始缩进\n', url: 'https://example.com/original' },
    { id: 'doc1', name: '原文', ext: 'txt', modificationTime: 1700000000000, folders: ['a'], tags: ['文档'], annotation: '描述' },
    { id: 'missing', name: '缺原件', ext: 'png', folders: ['a'] }
  ] };
  return new Map([['source/pack.json', new Blob([JSON.stringify(pack)])], ['source/img1.info/原图.png', new Blob([png])], ['source/img1.info/原图_thumbnail.png', new Blob(['thumbnail'])], ['source/doc1.info/原文.txt', new Blob(['正文全文'])], ['source/missing.info/缺原件_thumbnail.png', new Blob(['thumbnail only'])]]);
}

test('Eagle 原生包导入保留原件、分类树、多分类成员、标签、原说明和来源，绝不用缩略图冒充原件', async () => {
  const source = fixture();
  const archive = await createZipBlob([...source].map(([name, data]) => ({ name, data })));
  const converted = await readEaglePackage(await openZipBlob(archive));
  const parsed = parseLibraryPackage(converted.library, converted.files);
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.assets.size, 2);
  assert.equal(parsed.entries[0].text, '完整说明\n  原始缩进\n');
  assert.equal(parsed.entries[0].url, 'https://example.com/original');
  assert.deepEqual(parsed.entries[0].customLabels, ['参考', 'Tag']);
  const projects = parsed.organizerState.collections;
  assert.equal(projects.find(item => item.name === '暖色').parentId, projects.find(item => item.name === '色彩').id);
  assert.ok(projects.find(item => item.name === '暖色').entryIds.includes('eagle:case:img1'));
  const copyId = projects.find(item => item.name === '构图').entryIds[0];
  const copy = parsed.entries.find(item => item.id === copyId);
  assert.equal(copy.mediaAssets[0].id, parsed.entries[0].mediaAssets[0].id);
  assert.equal(copy.text, parsed.entries[0].text);
  assert.deepEqual(Buffer.from(await parsed.assets.get('eagle:media:img1').arrayBuffer()), png);
  assert.equal(converted.report.stats.skippedCases, 1);
  assert.match(converted.report.diagnostics[0].reason, /原件缺失/);
  assert.equal([...converted.files.keys()].some(path => path.includes('thumbnail')), false);
  const current = mergeLibraryPackage({}, converted.library).state;
  const again = mergeLibraryPackage(current, converted.library);
  assert.equal(again.importedCount, 0);
  assert.equal(again.skippedCount, 3);
});

test('Eagle 解包目录与压缩包复用同一转换，取消和歧义不会悄悄丢资料', async () => {
  const items = [...fixture()].map(([relativePath, blob]) => ({ relativePath, file: new File([blob], relativePath.split('/').at(-1)) }));
  const selected = eagleDirectorySource(items);
  assert.equal(selected.sourceFiles.length, items.length);
  const converted = await readEagleDirectory(selected.sourceFiles);
  assert.equal(converted.library.entries.length, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readEagleDirectory(items, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(importContainerKindForFile({ name: '真实包.eaglepack', type: '' }), 'share-package');
});
