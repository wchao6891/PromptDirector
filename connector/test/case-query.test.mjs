import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startNativeHost } from '../native-host.mjs';
import { encodeFrame, frameDecoder, NATIVE_FROM_CHROME_MAX } from '../framing.mjs';
import { createAgentLibrary } from '../../extension/agent-library.js';
import { CASE_SEARCH_PROPERTIES } from '../../extension/case-operation-specs.js';
import { callFromCli } from '../call.mjs';

test('SDK/stdio/native broker and CLI execute the same field query and statistics as the shared library without losing nested inputs', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-query-wire-'));
  const input = new PassThrough(), output = new PassThrough(), instanceId = randomUUID(), extensionId = 'a'.repeat(32);
  await writeFile(join(root, 'config.json'), JSON.stringify({ extensionId }));
  await writeFile(join(root, 'selected.json'), JSON.stringify({ instanceId }));
  const entries = [0, 5, 99].map((likes, i) => ({ id: `c${i}`, title: `标题${i}`, text: '原词全文', sourceFacts: { provider: 'x', handle: 'Arvin', originalPromptAvailable: true, engagement: { likes } }, mediaAssets: [{ id: `v${i}`, kind: 'video', durationMs: 3000 }] }));
  const library = createAgentLibrary({ loadState: async () => ({ entries }), readDerivedMetadata: async () => new Map(), libraryUrl: 'fixture' });
  let ready; const readiness = new Promise(resolve => { ready = resolve; });
  output.on('data', frameDecoder(message => {
    if (message.type === 'ready') ready();
    else if (message.type === 'request') {
      const run = message.operation === 'status' ? Promise.resolve({ caseQueryVersion: 1, searchFilters: Object.keys(CASE_SEARCH_PROPERTIES) }) :
        message.operation === 'describe_case_query' ? library.describeQuery() : library.search(message.input);
      void run.then(result => input.write(encodeFrame({ type: 'response', id: message.id, result }, NATIVE_FROM_CHROME_MAX)), error => input.write(encodeFrame({ type: 'response', id: message.id, error: { code: error.code, message: error.message } })));
    }
  }));
  const host = await startNativeHost({ root, origin: `chrome-extension://${extensionId}/`, input, output });
  const client = new Client({ name: 'field-query', version: '1' });
  const previousRoot = process.env.PROMPTDIRECTOR_CONNECTOR_HOME;
  try {
    input.write(encodeFrame({ type: 'hello', protocolVersion: 1, extensionId, instanceId })); await readiness;
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp.mjs', import.meta.url))], env: { ...process.env, PROMPTDIRECTOR_CONNECTOR_HOME: root } }));
    const help = await client.callTool({ name: 'promptdirector_describe_case_query', arguments: {} }); assert(!help.isError); assert.deepEqual(JSON.parse(help.content[0].text).engagementMetrics, ['likes']);
    const query = { provider: 'x', where: { all: [{ field: 'source.handle', op: 'eq', value: '@ARVIN' }, { scope: 'media', where: { all: [{ field: 'media.kind', op: 'eq', value: 'video' }, { field: 'media.durationMs', op: 'gte', value: 1000 }] } }] },
      select: ['title', 'mediaCount'], orderBy: [{ field: 'source.engagement.likes', direction: 'desc', reduce: 'max' }], aggregates: [{ name: 'likes', op: 'sum', field: 'source.engagement.likes', reduce: 'max' }], offset: 0, limit: 1, query: '' };
    const expected = await library.search(query);
    const response = await client.callTool({ name: 'promptdirector_search_cases', arguments: query }); assert(!response.isError, JSON.stringify(response)); assert.deepEqual(JSON.parse(response.content[0].text), expected);
    process.env.PROMPTDIRECTOR_CONNECTOR_HOME = root;
    assert.deepEqual(await callFromCli('search_cases', query), expected);
    const groups = { provider: 'x', groupBy: ['source.handle'], aggregates: [{ name: 'total', op: 'count' }], query: '', offset: 0, limit: 24 };
    assert.deepEqual(await callFromCli('search_cases', groups), await library.search(groups));
    entries[0].mediaAssets.push({ id: 'image', kind: 'image' });
    const promptQuery = { similarTo: { caseId: 'c0' }, mediaKind: 'video', limit: 1 };
    const promptResponse = await client.callTool({ name: 'promptdirector_search_cases', arguments: promptQuery });
    assert(!promptResponse.isError, JSON.stringify(promptResponse));
    const promptResult = JSON.parse(promptResponse.content[0].text);
    assert.equal(promptResult.total, 2); assert.equal(promptResult.similarityCoverage.method, 'prompt');
    assert.deepEqual(promptResult.cases[0].similarity.promptEvidence.sources, ['original']);
    const missingResponse = await client.callTool({ name: 'promptdirector_search_cases', arguments: { mediaKind: 'video', hasPrompt: false } });
    assert(!missingResponse.isError, JSON.stringify(missingResponse));
    assert.equal(JSON.parse(missingResponse.content[0].text).total, 0);
  } finally {
    if (previousRoot === undefined) delete process.env.PROMPTDIRECTOR_CONNECTOR_HOME; else process.env.PROMPTDIRECTOR_CONNECTOR_HOME = previousRoot;
    await client.close(); await host.close(); input.destroy(); output.destroy(); await rm(root, { recursive: true, force: true });
  }
});
