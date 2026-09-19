import test from 'node:test';
import assert from 'node:assert/strict';
import { readPageCaptureSupplement } from '../extension/capture-supplement.js';

const item = { id: 'reply', sourceUrl: 'https://x.com/director/status/124', text: 'preview', partial: true };
function fixture(result, failure) {
  const calls = [];
  const event = { addListener() {}, removeListener() {} };
  const api = {
    permissions: { contains: async () => true },
    tabs: {
      onUpdated: event, onRemoved: event,
      create: async value => { calls.push(['create', value]); return { id: 2 }; },
      get: async () => ({ id: 2, status: 'complete', url: item.sourceUrl }),
      remove: async id => calls.push(['remove', id])
    },
    scripting: { executeScript: async value => { calls.push(['read', value.args]); if (failure) throw failure; return [{ result }]; } }
  };
  return { api, calls };
}

test('selected comment is read in an inactive temporary tab and keeps its identity and full text', async () => {
  const full = 'Full prompt\n'.repeat(2000);
  const { api, calls } = fixture({ supplement: { sourceUrl: item.sourceUrl, text: full, partial: false } });
  const result = await readPageCaptureSupplement(item, api);
  assert.equal(result.id, item.id);
  assert.equal(result.text, full);
  assert.deepEqual(calls[0], ['create', { url: item.sourceUrl, active: false }]);
  assert.deepEqual(calls.at(-1), ['remove', 2]);
  assert.equal(item.text, 'preview');
});

test('unavailable, truncated or substituted replies fail without returning a preview as success', async () => {
  for (const result of [{}, { supplement: { ...item } }, { supplement: { ...item, partial: false, sourceUrl: 'https://x.com/other/status/456' } }]) {
    const { api, calls } = fixture(result);
    await assert.rejects(readPageCaptureSupplement(item, api), /全文/);
    assert.deepEqual(calls.at(-1), ['remove', 2]);
  }
  const { api, calls } = fixture(null, new Error('site unavailable'));
  await assert.rejects(readPageCaptureSupplement(item, api), /site unavailable/);
  assert.deepEqual(calls.at(-1), ['remove', 2]);
});

test('invalid origins and missing site permission cannot open a background page', async () => {
  const { api, calls } = fixture({});
  await assert.rejects(readPageCaptureSupplement({ ...item, sourceUrl: 'https://example.com/status/124' }, api), /有效/);
  api.permissions.contains = async () => false;
  await assert.rejects(readPageCaptureSupplement(item, api), /授权/);
  assert.deepEqual(calls, []);
});
