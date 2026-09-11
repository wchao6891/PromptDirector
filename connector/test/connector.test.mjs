import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { encodeFrame, frameDecoder } from '../framing.mjs';
import { startNativeHost } from '../native-host.mjs';
import { callExtension } from '../bridge-client.mjs';
import { receiveMedia, stageFiles } from '../transfers.mjs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('native framing preserves split Unicode messages and refuses oversized frames', () => {
  const messages = []; const decode = frameDecoder(value => messages.push(value));
  const bytes = Buffer.concat([encodeFrame({ text: '案例🚀' }), encodeFrame({ n: 2 })]);
  for (const byte of bytes) decode(Buffer.from([byte]));
  assert.deepEqual(messages, [{ text: '案例🚀' }, { n: 2 }]);
  assert.throws(() => encodeFrame({ text: '12345' }, 3));
});

test('real native broker binds one library, authenticates and forwards response', { timeout: 5000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-'));
  const input = new PassThrough(), output = new PassThrough();
  const extensionId = 'a'.repeat(32), instanceId = randomUUID();
  await writeFile(join(root, 'config.json'), JSON.stringify({ extensionId }));
  await writeFile(join(root, 'selected.json'), JSON.stringify({ instanceId }));
  let ready; const readiness = new Promise(resolve => { ready = resolve; });
  output.on('data', frameDecoder(message => {
    if (message.type === 'ready') ready();
    else if (message.type === 'request') input.write(encodeFrame({ type: 'response', id: message.id, result: { operation: message.operation, input: message.input } }));
  }));
  const host = await startNativeHost({ root, origin: `chrome-extension://${extensionId}/`, input, output });
  try {
    input.write(encodeFrame({ type: 'hello', protocolVersion: 1, extensionId, instanceId }));
    await readiness;
    assert.deepEqual(await callExtension('search', { query: '案例' }, { root }), { operation: 'search', input: { query: '案例' } });
    const client = new Client({ name: 'full-path-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../mcp.mjs', import.meta.url).pathname], env: { ...process.env, PROMPTDIRECTOR_CONNECTOR_HOME: root } }));
      const response = await client.callTool({ name: 'promptdirector_search_cases', arguments: { query: '素材' } });
      const content = JSON.parse(response.content[0].text);
      assert.equal(content.operation, 'search'); assert.equal(content.input.query, '素材');
    } finally { await client.close(); }
    await assert.rejects(startNativeHost({ root, origin: `chrome-extension://${'b'.repeat(32)}/`, input: new PassThrough(), output }), /identity/);
  } finally { await host.close(); input.destroy(); output.destroy(); await rm(root, { recursive: true, force: true }); }
});

test('SDK client performs real stdio MCP handshake and discovers bounded tools', async () => {
  const client = new Client({ name: 'connector-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL('../mcp.mjs', import.meta.url).pathname] });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 7);
    assert(list.tools.some(tool => tool.name === 'promptdirector_capture_url'));
    const bad = await client.callTool({ name: 'promptdirector_capture_url', arguments: { requestId: '../bad', url: 'no' } });
    assert.equal(bad.isError, true);
  } finally { await client.close(); }
});

test('media transfer preserves original bytes and rejects corruption without delivering a file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-'));
  const bytes = Buffer.from('原始素材'.repeat(100)); const sha256 = createHash('sha256').update(bytes).digest('hex');
  const call = async (_, { offset }) => ({ offset, sha256, byteSize: bytes.length, name: 'original.txt', mimeType: 'text/plain', data: bytes.subarray(offset, offset + 29).toString('base64'), nextOffset: offset + 29 < bytes.length ? offset + 29 : null });
  try {
    const result = await receiveMedia({ caseId: 'case', assetId: 'asset' }, call, root);
    assert.deepEqual(await readFile(result.path), bytes);
    await assert.rejects(receiveMedia({}, async () => ({ offset: 0, sha256, byteSize: 1, data: 'YQ==', nextOffset: null }), root), /完整性/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('file staging resumes exact bytes and keeps each original prompt tied to its transfer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-'));
  const path = join(root, 'material.txt'); const bytes = Buffer.from('新的创作原文'); await writeFile(path, bytes);
  let captured = Buffer.from(bytes.subarray(0, 2)); const calls = [];
  const call = async (operation, input) => {
    calls.push(operation);
    if (operation === 'begin_transfer') return { state: 'uploading', offset: 2, chunkBytes: 3 };
    if (operation === 'append_transfer') { assert.equal(input.offset, captured.length); captured = Buffer.concat([captured, Buffer.from(input.data, 'base64')]); return { offset: captured.length }; }
    return { state: 'ready' };
  };
  try {
    const result = await stageFiles([{ path, mimeType: 'text/plain', originalPrompt: '原始提示词' }], path, 'request', call);
    assert.deepEqual(captured, bytes); assert.equal(result.bodyTransferId, result.transferIds[0]);
    assert.equal(result.filePrompts[result.transferIds[0]], '原始提示词');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installer creates a reviewable private runtime and origin-bound registration in an isolated directory', { timeout: 10000 }, async () => {
  const { installationPlan, install, pair } = await import('../install.mjs');
  const root = await mkdtemp(join(tmpdir(), 'pd-'));
  const extensionId = 'c'.repeat(32), instanceId = randomUUID();
  try {
    const plan = await installationPlan({ root, nativeDirectory: join(root, 'registration'), extensionId });
    await install(plan);
    const manifest = JSON.parse(await readFile(plan.registration, 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
    assert.equal(manifest.path, plan.launcher);
    assert((await readFile(plan.launcher, 'utf8')).includes('PROMPTDIRECTOR_CONNECTOR_HOME'));
    const { instancePaths } = await import('../paths.mjs');
    await writeFile(instancePaths(root, instanceId).record, JSON.stringify({ instanceId, secret: 'a'.repeat(64) }));
    const paired = await pair(instanceId, root); assert.equal(paired.instanceId, instanceId);
    const native = spawn(plan.launcher, [`chrome-extension://${extensionId}/`], { stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(native, 'exit');
    let onReady; const ready = new Promise(resolve => { onReady = resolve; });
    native.stdout.on('data', frameDecoder(message => {
      if (message.type === 'ready') onReady();
      else if (message.type === 'request') native.stdin.write(encodeFrame({ type: 'response', id: message.id, result: { fixture: true } }));
    }));
    native.stdin.write(encodeFrame({ type: 'hello', protocolVersion: 1, extensionId, instanceId }));
    try {
      await ready;
      assert.deepEqual(await callExtension('status', {}, { root }), { fixture: true });
    } finally { native.stdin.end(); await exited; }

    assert(!JSON.stringify(paired).includes('secret'));
    const client = new Client({ name: 'installed-runtime-test', version: '1' });
    try { await client.connect(new StdioClientTransport(paired.mcp)); assert.equal((await client.listTools()).tools.length, 7); }
    finally { await client.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
