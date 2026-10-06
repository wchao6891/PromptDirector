import test from 'node:test';
import assert from 'node:assert/strict';
import { groupGenericCapture } from '../extension/generic-capture-groups.js';
import { normalizePageCaptureCandidate, normalizePageCaptureBatch, applyPageCaptureSelections } from '../extension/page-capture.js';

const heading = (id, text, level = 2) => ({ id, kind: 'heading', text, level });
const text = (id, text) => ({ id, kind: 'paragraph', text });
const image = id => ({ id: `block:${id}`, kind: 'image', assetId: id });
function fixture(blocks, extra = {}) {
  return normalizePageCaptureCandidate({ id: 'article', adapter: 'generic', title: 'References', pageType: 'article',
    canonicalUrl: 'https://example.test/references', sourceFacts: { itemId: 'references', author: 'Author' },
    completeness: 'partial', extraction: { textTruncated: true },
    articleDocument: { blocks: blocks.map((b, sourceOrder) => ({ ...b, sourceOrder })) },
    media: blocks.filter(b => b.assetId).map(b => ({ id: b.assetId, kind: b.kind, url: `https://example.test/${b.assetId}.gif`, placement: 'inline' })),
    ...extra });
}
function mediaIds(groups) { return groups.flatMap(g => g.media.map(m => m.id)); }

test('ordinary sections need no prompt keywords; blank descriptions and all originals survive normalization and save selection', () => {
  const input = fixture([text('intro', 'Shared introduction'), heading('a', '1980s'), text('about-a', 'First era'), image('a1'), image('a2'), heading('b', '1990s'), image('b1')]);
  const groups = groupGenericCapture(input, 'sections');
  assert.deepEqual(groups.map(g => g.title), ['1980s', '1990s', '未分组内容 · References']);
  assert.deepEqual(groups.map(g => g.media.map(m => m.id)), [['a1', 'a2'], ['b1'], []]);
  assert.equal(groups[0].contentText, '1980s\n\nFirst era');
  assert.ok(groups.every(g => g.completeness === 'partial' && g.extraction.textTruncated));
  const batch = normalizePageCaptureBatch({ adapter: 'generic', candidates: groups,
    selections: groups.map(g => ({ candidateId: g.id, includeText: true, selectedMediaIds: g.media.map(m => m.id), mediaDecision: 'confirmed' })) });
  const saved = applyPageCaptureSelections(batch);
  assert.equal(saved[0].contentText, groups[0].contentText);
  assert.deepEqual(mediaIds(saved), ['a1', 'a2', 'b1']);
});

test('a specialized adapter is never regrouped, even on an explicit generic grouping request', () => {
  for (const adapter of ['wechat', 'x', 'jimeng', 'feishu', 'pinterest']) {
    const input = fixture([heading('a', 'One'), image('a'), heading('b', 'Two'), image('b')], { adapter });
    assert.deepEqual(groupGenericCapture(input, 'sections'), [input]);
    assert.deepEqual(groupGenericCapture(input, 'media'), [input]);
  }
});

test('single work and text-only documents remain usable when no boundary is established', () => {
  for (const blocks of [[heading('h', 'A work'), image('a'), image('b')], [heading('h', 'Instructions'), text('p', 'Step one')]]) {
    const input = fixture(blocks);
    assert.deepEqual(groupGenericCapture(input, 'sections'), [input]);
    assert.deepEqual(groupGenericCapture(input, 'whole'), [input]);
  }
});

test('nested groups stop at their parent boundary without stealing the next introduction', () => {
  const input = fixture([heading('p1', 'Chapter one', 1), heading('a', 'Example A'), image('a'), heading('b', 'Example B'), image('b'), heading('p2', 'Chapter two', 1), text('next-intro', 'Next introduction')]);
  const groups = groupGenericCapture(input, 'sections');
  assert.equal(groups[1].contentText, 'Example B');
  assert.ok(groups.at(-1).contentText.includes('Next introduction'));
});

test('one animated asset stays one case; shared prose, unplaced media and files stay reviewable', () => {
  const input = fixture([heading('h', '1980s'), text('shared', 'History, not a generated prompt'), image('a'), image('b')]);
  input.media[0].alt = 'Film A';
  input.media[0].variants = [{ url: 'https://example.test/a.gif' }, { url: 'https://example.test/a.webp' }];
  input.media[0].originalPrompt = 'Explicit original prompt';
  input.media.push({ id: 'unplaced', kind: 'video', url: 'https://example.test/film.mp4', placement: 'unplaced' }, { id: 'pdf', kind: 'document', url: 'https://example.test/notes.pdf' });
  const groups = groupGenericCapture(input, 'media');
  assert.equal(groups.length, 4);
  assert.equal(groups[0].title, '1980s · Film A');
  assert.equal(groups[0].contentText, 'Explicit original prompt');
  assert.equal(groups[1].contentText, '');
  assert.equal(groups[0].media[0].variants.length, 2);
  assert.ok(groups.at(-1).contentText.includes('History, not a generated prompt'));
  assert.deepEqual(mediaIds(groups).sort(), ['a', 'b', 'pdf', 'unplaced']);
});

test('table cell text and media stay in their section; grouping never loses unplaced originals', () => {
  const input = fixture([heading('a', 'First'), { id: 'table', kind: 'table', rows: [[{ blockIds: ['cell-text', 'block:inside'] }]] }, text('cell-text', 'Cell text'), image('inside'), heading('b', 'Second'), image('b')]);
  input.media.push({ id: 'unplaced', kind: 'image', url: 'https://example.test/outside.png' });
  const groups = groupGenericCapture(input, 'sections');
  assert.equal(groups[0].articleDocument.blocks.find(b => b.kind === 'table').text, 'Cell text');
  assert.deepEqual(mediaIds(groups), ['inside', 'b', 'unplaced']);
  assert.deepEqual(groups.at(-1).media.map(m => m.id), ['unplaced']);
});

test('warnings and unread supplements remain reviewable even when every block belongs to a section', () => {
  const input = fixture([heading('a', 'One'), image('a'), heading('b', 'Two'), image('b')]);
  input.possibleOmissions = [{ id: 'warning', text: 'More content may exist' }];
  input.supplements = [{ id: 'supplement', text: 'Unconfirmed source text' }];
  const groups = groupGenericCapture(input, 'sections');
  assert.equal(groups.at(-1).batchStructureStatus, 'review');
  assert.deepEqual(groups.at(-1).possibleOmissions, input.possibleOmissions);
  assert.deepEqual(groups.at(-1).supplements, input.supplements);
});

test('removing a previewed list or repeated paragraph removes exactly the clicked text from what is saved', async () => {
  const { removeCaptureTextBlock } = await import('../extension/generic-capture-groups.js');
  const candidate = { id: 'page', contentHtml: '<ul><li>one</li></ul>',
    // Scanning yields one text block per list item; the document holds one list block.
    textBlocks: [{ id: 't0', text: 'Repeated', sourceOrder: 0 }, { id: 't1', text: 'first item', sourceOrder: 1 },
      { id: 't2', text: 'second item', sourceOrder: 2 }, { id: 't3', text: 'Repeated', sourceOrder: 3 }],
    articleDocument: { version: 1, blocks: [{ id: 't0', kind: 'paragraph', text: 'Repeated', sourceOrder: 0 },
      { id: 'list', kind: 'list', text: 'first item\nsecond item', sourceOrder: 1 }, { id: 't3', kind: 'paragraph', text: 'Repeated', sourceOrder: 2 }] } };
  const withoutList = removeCaptureTextBlock(candidate, 'list');
  assert.deepEqual(withoutList.textBlocks.map(b => b.id), ['t0', 't3']);
  assert.equal(withoutList.contentText, 'Repeated\n\nRepeated');
  assert.equal(withoutList.contentHtml, '', 'the original full HTML no longer matches the edited text');
  assert.deepEqual(removeCaptureTextBlock(candidate, 't3').textBlocks.map(b => b.id), ['t0', 't1', 't2'], 'the clicked duplicate, not the first');
});
