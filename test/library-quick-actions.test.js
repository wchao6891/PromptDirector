import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFilename } from '../extension/library-quick-actions.js';

test('download keeps the original format and safe filename without a conversion', () => {
  const asset = { id: 'image', kind: 'image', mimeType: 'image/png', sourceTitle: '参考.png' };
  assert.equal(copyFilename(asset, '案例', 0, {type:'image/png'}), '参考.png');
  assert.equal(copyFilename({...asset, sourceTitle:'../参考.png'}, '案例', 0), '参考.png');
  assert.equal(copyFilename({...asset, sourceTitle:'CON.png'}, '案例', 0), '_CON.png');
  assert.equal(copyFilename({...asset, sourceTitle:''}, '案例', 2), '案例-3.png');
});

test('download format follows actual saved blob instead of an inconsistent title', () => {
  const asset = { id:'image',kind:'image',mimeType:'image/png',sourceTitle:'参考.png' };
  assert.equal(copyFilename(asset, '案例', 0, {type:'image/webp'}), '参考.png.webp');
});
