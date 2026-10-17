import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { startVideoHost } from '../video-host.mjs';
import { encodeFrame, frameDecoder } from '../framing.mjs';

test('the standalone component verifies the extension and offers video without Agent pairing or external runtimes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pd-video-host-'));
  const extensionId = 'a'.repeat(32), origin = `chrome-extension://${extensionId}/`;
  await writeFile(join(directory, 'component.json'), JSON.stringify({ extensionId, version: '0.1.0' }));
  const input = new PassThrough(), output = new PassThrough(), messages = [];
  output.on('data', frameDecoder(value => messages.push(value)));
  const host = await startVideoHost({ origin, directory, input, output,
    serviceFactory: ({ resolveTools }) => ({ async request() { const tools = await resolveTools(); assert.match(tools.ytDlp, /bin/u); return { available: true }; }, async close() {} }) });
  try {
    await assert.rejects(startVideoHost({ origin: 'chrome-extension://wrong/', directory }), /identity/u);
    input.write(encodeFrame({ type: 'video_hello', protocolVersion: 1, extensionId }));
    input.write(encodeFrame({ type: 'video_request', id: 'status', operation: 'status' }));
    await new Promise(setImmediate);
    assert.equal(messages[0].type, 'video_ready');
    assert.equal(messages[1].result.available, true); assert.equal(messages[1].result.componentVersion, '0.1.0');
  } finally { await host.close(); await rm(directory, { recursive: true, force: true }); }
});
