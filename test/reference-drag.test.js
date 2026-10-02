import test from 'node:test';
import assert from 'node:assert/strict';
import { setPdReferenceDragData, parsePdReference, pdReferenceLink } from '../extension/pd-reference.js';

function transfer() {
  const data = new Map([['text/plain', 'stale thumbnail']]);
  return { data, clearData: () => data.clear(), setData: (key, value) => data.set(key, value) };
}
test('a card names the whole case and carries its library identity even when two cases have the same title', () => {
  const a = transfer(), b = transfer();
  const reference = setPdReferenceDragData(a, { libraryId: 'library', caseId: 'multi', name: '同名案例' });
  setPdReferenceDragData(b, { libraryId: 'library', caseId: 'compound', name: '同名案例' });
  assert.equal(a.data.get('text/plain'), `[同名案例](${reference})`);
  assert.equal(a.data.get('text/html'), `<a href="${reference.replaceAll('&', '&amp;')}">同名案例</a>`);
  assert.notEqual(a.data.get('text/plain'), b.data.get('text/plain'));
  assert.deepEqual(parsePdReference(reference), { libraryId: 'library', caseId: 'multi', assetId: '' });
  assert(!a.data.has('DownloadURL'), 'a video card must not export its poster as the video');
});
test('specific image drag retains original canvas/file payload while exposing the exact media name and reference', () => {
  const value = transfer(), url = 'blob:original-image';
  const reference = setPdReferenceDragData(value, { libraryId: 'library', caseId: 'multi', assetId: 'image-2', name: '角色 [修订].png',
    file: { kind: 'image', url, mimeType: 'image/png', name: '角色 [修订].png' } });
  assert.equal(parsePdReference(reference).assetId, 'image-2');
  assert.equal(value.data.get('text/plain'), url, 'file receivers must retain the original URI flavor');
  assert.equal(value.data.get('text/uri-list'), url);
  assert.equal(value.data.get('DownloadURL'), `image/png:角色 [修订].png:${url}`);
  assert.deepEqual(JSON.parse(value.data.get('application/x-promptdirector-file')), { url, mimeType: 'image/png', name: '角色 [修订].png' });
  assert(value.data.get('text/html').includes('<img src="blob:original-image"'), 'canvas receivers need the original image HTML flavor');
  assert(value.data.get('text/html').includes('hidden'), 'rich-text hosts should omit the file carrier from visible name content');
  assert(!value.data.get('text/plain').includes('对应画面'));
});
test('HTTP name links survive protocol filtering and resolve without visiting the source website', () => {
  const value = transfer();
  const reference = setPdReferenceDragData(value, { libraryId: 'library', caseId: 'compound', assetId: 'image', name: '组合案例',
    linkBase: 'https://example.org/source(draft)?original=1#old-position',
    file: { kind: 'image', url: 'blob:original', mimeType: 'image/png', name: 'image.png' } });
  const html = value.data.get('text/html');
  const href = html.match(/href="([^"]+)"/)[1].replaceAll('&amp;', '&');
  assert.equal(new URL(href).protocol, 'https:');
  assert.equal(new URL(href).search, '?original=1');
  assert.equal(new URL(href).pathname, '/source%28draft%29', 'source parentheses must not break the plain-text Markdown link');
  assert.deepEqual(parsePdReference(href), parsePdReference(reference));
  assert.equal(value.data.get('application/x-promptdirector-reference'), reference);
  assert.equal(value.data.get('text/plain'), 'blob:original');
  assert.equal(value.data.get('text/uri-list'), 'blob:original');
  assert.equal(value.data.get('DownloadURL'), 'image/png:image.png:blob:original');
  assert(html.startsWith(`<a href="${href.replaceAll('&', '&amp;')}">组合案例</a>`));
  assert(html.includes('<img src="blob:original" hidden'));
});
test('name-link wrappers reject ambiguous or unsafe references', () => {
  const ref = 'promptdirector://reference?v=1&library=library&case=case';
  for (const base of ['javascript:bad', 'https://user:password@example.org']) assert.throws(() => pdReferenceLink(ref, base));
  for (const link of ['https://example.org', 'https://example.org#pd-reference=javascript:bad',
      `https://example.org#pd-reference=${encodeURIComponent(ref)}&pd-reference=${encodeURIComponent(ref)}`,
      `https://example.org#pd-reference=${encodeURIComponent(ref)}&other=1`]) assert.throws(() => parsePdReference(link));
});
test('untrusted case names cannot inject markup into the external drag', () => {
  const value = transfer();
  setPdReferenceDragData(value, { libraryId: 'library', caseId: 'case', name: '<img onerror="bad">\n' });
  assert(!value.data.get('text/html').includes('<img'));
  assert(value.data.get('text/html').includes('&lt;img onerror=&quot;bad&quot;&gt;'));
});
