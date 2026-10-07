import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../mcp.mjs';
import { saveAgentMaterial } from '../../extension/agent-save.js';
import { buildEntry } from '../../extension/lib.js';
import { createDefaultTaxonomy } from '../../extension/taxonomy.js';

const materialFields = ['creative', 'customLabels', 'classificationPathIds', 'sourceFacts', 'timeNotes'];
const authored = {
  creative: { prompt: '新的创作词', summary: '摘要', notes: '必须保留的反馈', purpose: '广告', plan: '下一镜' },
  customLabels: ['已选参考'], classificationPathIds: ['content:video-case'],
  sourceFacts: { author: '原始作者', originalPromptAvailable: true, engagement: { likes: 12 } },
  timeNotes: [{ assetId: 'original-video', startMs: 200, endMs: 500, text: '完整片段备注' }]
};

test('MCP input validation and handler preserve all authored fields through the real material save and readback', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pd-material-fields-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'video.mp4'); await writeFile(path, 'original fixture bytes');
  const state = { entries: [], organizerState: { collections: [] }, taxonomy: createDefaultTaxonomy() };
  const records = new Map();
  const server = createServer(async (operation, input) => {
    if (operation === 'status') return { materialFields };
    if (operation === 'begin_transfer') {
      records.set(input.id, { ...input, state: 'ready', assetId: 'original-video', prepared: {
        asset: { id: 'original-video', kind: 'video', storageMode: 'managed', mimeType: 'video/mp4', byteSize: input.byteSize }
      } });
      return { state: 'ready' };
    }
    if (operation === 'finish_transfer') return { state: 'ready' };
    assert.equal(operation, 'save_material');
    const result = await saveAgentMaterial(input, input.requestId, {
      loadState: async () => structuredClone(state), buildEntry, classify: () => ({}), schemaVersion: 1,
      transfers: { get: async id => records.get(id), key: id => `transfer:${id}` },
      storage: { get: async key => ({ [key]: state[key] }) }, getInstanceId: async () => 'fixture',
      place: organizer => organizer, commit: async update => Object.assign(state, structuredClone(update)), notify: async () => {}
    });
    return { state: 'completed', result };
  });
  try {
    const tool = server._registeredTools.promptdirector_save_material;
    const input = tool.inputSchema.parse({ requestId: 'save-fields', title: '回存', text: '完整原文',
      files: [{ path, mimeType: 'video/mp4' }], ...authored });
    const response = await tool.handler(input);
    assert(!response.isError, JSON.stringify(response));
    assert.equal(JSON.parse(response.content[0].text).state, 'completed');
    const saved = structuredClone(state.entries[0]);
    assert.deepEqual(saved.creative, authored.creative);
    assert.deepEqual(saved.customLabels, authored.customLabels);
    assert.deepEqual(saved.classification.pathIds, authored.classificationPathIds);
    for (const [key, value] of Object.entries(authored.sourceFacts)) assert.deepEqual(saved.sourceFacts[key], value);
    for (const [key, value] of Object.entries(authored.timeNotes[0])) assert.deepEqual(saved.timeNotes[0][key], value);
    assert.equal(saved.text, '完整原文');
  } finally { await server.close(); }
});

test('unsupported material fields fail before file upload or a misleading save to an older backend', async () => {
  const calls = [];
  const server = createServer(async operation => { calls.push(operation); return { materialFields: [] }; });
  try {
    const tool = server._registeredTools.promptdirector_save_material;
    for (const field of materialFields) {
      const input = tool.inputSchema.parse({ requestId: 'old-backend', title: '回存', text: '完整原文',
        files: [{ path: '/must-not-read/video.mp4', mimeType: 'video/mp4' }], [field]: authored[field] });
      const response = await tool.handler(input);
      assert(response.isError);
      assert.equal(JSON.parse(response.content[0].text).code, 'unsupported_material_fields');
    }
    assert.deepEqual(calls, materialFields.map(() => 'status'));
    assert.equal(tool.inputSchema.safeParse({ requestId: 'invalid', title: '回存', creative: { notes: 42 } }).success, false);
  } finally { await server.close(); }
});
