import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { callExtension } from '../bridge-client.mjs';

for (const code of ['EPERM', 'EACCES', 'ENOENT', 'ECONNREFUSED']) {
  test(`local connection ${code} does not mislead users about pairing or browser state`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'pd-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const instanceId = randomUUID();
    await writeFile(join(root, 'selected.json'), JSON.stringify({ instanceId }));
    await writeFile(join(root, `${instanceId}.json`), JSON.stringify({ secret: 'fixture-secret' }));
    t.mock.method(net, 'connect', () => {
      const socket = new PassThrough();
      queueMicrotask(() => socket.emit('error', Object.assign(new Error('OS connection failure'), { code })));
      return socket;
    });
    const denied = ['EPERM', 'EACCES'].includes(code);
    await assert.rejects(callExtension('status', {}, { root }), error => {
      assert.equal(error.code, denied ? 'connector_access_denied' : 'connector_offline');
      assert.match(error.message, denied ? /权限/ : /Chrome/);
      assert(!error.message.includes('fixture-secret'));
      return true;
    });
  });
}
