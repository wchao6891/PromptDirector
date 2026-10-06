import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCuratedSubmissionEntry, prepareCuratedSubmissionState } from '../extension/curated-submission.js';
import { buildCuratedSkillSnapshot, buildCuratedSkillSubmissionArchive } from '../extension/curated-skill-package.js';
import { createDefaultTaxonomy } from '../extension/taxonomy.js';
import { groupCuratedPreview } from '../extension/curated-media-gallery.js';
import { createCreativeSkill, createCreativeSkillsState } from '../extension/creative-skills.js';
import { readZipBlob } from '../extension/zip.js';

const image = id => ({ id, kind: 'image', usage: 'content', storageMode: 'managed', width: 1, height: 1, mimeType: 'image/png' });
const entry = id => ({ id, title: id, text: `original ${id}`, savedAt: '2026-01-01T00:00:00Z', primaryMediaId: id + '-a', mediaAssets: [image(id + '-a')] });

test('精选投稿保留多图、混合媒体及组合的成员顺序，个人标签不公开', () => {
  const a = entry('a'), b = entry('b');
  a.mediaAssets.push(image('a-b'), { id: 'video', kind: 'video', usage: 'content', storageMode: 'managed', mimeType: 'video/mp4', width: 1, height: 1, posterAssetId: 'poster' }, { ...image('poster'), usage: 'poster', derivedFromAssetId: 'video' });
  assert.equal(sanitizeCuratedSubmissionEntry(a).mediaAssets.length, 4);
  const state = { entries: [a, b], taxonomy: createDefaultTaxonomy(), compoundCases: [{ id: 'group', title: 'ordered group', memberEntryIds: ['b', 'a'], coverVisualId: 'b-a', customLabels: ['private'] }] };
  const result = prepareCuratedSubmissionState(state, { entryIds: ['group'] });
  assert.deepEqual(result.state.compoundCases[0].memberEntryIds, ['b', 'a']);
  assert.deepEqual(result.state.compoundCases[0].customLabels, []);
  assert.equal(result.entries.length, 2);
});

test('精选 Skill 快照与投稿 ZIP 保留当前文件、脚本、非 Markdown 引用、空文件和二进制原件', async () => {
  const originals = new Map([
    ['SKILL.md', new Blob(['---\nname: complete-skill\ndescription: Complete package\n---\n\nCurrent body\n'])],
    ['scripts/run.py', new Blob(['print("original script")\n'])],
    ['references/example.txt', new Blob(['完整引用\n'])],
    ['assets/data.bin', new Blob([new Uint8Array([0, 255, 13, 0])])],
    ['assets/empty', new Blob([])]
  ]);
  const cover = new Blob([Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')], { type: 'image/gif' });
  const skill = createCreativeSkill(createCreativeSkillsState(), { portableId: 'complete-skill', callName: '完整技能', description: 'Complete package', skillMarkdown: 'Current body',
    packageFiles: [...originals].map(([path, blob]) => ({ path, assetId: path, byteSize: blob.size })).concat([{ path: 'assets/cover.gif', assetId: 'cover', byteSize: cover.size }]) }).skill;
  const snapshot = await buildCuratedSkillSnapshot(skill, { author: 'Test author', summary: 'Complete files', rightsConfirmed: true }, { readFile: id => id === 'cover' ? cover : originals.get(id) });
  const archive = await buildCuratedSkillSubmissionArchive(snapshot);
  const payload = await readZipBlob((await readZipBlob(archive)).get('payload.zip'));
  for (const [path, blob] of originals) assert.deepEqual(new Uint8Array(await payload.get(path).arrayBuffer()), new Uint8Array(await blob.arrayBuffer()), path);
  assert.equal(payload.size, originals.size + 1);
});

test('组合预览为一个条目，每份媒体仍对应其成员原提示词与顺序', () => {
  const compound = { id: 'g', title: 'Group', memberEntryIds: ['b', 'a'] };
  const views = groupCuratedPreview([{ id: 'a', title: 'A', text: 'A prompt', compound, media: [{ id: 'a-media' }] }, { id: 'b', title: 'B', text: 'B prompt', compound, media: [{ id: 'b-media' }] }]);
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].memberEntryIds, ['b', 'a']);
  assert.deepEqual(views[0].media.map(asset => asset.text), ['B prompt', 'A prompt']);
});
