import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceUrlCache } from '../extension/resource-url-cache.js';

test('small visited previews use actual bytes rather than decoded-pixel entry quotas', () => {
  const cache = new ResourceUrlCache({ maxBytes: 1024, protectedValue: () => false });
  const first = cache.create('first', new Blob(['x']));
  for (let i = 0; i < 100; i++) cache.create(i, new Blob(['x']));
  assert.equal(cache.get('first'), first);
  assert.equal(cache.size, 101);
  for (const key of [...cache.keys()]) cache.delete(key);
  assert.equal(cache.sizes.size, 0);
});

test('aliases share one file budget; mounted and incoming URLs survive pressure until released', async () => {
  const protectedUrls = new Set();
  const cache = new ResourceUrlCache({ maxBytes: 3, protectedValue: url => protectedUrls.has(url) });
  const first = cache.create('first', new Blob(['abc']));
  cache.set('alias', first);
  assert.equal(cache.size, 2);
  protectedUrls.add(first);
  const second = cache.create('second', new Blob(['xyz']));
  assert.equal(await (await fetch(first)).text(), 'abc');
  assert.equal(cache.get('second'), second);
  protectedUrls.clear(); cache.trim();
  assert.equal(cache.has('first'), false);
  assert.equal(cache.has('alias'), false);
  await assert.rejects(fetch(first));
  cache.delete('second');
  assert.equal(cache.sizes.size, 0);
});
