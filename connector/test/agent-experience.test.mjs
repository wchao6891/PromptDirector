import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from '../mcp.mjs';
import { AGENT_INSTRUCTIONS, TOOL_TITLES } from '../agent-guidance.mjs';
import { createCaseOperations } from '../../extension/case-operations.js';

test('a fresh host receives quiet workflow instructions and readable tool names without any library connection', async () => {
  const client = new Client({ name: 'experience-contract', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('../mcp.mjs', import.meta.url))] }));
    assert.equal(client.getInstructions(), AGENT_INSTRUCTIONS);
    const { tools } = await client.listTools();
    for (const tool of tools) {
      assert.equal(tool.title, TOOL_TITLES[tool.name.replace('promptdirector_', '')]);
      assert(tool.title && !tool.title.includes('_'));
    }
    const control = tools.find(tool => tool.name === 'promptdirector_control_workspace');
    assert(!control.inputSchema.properties.action.enum.includes('present_candidates'));
    assert(control.inputSchema.properties.action.enum.includes('open_case'));
    const details = tools.find(tool => tool.name === 'promptdirector_read_case_details');
    assert(details.inputSchema.properties.parts.items.enum.includes('document'));
    const skill = tools.find(tool => tool.name === 'promptdirector_save_skill');
    assert.match(skill.inputSchema.properties.description.description, /仅文字模式/);
    assert.match(skill.inputSchema.properties.portableId.description, /SKILL.md/);
  } finally { await client.close(); }
});

test('the actual MCP schema and handler combine three complete case sections into one library read', async () => {
  let loads = 0, calls = 0;
  const entry = { id: 'case', title: '完整参考', text: '原词保持完整', mediaAssets: [
    { id: 'frame', kind: 'image', derivedFromAssetId: 'video', frameTimeMs: 21373, capturedAt: '2026-10-05T03:10:50Z' }
  ], url: 'https://example.com/source' };
  const operations = createCaseOperations({ loadState: async () => { loads++; return { entries: [entry] }; }, enqueue: fn => fn() });
  const server = createServer(async (name, input) => {
    calls++; assert.equal(name, 'read_case_details'); return operations.read(input);
  });
  try {
    const tool = server._registeredTools.promptdirector_read_case_details;
    const invoke = async input => {
      const response = await tool.handler(tool.inputSchema.parse(input));
      assert(!response.isError, JSON.stringify(response));
      assert.deepEqual(response.content[0].annotations.audience, ['assistant']);
      return JSON.parse(response.content[0].text);
    };
    const parts = ['overview', 'source', 'media'];
    const separate = {};
    for (const part of parts) separate[part] = JSON.parse((await invoke({ caseId: 'case', part })).content);
    assert.equal(loads, 3); assert.equal(calls, 3);
    loads = 0; calls = 0;
    const combined = await invoke({ caseId: 'case', parts });
    assert.equal(loads, 1); assert.equal(calls, 1);
    assert.deepEqual(JSON.parse(combined.content), separate);
    assert.equal(JSON.parse(combined.content).media[0].frameTimeMs, 21373);
  } finally { await server.close(); }
});

test('three selected cases reach the MCP caller in one bridge request and continuations do not rebuild their material', async () => {
  const { createReferenceSelection, REFERENCE_SELECTION_KEY } = await import('../../extension/reference-selection.js');
  const { CASE_LIBRARY_REVISION_KEY } = await import('../../extension/library-storage.js');
  const entries = ['a', 'b', 'c'].map(id => ({ id, title: id, text: `完整原词${id}`.repeat(100), mediaAssets: [] }));
  const stored = { [REFERENCE_SELECTION_KEY]: { version: 1, revision: 1, caseIds: ['a', 'b', 'c'] }, [CASE_LIBRARY_REVISION_KEY]: 'library:1' };
  let loads = 0; const calls = [];
  const selection = createReferenceSelection({
    storage: { get: async keys => Object.fromEntries([keys].flat().map(key => [key, stored[key]])) },
    loadState: async () => { loads++; return { entries, compoundCases: [] }; },
    readDerived: async () => null, getLibraryId: async () => 'fixture', enqueue: fn => fn()
  });
  const server = createServer(async (operation, input) => { calls.push(operation); return selection.read(input); });
  try {
    const tool = server._registeredTools.promptdirector_read_workspace_content;
    const read = async input => {
      const response = await tool.handler(tool.inputSchema.parse(input));
      assert(!response.isError, JSON.stringify(response)); return JSON.parse(response.content[0].text);
    };
    const first = await read({ part: 'selection', length: 100 });
    assert.deepEqual(calls, ['read_workspace_content']); assert.equal(loads, 1);
    let text = first.content, offset = first.nextOffset;
    while (offset !== null) {
      const next = await read({ part: 'selection', expectedRevision: first.revision, offset, length: 100 });
      text += next.content; offset = next.nextOffset;
    }
    assert.equal(loads, 1);
    assert.deepEqual(JSON.parse(text).references.map(ref => ref.originalText), entries.map(entry => entry.text));
    assert(calls.every(operation => operation === 'read_workspace_content'));
  } finally { await server.close(); }
});
