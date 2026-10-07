import test from 'node:test';
import assert from 'node:assert/strict';
import { caseBrowseProjection, sortBrowseCases } from '../extension/library-browse-index.js';
import { materializeLogicalCases } from '../extension/compound-cases.js';
import { caseListMetadata } from '../extension/library-list.js';
import { sortLibraryCases } from '../extension/library-view.js';
import { entryContentTypeIds, filterEntries, isEntryPending } from '../extension/library-model.js';

const modes = ['added-desc', 'added-asc', 'updated-desc', 'updated-asc', 'title', 'title-desc', 'project-manual',
  ...['type', 'count', 'tags', 'source', 'size'].flatMap(key => [`${key}-asc`, `${key}-desc`])];
const facetCatalog = { version: 1, facets: [{ id: 'genre', name: 'Genre' }], nodes: [
  { id: 'drama', facetId: 'genre', name: 'Drama', status: 'active' },
  { id: 'action', facetId: 'genre', name: 'Action', status: 'active' }
] };
const typeLabel = entry => entryContentTypeIds(entry).map(id => ({ video: '视频', image: '图片' })[id] ?? id).join(' · ');
const options = { facetCatalog, typeLabel, projectEntryIds: ['b', 'd', 'a', 'c'] };
const compounds = [{ id: 'group', title: 'Case 2', memberEntryIds: ['c', 'a'], coverVisualId: 'shared',
  customLabels: ['group', 'same'], createdAt: '2026-01-03T00:00:00Z', updatedAt: '2026-04-03T00:00:00Z' }];

function fixture() {
  return [
    { id: 'a', title: 'Case 10', savedAt: '2026-01-01T00:00:00Z', libraryAddedAt: '2026-03-01T00:00:00Z',
      libraryUpdatedAt: '2026-03-04T00:00:00Z', classification: { pathIds: ['image'], status: 'confirmed' },
      customLabels: ['same', 'Alpha'], url: 'https://www.z.example/path',
      facetAssignments: [{ facetId: 'genre', nodeId: 'drama', status: 'confirmed', evidence: 'private evidence' }],
      mediaAssets: [{ id: 'shared', kind: 'image', byteSize: 300 }, { id: 'poster', kind: 'image', usage: 'poster', byteSize: 999 }],
      text: 'private original words', articleDocument: { markdown: 'full article' }, mediaPrompts: [{ text: 'original prompt' }] },
    { id: 'b', title: 'Case 2', savedAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-02T00:00:00Z',
      classification: { pathIds: ['video'], status: 'needs_review' }, customLabels: ['Beta'], url: 'https://b.example/',
      facetAssignments: [{ facetId: 'genre', nodeId: 'action', status: 'suggested' }],
      mediaAssets: [{ id: 'v', kind: 'video', byteSize: 200 }, { id: 'unknown', kind: 'audio' }] },
    { id: 'c', title: 'Case 3', savedAt: '2026-01-02T00:00:00Z', classification: { pathIds: ['video'], status: 'confirmed' },
      customLabels: ['same'], url: 'https://www.a.example/',
      facetAssignments: [{ facetId: 'genre', nodeId: 'action', status: 'confirmed' }],
      analysisCandidates: [{ source: 'vision_model', evidence: 'private inference', tagName: 'private suggestion' }],
      mediaAssets: [{ id: 'shared', kind: 'image', byteSize: 100 },
        { id: 'pdf', kind: 'document', sourceFormat: 'pdf', mimeType: 'application/pdf', byteSize: 50 },
        { id: 'zip', kind: 'attachment', sourceTitle: 'file.zip', mimeType: 'application/zip', byteSize: 60 },
        { id: 'odd', kind: 'attachment', storageMode: 'managed', sourceFormat: 'odd', formatCategory: 'other-source', mimeType: 'application/octet-stream', byteSize: 70 },
        { id: 'local', kind: 'attachment', storageMode: 'reference', recordType: 'local-asset-reference', linkStatus: 'linked',
          importFailure: { code: 'unsupported_format', message: 'unsupported source' }, byteSize: 80 }] },
    { id: 'd', title: 'case 2', savedAt: '2026-02-01T00:00:00+00:00', classification: { pathIds: ['image'] },
      contentTypeIds: ['video', 'image'], customLabels: ['Beta'], url: 'invalid', mediaAssets: [] },
    { id: 'e', title: 'case 2', savedAt: '2026-02-01T00:00:00Z', classification: { pathIds: ['video'] },
      customLabels: ['Beta'], url: 'https://b.example/', analysisCandidates: [{ source: 'deepseek_text', evidence: 'not reusable' }],
      mediaAssets: [{ id: 'dup', kind: 'image', byteSize: 1 }, { id: 'dup', kind: 'image', byteSize: 150 }] }
  ];
}

function metadata(entry, settings = options) {
  const names = new Map(settings.facetCatalog.nodes.map(node => [node.id, node.name]));
  return caseListMetadata(entry, { typeLabel: settings.typeLabel(entry), tagNames: [
    ...(entry.customLabels ?? []), ...(entry.facetAssignments ?? []).filter(item => item.status === 'confirmed')
      .map(item => names.get(item.nodeId)).filter(Boolean)
  ] });
}

function fullOrder(entries, groups, mode, settings = options) {
  const logical = materializeLogicalCases(entries, groups)
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return sortLibraryCases(logical, { mode, projectEntryIds: settings.projectEntryIds, columnValues: e => metadata(e, settings) });
}

for (const mode of modes) test(`browse prefix equals full library for ${mode}, including compounds and missing values`, () => {
  const entries = fixture();
  const expected = fullOrder(entries, compounds, mode);
  const actual = sortBrowseCases(entries.map(caseBrowseProjection), compounds, { ...options, mode });
  assert.deepEqual(actual.map(e => e.id), expected.map(e => e.id));
  assert.deepEqual(actual.map(e => metadata(e)), expected.map(e => metadata(e)));
  for (let length = 1; length <= actual.length; length++) {
    const ids = new Set(actual.slice(0, length).flatMap(e => e.memberEntryIds ?? [e.id]));
    const loaded = fullOrder(entries.filter(e => ids.has(e.id)), compounds, mode);
    assert.deepEqual(loaded.map(e => e.id), expected.slice(0, length).map(e => e.id));
  }
});

test('projection omits original content and owns independent nested values', () => {
  const entry = fixture()[0];
  const original = structuredClone(entry);
  const projected = caseBrowseProjection(entry);
  assert.equal(JSON.stringify(projected).includes('private'), false);
  for (const field of ['text', 'articleDocument', 'mediaPrompts', 'analysisBreakdown']) assert.equal(field in projected, false);
  projected.classification.pathIds.push('changed');
  projected.facetAssignments[0].nodeId = 'changed';
  projected.mediaAssets[0].byteSize = 999;
  projected.customLabels.push('changed');
  assert.deepEqual(entry, original);
});

test('pending, classification and confirmed facet filters survive projection without analysis text', () => {
  const entries = fixture();
  const projected = entries.map(caseBrowseProjection);
  assert.deepEqual(projected.map(isEntryPending), entries.map(isEntryPending));
  for (const filters of [{ pendingOnly: true }, { contentId: 'video' }, { facetSelections: new Map([['genre', new Set(['action'])]]) }]) {
    const expected = filterEntries(materializeLogicalCases(entries, compounds), filters, facetCatalog);
    const actual = filterEntries(materializeLogicalCases(projected, compounds), filters, facetCatalog);
    assert.deepEqual(actual.map(e => e.id), expected.map(e => e.id));
  }
});

test('equal-key order preserves raw savedAt then physical index and compound definition order', () => {
  const entries = ['b', 'a', 'c', 'd', 'e', 'f'].map(id => ({ id, title: 'same', savedAt: '2026-01-01', mediaAssets: [] }));
  const groups = [{ ...compounds[0], id: 'g2', title: 'same', memberEntryIds: ['d', 'c'] },
    { ...compounds[0], id: 'g1', title: 'same', memberEntryIds: ['f', 'e'] }];
  assert.deepEqual(sortBrowseCases(entries.map(caseBrowseProjection), groups, { mode: 'title' }).map(e => e.id), ['b', 'a', 'g2', 'g1']);
  entries[1].savedAt = '2026-02-01';
  assert.deepEqual(sortBrowseCases(entries.map(caseBrowseProjection), groups, { mode: 'title' }).map(e => e.id), ['a', 'b', 'g2', 'g1']);
});

test('current labels and locale callbacks are used after the same projection was stored', () => {
  const entries = fixture();
  const projections = entries.map(caseBrowseProjection);
  const settings = { ...options, typeLabel: e => entryContentTypeIds(e).map(id => id === 'image' ? 'Z' : 'A').join(' · '),
    facetCatalog: { ...facetCatalog, nodes: facetCatalog.nodes.map(node => ({ ...node, name: node.name === 'Action' ? 'ZZZ' : 'AAA' })) } };
  for (const mode of ['type-asc', 'type-desc', 'tags-asc', 'tags-desc']) {
    assert.deepEqual(sortBrowseCases(projections, compounds, { ...settings, mode }).map(e => e.id),
      fullOrder(entries, compounds, mode, settings).map(e => e.id));
  }
});
