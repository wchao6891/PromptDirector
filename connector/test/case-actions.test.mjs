import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../mcp.mjs';
import { receiveWorkspaceScreenshot } from '../transfers.mjs';
import { AGENT_CASE_ACTION_SPECS } from '../../extension/agent-case-action-specs.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64');
function chunks() {
  const metadata = { state: 'captured', screenshotId: 'capture', tabId: 5, surface: 'library', windowId: 2,
    capturedAt: '2026-10-07T00:00:00Z', mimeType: 'image/png', byteSize: png.length };
  const calls = [];
  return { calls, call: async (operation, input) => {
    calls.push({ operation, input });
    const offset = input.offset ?? 0, end = Math.min(png.length, offset + 13);
    return { ...metadata, offset, data: png.subarray(offset, end).toString('base64'), nextOffset: end < png.length ? end : null };
  } };
}

test('recoverable removal MCP schema routes the exact version and request identity', async () => {
  const calls = [];
  const server = createServer(async (operation, input, options) => {
    options.onHostSession?.('session'); calls.push({ operation, input });
    return operation === 'status' ? { capabilities: AGENT_CASE_ACTION_SPECS.map(item => item.name) } : { operation, taskId: 'task', state: 'ready' };
  });
  const values = {
    trash_case: { requestId: 'trash-1', caseId: 'case', expectedRevision: 'revision' }
  };
  try {
    for (const [name, value] of Object.entries(values)) {
      const tool = server._registeredTools[`promptdirector_${name}`];
      const response = await tool.handler(tool.inputSchema.parse(value));
      assert(!response.isError); assert.deepEqual(calls.at(-1), { operation: name, input: value });
      assert.equal(tool.annotations.readOnlyHint, false);
    }
    assert.equal(calls.filter(item => item.operation === 'status').length, 1);
  } finally { await server.close(); }
});

test('an older backend is never sent a recoverable removal it cannot implement', async () => {
  const calls = [];
  const server = createServer(async operation => { calls.push(operation); return { capabilities: [] }; });
  try {
    for (const name of ['trash_case']) {
      const response = await server._registeredTools[`promptdirector_${name}`].handler({});
      assert(response.isError); assert.equal(JSON.parse(response.content[0].text).code, 'unsupported_case_action');
    }
    assert.deepEqual(calls, ['status']);
  } finally { await server.close(); }
});

test('free-text similarity reaches search intact and an older backend cannot silently ignore it', async () => {
  const calls = [];
  let supported = true;
  const server = createServer(async (operation, input) => {
    calls.push({ operation, input });
    return operation === 'status' ? { caseQueryVersion: 1, searchFilters: supported ? ['similarText'] : [] } : { items: [] };
  });
  try {
    const tool = server._registeredTools.promptdirector_search_cases;
    const input = tool.inputSchema.parse({ similarText: '镜头穿过雨夜霓虹，跟随人物进入室内。'.repeat(200), mediaKind: 'video' });
    const response = await tool.handler(input);
    assert(!response.isError); assert.deepEqual(calls.at(-1), { operation: 'search', input });
    supported = false;
    const failed = await tool.handler(input);
    assert(failed.isError); assert.equal(JSON.parse(failed.content[0].text).code, 'unsupported_search_filters');
    assert.equal(calls.filter(item => item.operation === 'search').length, 1);
  } finally { await server.close(); }
});

test('MCP exposes external analysis result workflows without tools that start paid plugin analysis', async () => {
  const server = createServer(async () => ({}));
  try {
    for (const name of ['start_case_analysis', 'read_case_analysis', 'cancel_case_analysis']) {
      assert.equal(server._registeredTools[`promptdirector_${name}`], undefined);
    }
    assert(server._registeredTools.promptdirector_manage_analysis_batch);
    assert(server._registeredTools.promptdirector_submit_analysis_results);
  } finally { await server.close(); }
});

test('screenshot transfer saves complete original PNG bytes and never recaptures for continuation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-workspace-shot-'));
  const transfer = chunks();
  try {
    const result = await receiveWorkspaceScreenshot({ tabId: 5 }, transfer.call, root);
    assert.deepEqual(await readFile(result.path), png);
    assert.deepEqual(Buffer.from(result.image.data, 'base64'), png);
    assert.deepEqual(transfer.calls[0].input, { tabId: 5 });
    assert(transfer.calls.slice(1).every(item => item.input.screenshotId === 'capture' && item.input.offset > 0));
    assert.equal('data' in result, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('inconsistent screenshot frames never produce a local file or image result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-workspace-shot-'));
  const transfer = chunks();
  try {
    await assert.rejects(receiveWorkspaceScreenshot({}, async (operation, input) => {
      const value = await transfer.call(operation, input);
      return input.offset ? { ...value, screenshotId: 'another-frame' } : value;
    }, root), /分块不一致/);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('MCP screenshot returns native image content and public frame metadata, not base64 inside JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-workspace-shot-'));
  const before = process.env.PROMPTDIRECTOR_CONNECTOR_HOME;
  process.env.PROMPTDIRECTOR_CONNECTOR_HOME = root;
  const transfer = chunks(); const server = createServer(transfer.call);
  try {
    const tool = server._registeredTools.promptdirector_capture_workspace;
    const response = await tool.handler(tool.inputSchema.parse({ surface: 'library' }));
    assert(!response.isError, JSON.stringify(response));
    assert.deepEqual(response.content.map(item => item.type), ['text', 'image']);
    assert.deepEqual(Buffer.from(response.content[1].data, 'base64'), png);
    const metadata = JSON.parse(response.content[0].text);
    assert.equal(metadata.tabId, 5); assert.equal(metadata.image, undefined);
    assert.deepEqual(await readFile(metadata.path), png);
  } finally {
    await server.close();
    if (before === undefined) delete process.env.PROMPTDIRECTOR_CONNECTOR_HOME; else process.env.PROMPTDIRECTOR_CONNECTOR_HOME = before;
    await rm(root, { recursive: true, force: true });
  }
});

test('workspace ambiguity and permission failures stay explicit without generating fake images', async () => {
  for (const state of ['choose_workspace', 'not_visible', 'no_workspace']) {
    const server = createServer(async () => ({ state, contexts: [] }));
    try {
      const response = await server._registeredTools.promptdirector_capture_workspace.handler({});
      assert.equal(response.content.length, 1); assert.equal(JSON.parse(response.content[0].text).state, state);
    } finally { await server.close(); }
  }
  const server = createServer(async () => { throw Object.assign(new Error('browser permission required'), { code: 'permission_required' }); });
  try {
    const response = await server._registeredTools.promptdirector_capture_workspace.handler({});
    assert(response.isError); assert.equal(response.content.length, 1); assert.equal(JSON.parse(response.content[0].text).code, 'permission_required');
  } finally { await server.close(); }
});
