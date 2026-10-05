import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaptureSaveProgress, captureSaveProgressPresentation, createCaptureProgressGate } from '../extension/capture-save-progress.js';

test('slow media shows the latest actual bytes without broadcasting every chunk or a stale finished phase', () => {
  const sent = [], timers = new Map(); let time = 0, id = 0;
  const progress = createCaptureSaveProgress({ requestId: 'save-a', send: message => sent.push(message),
    now: () => time, schedule: callback => { timers.set(++id, callback); return id; }, cancel: key => timers.delete(key) });
  progress.stage('download', { kind: 'video', index: 1, count: 2 });
  progress.update({ receivedBytes: 10, totalBytes: 100 });
  progress.update({ receivedBytes: 20, totalBytes: 100 });
  assert.equal(sent.length, 1); assert.equal(timers.size, 1);
  time = 160; [...timers.values()][0]();
  assert.equal(sent.at(-1).progress.receivedBytes, 20);
  progress.update({ receivedBytes: 100, totalBytes: 100 });
  progress.stage('writing');
  assert.equal(timers.size, 0);
  assert.equal(captureSaveProgressPresentation(sent.at(-1).progress).total, undefined);
  progress.close(); progress.update({ receivedBytes: 100 }); progress.stage('verify');
  assert.equal(sent.length, 3);
});

test('missing totals stay unknown and file completion cannot label the whole save completed', () => {
  const known = captureSaveProgressPresentation({ phase: 'download', kind: 'video', index: 2, count: 3, receivedBytes: 1048576, totalBytes: 2097152 });
  assert.equal(known.completed, 1048576); assert.equal(known.total, 2097152);
  assert.match(known.message, /视频 2\/3.*1 MiB \/ 2 MiB.*50%/);
  const unknown = captureSaveProgressPresentation({ phase: 'download', receivedBytes: 1048576 });
  assert.match(unknown.message, /1 MiB/); assert.doesNotMatch(unknown.message, /%/); assert.equal(unknown.total, undefined);
  const saving = captureSaveProgressPresentation({ phase: 'writing', receivedBytes: 100, totalBytes: 100 });
  assert.equal(saving.total, undefined); assert.doesNotMatch(saving.message, /100%|已保存/);
});

test('late progress from another save or an earlier phase cannot replace the current receipt', () => {
  const gate = createCaptureProgressGate(); gate.begin('current');
  const event = { type: 'CAPTURE_SAVE_PROGRESS', requestId: 'current', sequence: 20 };
  assert.equal(gate.accept(event), true);
  assert.equal(gate.accept({ ...event, sequence: 19 }), false);
  assert.equal(gate.accept({ ...event, requestId: 'previous', sequence: 21 }), false);
  gate.end(); assert.equal(gate.accept({ ...event, sequence: 22 }), false);
  gate.begin('next'); assert.equal(gate.accept({ ...event, requestId: 'next', sequence: 25 }), true);
});

test('closing the collector or failing to deliver progress cannot break media saving', async () => {
  const progress = createCaptureSaveProgress({ requestId: 'save', send: () => Promise.reject(new Error('No receiving end')) });
  assert.doesNotThrow(() => progress.stage('download'));
  await new Promise(resolve => setImmediate(resolve));
  progress.close();
});
