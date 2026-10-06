import test from 'node:test';
import assert from 'node:assert/strict';
import { genericDetailRequests, applyGenericCaptureDetails, remapDetailTextSelection, collectGenericCaptureDetails } from '../extension/generic-capture-details.js';
import { groupGenericCapture } from '../extension/generic-capture-groups.js';
import { normalizePageCaptureCandidate, applyPageCaptureSelections, combinePageCaptureCandidates } from '../extension/page-capture.js';

const request = { url: 'https://example.com/detail/1', fragment: true };
function snapshot() {
  return { adapter: 'generic', candidates: [{ id: 'page', adapter: 'generic', title: 'Collection', canonicalUrl: 'https://example.com/collection',
    media: [{ id: 'a', kind: 'image', url: 'https://example.com/a.png', detailRequests: [request] }],
    articleDocument: { blocks: [
      { id: 'h1', kind: 'heading', text: 'One', level: 2, sourceOrder: 0 },
      { id: 'm1', kind: 'image', assetId: 'a', sourceOrder: 1 },
      { id: 'h2', kind: 'heading', text: 'Two', level: 2, sourceOrder: 2 },
      { id: 'm2', kind: 'image', assetId: 'a', sourceOrder: 3 }
    ] }, completeness: 'complete' }] };
}
const detail = { url: request.url, title: 'The work', blocks: [{ kind: 'paragraph', text: 'Director: Original creator' }], originalWorkUrl: 'https://original.example/work' };
test('generic details do not invoke or modify dedicated adapters', () => {
  const input = { ...snapshot(), adapter: 'jimeng' };
  assert.deepEqual(genericDetailRequests(input), []);
  assert.equal(applyGenericCaptureDetails(input, [detail]), input);
});
test('a shared original keeps its own metadata in each section and once in a standalone case', () => {
  const input = snapshot();
  assert.equal(genericDetailRequests(input).length, 1);
  const c = normalizePageCaptureCandidate(applyGenericCaptureDetails(input, [detail]).candidates[0]);
  const sections = groupGenericCapture(c, 'sections');
  assert.deepEqual(sections.map(g => g.title), ['One', 'Two']);
  assert.ok(sections.every(g => g.contentText.includes('Original creator')));
  const clip = groupGenericCapture(c, 'media').find(g => g.media.length);
  assert.equal(clip.media.length, 1);
  assert.equal(clip.articleDocument.blocks.filter(b => b.assetId).length, 1);
  assert.equal(clip.contentText.match(/Original creator/g).length, 1);
  assert.match(clip.title, /One.*Two.*The work/);
});
test('an unavailable detail retains the original and exposes the omission', () => {
  const before = snapshot();
  const c = normalizePageCaptureCandidate(applyGenericCaptureDetails(before, [{ url: request.url, error: 'Not available' }]).candidates[0]);
  assert.equal(c.media.length, 1);
  assert.equal(c.completeness, 'partial');
  assert.match(c.possibleOmissions[0].text, /Not available/);
  assert.equal(before.candidates[0].completeness, 'complete');
});
test('unplaced media still saves the verified detail without inventing a section', () => {
  const before = snapshot(); before.candidates[0].articleDocument = null;
  const c = normalizePageCaptureCandidate(applyGenericCaptureDetails(before, [detail]).candidates[0]);
  assert.ok(c.articleDocument.blocks.some(b => b.assetId === 'a'));
  assert.match(groupGenericCapture(c, 'media')[0].contentText, /Original creator/);
});

test('reading details keeps a selected bulleted prompt whose scanned items became one list block', () => {
  const page = {
    id: 'page', adapter: 'generic', title: 'Collection', canonicalUrl: 'https://example.com/collection',
    media: [{ id: 'a', kind: 'image', url: 'https://example.com/a.png', detailRequests: [request] }],
    // Scanning produced one block per <li>; the article document holds one block for the whole <ul>.
    textBlocks: [
      { id: 'text:0:x', kind: 'section', text: 'cinematic close-up', sourceOrder: 0 },
      { id: 'text:1:y', kind: 'section', text: 'soft rim light', sourceOrder: 1 },
      { id: 'text:2:z', kind: 'section', text: 'Unwanted footer', sourceOrder: 2 }
    ],
    articleDocument: { blocks: [
      { id: 'article:text:0:list', kind: 'list', text: 'cinematic close-up\nsoft rim light', sourceOrder: 0 },
      { id: 'm1', kind: 'image', assetId: 'a', sourceOrder: 1 },
      { id: 'text:2:z', kind: 'paragraph', text: 'Unwanted footer', sourceOrder: 2 }
    ] }, completeness: 'complete' };
  const enriched = applyGenericCaptureDetails({ adapter: 'generic', candidates: [page] }, [detail]).candidates[0];
  const selection = { candidateId: 'page', includeText: true, selectedTextBlockIds: ['text:0:x', 'text:1:y'], selectedMediaIds: ['a'], mediaDecision: 'confirmed' };
  const remapped = remapDetailTextSelection(page, enriched, selection);
  const saved = applyPageCaptureSelections({ candidates: [enriched], selections: [remapped] })[0];
  assert.match(saved.contentText, /cinematic close-up/, 'the selected list prompt must be saved');
  assert.match(saved.contentText, /Original creator/, 'detail text follows the selected media');
  assert.doesNotMatch(saved.contentText, /Unwanted footer/, 'text the user excluded stays excluded');
});

test('a detail page attaches once, to the media it actually shows, not to every thumbnail linking there', () => {
  const post = { url: 'https://example.com/post/1', fragment: false };
  const thumbs = ['a', 'b', 'c', 'd'].map(id => ({ id, kind: 'image', url: `https://example.com/${id}.png`, detailRequests: [post] }));
  const page = { id: 'page', adapter: 'generic', title: 'Collection', canonicalUrl: 'https://example.com/collection', media: thumbs,
    articleDocument: { blocks: thumbs.map((m, i) => ({ id: `m-${m.id}`, kind: 'image', assetId: m.id, sourceOrder: i })) }, completeness: 'complete' };
  assert.deepEqual(genericDetailRequests({ adapter: 'generic', candidates: [page] })[0].sources.length, 4);
  const result = { url: post.url, title: 'Post', blocks: [{ kind: 'paragraph', text: 'Only the post text' }],
    originalWorkUrl: 'https://original.example/c', matchedSources: ['https://example.com/c.png'] };
  const c = normalizePageCaptureCandidate(applyGenericCaptureDetails({ adapter: 'generic', candidates: [page] }, [result]).candidates[0]);
  assert.equal(c.contentText.match(/Only the post text/g).length, 1, 'shared detail text must not repeat per thumbnail');
  assert.deepEqual(c.media.map(m => m.detailBlockIds.length > 0), [false, false, true, false]);
  assert.deepEqual(c.media.map(m => m.originalWorkUrl || ''), ['', '', 'https://original.example/c', '']);
  const groups = groupGenericCapture(c, 'media');
  assert.match(groups.find(g => g.media[0]?.id === 'c').contentText, /Only the post text/);
  assert.doesNotMatch(groups.find(g => g.media[0]?.id === 'a').contentText, /Only the post text/);
});

test('combining groups keeps per-media detail text and original-work links for a later media split', () => {
  const c = normalizePageCaptureCandidate(applyGenericCaptureDetails(snapshot(), [{ ...detail, matchedSources: ['https://example.com/a.png'] }]).candidates[0]);
  const other = normalizePageCaptureCandidate({ id: 'other', adapter: 'generic', title: 'Other', canonicalUrl: 'https://example.com/other',
    media: [{ id: 'b', kind: 'image', url: 'https://example.com/b.png' }], articleDocument: { blocks: [{ id: 'mb', kind: 'image', assetId: 'b', sourceOrder: 0 }] } });
  const combined = combinePageCaptureCandidates([c, other], { title: 'Merged', canonicalUrl: 'https://example.com/collection' });
  const a = combined.media.find(m => m.id === 'a');
  assert.equal(a.originalWorkUrl, 'https://original.example/work', 'a read original-work link is not replaced by the page URL');
  assert.equal(a.sourceTitle, 'The work');
  assert.equal(combined.media.find(m => m.id === 'b').originalWorkUrl, 'https://example.com/other', 'missing provenance is still filled');
  const ids = new Set(combined.articleDocument.blocks.map(b => b.id));
  assert.ok(a.detailBlockIds.length && a.detailBlockIds.every(id => ids.has(id)), 'detail links follow renamed blocks');
  const split = groupGenericCapture(combined, 'media');
  assert.match(split.find(g => g.media[0]?.id === 'a').contentText, /Original creator/);
  assert.doesNotMatch(split.find(g => g.batchStructureStatus === 'review')?.contentText || '', /Original creator/);
});

test('one slow detail page times out alone without stopping the rest of the batch', async () => {
  const saved = { location: globalThis.location, fetch: globalThis.fetch, chrome: globalThis.chrome };
  globalThis.location = { origin: 'https://example.com' };
  globalThis.chrome = undefined;
  globalThis.fetch = (url, { signal }) => url.endsWith('/slow')
    ? new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    : Promise.resolve({ ok: false, status: 404, headers: new Map() });
  try {
    const results = await collectGenericCaptureDetails([{ url: 'https://example.com/slow' }, { url: 'https://example.com/next' }],
      { sessionId: 's', requestId: 'r', concurrency: 1, timeoutMs: 20, maxBytes: 1000 });
    assert.deepEqual(results.map(r => r.error), ['详情读取超时', '详情暂时不可读取']);
  } finally { Object.assign(globalThis, saved); }
});
