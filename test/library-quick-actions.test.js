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

test('dragged or downloaded media is named after the case, not a descriptive caption', () => {
  const poster = { id: 'poster', kind: 'image', mimeType: 'image/jpeg', sourceTitle: '雨夜追逐 视频封面' };
  assert.equal(copyFilename(poster, '雨夜追逐', 0), '雨夜追逐-1.jpg');
  assert.equal(copyFilename({ ...poster, sourceTitle: '剪贴板' }, '雨夜追逐', 1), '雨夜追逐-2.jpg');
  assert.equal(copyFilename({ ...poster, sourceTitle: 'take_03.jpg' }, '雨夜追逐', 0), 'take_03.jpg');
});
