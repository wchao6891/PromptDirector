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
