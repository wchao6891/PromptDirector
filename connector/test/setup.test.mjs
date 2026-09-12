import { install } from '../install.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { parse } from 'smol-toml';
import { hostConfiguration, configurationPlan, writeConfiguration } from '../host-config.mjs';
import { discoverLibraries } from '../discovery.mjs';
import { connect, mcpConfiguration, verifyConnection } from '../setup.mjs';
import { startNativeHost } from '../native-host.mjs';
import { encodeFrame, frameDecoder } from '../framing.mjs';

async function temporary(fn) { const root = await mkdtemp(join(tmpdir(), 'pd-onboard-')); try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); } }
const entry = root => mcpConfiguration(root, '11111111-1111-4111-8111-111111111111');

test('host paths use documented user scope and explicit runtime roots', () => {
  assert.equal(hostConfiguration('codex', { home: '/example', env: { CODEX_HOME: '/portable' } }).path, join('/portable', 'config.toml'));
  assert.equal(hostConfiguration('claude', { home: '/example', env: {} }).path, join('/example', '.claude.json'));
  assert.equal(hostConfiguration('workbuddy', { home: '/example', env: {} }).path, join('/example', '.workbuddy/mcp.json'));
  assert.deepEqual(hostConfiguration('generic'), { host: 'generic' });
  assert.throws(() => hostConfiguration('chatgpt-cloud'), /云端/);
});

for (const format of ['json', 'toml']) test(`${format} install preserves unrelated MCP settings, backs up and is repeatable`, () => temporary(async root => {
  const original = format === 'json' ? '{"preference":"keep","mcpServers":{"other":{"command":"other","env":{"TOKEN":"test-only"}}}}' : '# retained in backup\npreference="keep"\n[mcp_servers.other]\ncommand="other"\n[mcp_servers.other.env]\nTOKEN="test-only"\n';
  const path = join(root, `config.${format}`), key = format === 'json' ? 'mcpServers' : 'mcp_servers';
  await writeFile(path, original);
  const target = { path, key, format };
  const plan = await configurationPlan(target, entry(root));
  const result = await writeConfiguration(plan);
  assert.equal(await readFile(result.backup, 'utf8'), original);
  const updated = format === 'json' ? JSON.parse(await readFile(path, 'utf8')) : parse(await readFile(path, 'utf8'));
  assert.equal(updated.preference, 'keep'); assert.equal(updated[key].other.env.TOKEN, 'test-only');
  assert.equal(updated[key].promptdirector.env.PROMPTDIRECTOR_INSTANCE, entry(root).env.PROMPTDIRECTOR_INSTANCE);
  const again = await configurationPlan(target, entry(root)); assert.equal(again.changed, false);
  assert.equal((await writeConfiguration(again)).changed, false);
}));

test('invalid, conflicting and concurrently changed config files are never overwritten', () => temporary(async root => {
  const path = join(root, 'config.json'), target = { path, key: 'mcpServers', format: 'json' };
  await writeFile(path, '{broken');
  await assert.rejects(configurationPlan(target, entry(root)), /无法解析/);
  assert.equal(await readFile(path, 'utf8'), '{broken');
  await writeFile(path, JSON.stringify({ mcpServers: { promptdirector: { command: 'another' } } }));
  await assert.rejects(configurationPlan(target, entry(root)), /未覆盖/);
  await writeFile(path, '{}'); const plan = await configurationPlan(target, entry(root));
  await writeFile(path, '{"edited":true}'); await assert.rejects(writeConfiguration(plan), /发生变化/);
  assert.equal(await readFile(path, 'utf8'), '{"edited":true}');
  assert(!(await readdir(root)).some(name => name.endsWith('lock')));
}));

test('discovery excludes stale profiles and never selects among multiple online libraries', () => temporary(async root => {
  const one = randomUUID(), two = randomUUID();
  await writeFile(join(root, one + '.json'), '{}'); await writeFile(join(root, two + '.json'), '{}');
  const probe = opts => discoverLibraries({ ...opts, call: async (_op, _input, { instanceId }) => ({ instanceId, protocolVersion: 1, enabled: true, status: 'connected' }) });
  assert.equal((await verifyConnection({ root, probe })).state, 'library_selection_required');
  assert.equal((await discoverLibraries({ root, instanceId: one, call: async () => { throw Object.assign(new Error('offline'), { code: 'connector_offline' }); } })).length, 0);
}));

test('offline setup reports browser action without claiming host session success', () => temporary(async root => {
  const result = await connect({ root, home: root, env: {}, host: 'workbuddy', instanceId: randomUUID(), nativeDirectory: join(root, 'registration'), extensionId: 'a'.repeat(32) }, {
    installRuntime: async () => {}, verify: async () => ({ state: 'awaiting_browser', connected: false })
  });
  assert.equal(result.state, 'awaiting_browser'); assert.equal(result.connected, false);
  assert.equal(result.configuration.state, 'configured');
}));

test('full installed SDK verification reads the bound library and distinguishes the host session', { timeout: process.platform === 'win32' ? 60000 : 15000 }, t => temporary(async root => {
  const instanceId = randomUUID(), extensionId = 'a'.repeat(32);
  const options = { root, instanceId, host: 'codex', home: root, env: {}, nativeDirectory: join(root, 'registration'), extensionId };
  // Install a real connector into a private directory. Chrome's native stream is
  // a fixture here; MCP client, installed server, broker and file config are real.
  t.diagnostic('installing isolated runtime');
  const initial = await connect(options, { installRuntime: plan => install(plan, { register: async () => {} }) });
  t.diagnostic(`initial state: ${initial.state}`);
  assert.equal(initial.state, 'awaiting_browser');
  const input = new PassThrough(), output = new PassThrough();
  let ready; const readiness = new Promise(resolve => { ready = resolve; });
  output.on('data', frameDecoder(message => {
    if (message.type === 'ready') { ready(); return; }
    if (message.type !== 'request') return;
    const result = message.operation === 'status'
      ? { instanceId, protocolVersion: 1, enabled: true, status: 'connected', extensionVersion: 'fixture' }
      : { cases: [{ caseId: 'fixture-case', title: 'Fixture original prompt' }], total: 1 };
    input.write(encodeFrame({ type: 'response', id: message.id, result }));
  }));
  t.diagnostic('starting broker fixture');
  const native = await startNativeHost({ root, origin: `chrome-extension://${extensionId}/`, input, output });
  try {
    input.write(encodeFrame({ type: 'hello', protocolVersion: 1, extensionId, instanceId })); await readiness;
    t.diagnostic('broker ready; verifying installed MCP');
    const verified = await verifyConnection({ root, instanceId, onProgress: stage => t.diagnostic(stage) });
    t.diagnostic(`verified state: ${verified.state}`);
    assert.equal(verified.state, 'connector_verified'); assert.equal(verified.hostSessionVerified, false);
    assert.equal(verified.caseCount, 1); assert.equal(verified.sampleCases[0].caseId, 'fixture-case');
    t.diagnostic('checking repeated connection');
    const repeat = await connect(options, { installRuntime: async () => {} });
    assert.equal(repeat.connected, true); assert.equal(repeat.configuration.changed, false);
    assert(!JSON.stringify(verified).includes('secret'));
  } catch (error) { t.diagnostic(error.stack); throw error; }
  finally { t.diagnostic('closing broker'); await native.close(); input.destroy(); output.destroy(); t.diagnostic('broker closed'); }
}));


test('TOML edits preserve integer precision and float types', () => temporary(async root => {
  const path = join(root, 'config.toml');
  await writeFile(path, 'ratio=1.0\nlarge=9223372036854775807\n');
  const plan = await configurationPlan({ path, key: 'mcp_servers', format: 'toml' }, entry(root));
  await writeConfiguration(plan);
  const value = parse(await readFile(path, 'utf8'), { integersAsBigInt: true });
  assert.equal(value.ratio, 1); assert.equal(value.large, 9223372036854775807n);
}));

test('a disabled host entry and existing tool policy stay under user control', () => temporary(async root => {
  const path = join(root, 'config.json'), mcp = entry(root);
  await writeFile(path, JSON.stringify({ mcpServers: { promptdirector: { ...mcp, disabled: true, disabledTools: ['promptdirector_save_material'] } } }));
  const plan = await configurationPlan({ path, key: 'mcpServers', format: 'json' }, mcp);
  assert.equal(plan.hostEnabled, false);
  await writeConfiguration(plan);
  const saved = JSON.parse(await readFile(path, 'utf8')).mcpServers.promptdirector;
  assert.deepEqual(saved.disabledTools, ['promptdirector_save_material']); assert.equal(saved.disabled, true);
}));


test('an unpaired installation never registers an unbound host configuration', () => temporary(async root => {
  const result = await connect({ root, home: root, env: {}, host: 'workbuddy', nativeDirectory: join(root, 'registration'), extensionId: 'a'.repeat(32) }, {
    installRuntime: async () => {}, verify: async () => ({ state: 'library_selection_required', connected: false, libraries: [{instanceId: randomUUID()}, {instanceId: randomUUID()}] })
  });
  assert.equal(result.configuration.state, 'awaiting_pairing'); assert.equal(result.mcp, undefined);
  await assert.rejects(readFile(join(root, '.workbuddy/mcp.json')), {code: 'ENOENT'});
}));
