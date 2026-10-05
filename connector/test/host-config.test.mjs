import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as jsonc } from 'jsonc-parser';
import { parseDocument } from 'yaml';
import { hostConfiguration, configurationPlan, writeConfiguration } from '../host-config.mjs';
import { mcpConfiguration, connect } from '../setup.mjs';

async function temporary(fn) {
  const home = await mkdtemp(join(tmpdir(), 'pd-host-'));
  try { await fn(home); } finally { await rm(home, { recursive: true, force: true }); }
}
const instance = '11111111-1111-4111-8111-111111111111';
async function save(path, value) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, value); }

test('host paths follow user scope and environment overrides', () => {
  const options = { home: '/home/example', env: {} };
  assert.equal(hostConfiguration('qoder', options).path, join(options.home, '.qoder/settings.json'));
  assert.equal(hostConfiguration('zcode', options).path, join(options.home, '.zcode/cli/config.json'));
  assert.equal(hostConfiguration('opencode', { ...options, env: { XDG_CONFIG_HOME: '/custom' } }).path, join('/custom', 'opencode/opencode.json'));
  assert.equal(hostConfiguration('opencode', { ...options, env: { OPENCODE_CONFIG: '/chosen.jsonc' } }).path, '/chosen.jsonc');
  assert.throws(() => hostConfiguration('dsh', options), /profile/);
  assert.throws(() => hostConfiguration('dsh', { ...options, profile: '../other' }), /profile/);
  assert.equal(hostConfiguration('dsh', { ...options, profile: 'desktop', env: { DSH_HOME: '/dsh' } }).path, join('/dsh', 'profiles/desktop/cordis.patch.yml'));
});

test('OpenCode preserves JSONC comments, disabled state and unrelated provider settings', () => temporary(async home => {
  const options = { home, env: {} }, target = hostConfiguration('opencode', options), mcp = mcpConfiguration(home, instance);
  const path = target.path.replace('.json', '.jsonc');
  const prior = { type: 'local', command: [mcp.command, ...mcp.args], enabled: false, environment: { CUSTOM: 'keep' } };
  await save(path, `{// provider comment\n"provider":{"local":{"url":"https://example.com/a//b"}},"mcp":{"other":{"type":"remote","url":"https://example.com"},"promptdirector":${JSON.stringify(prior)},},}`);
  const plan = await configurationPlan(target, mcp);
  assert.equal(plan.path, path); assert.equal(plan.hostEnabled, false);
  await writeConfiguration(plan);
  const content = await readFile(path, 'utf8'), value = jsonc(content);
  assert.match(content, /provider comment/);
  assert.equal(value.provider.local.url, 'https://example.com/a//b');
  assert.equal(value.mcp.other.type, 'remote');
  assert.equal(value.mcp.promptdirector.environment.CUSTOM, 'keep');
  assert.equal(value.mcp.promptdirector.environment.PROMPTDIRECTOR_INSTANCE, instance);
  assert.equal(value.mcp.promptdirector.env, undefined);
  assert.equal((await configurationPlan(target, mcp)).changed, false);
  await save(target.path, '{}');
  await assert.rejects(configurationPlan(target, mcp), /同时存在/);
}));

for (const host of ['opencode', 'qoder', 'zcode']) test(`${host} creates a repeatable native entry without changing another connection`, () => temporary(async home => {
  const target = hostConfiguration(host, { home, env: {} }), mcp = mcpConfiguration(home, instance);
  await writeConfiguration(await configurationPlan(target, mcp));
  assert.equal((await configurationPlan(target, mcp)).changed, false);
  await assert.rejects(configurationPlan(target, { ...mcp, args: ['different-runtime'] }), /未覆盖/);
  const config = JSON.parse(await readFile(target.path, 'utf8'));
  const entry = host === 'zcode' ? config.mcp.servers.promptdirector : host === 'opencode' ? config.mcp.promptdirector : config.mcpServers.promptdirector;
  assert.deepEqual(entry.command, host === 'opencode' ? [mcp.command, ...mcp.args] : mcp.command);
}));

test('ZCode nested update preserves disabled state and does not shadow shared fallback servers', () => temporary(async home => {
  const target = hostConfiguration('zcode', { home, env: {} }), mcp = mcpConfiguration(home, instance);
  await save(target.fallback, '{"mcpServers":{"other":{"command":"keep"}}}');
  await assert.rejects(configurationPlan(target, mcp), /共享配置/);
  await save(target.path, JSON.stringify({ mcp: { timeout: 42, servers: { promptdirector: { ...mcp, enable: false } } }, theme: 'dark' }));
  const plan = await configurationPlan(target, mcp);
  assert.equal(plan.changed, false); assert.equal(plan.hostEnabled, false);
  const config = JSON.parse(plan.content); assert.equal(config.mcp.timeout, 42); assert.equal(config.theme, 'dark');
}));

test('DSH user patch preserves comments, tagged expressions and policies; repeat setup does not duplicate plugin', () => temporary(async home => {
  const target = hostConfiguration('dsh', { home, env: {}, profile: 'desktop' }), mcp = mcpConfiguration(home, instance);
  await assert.rejects(configurationPlan(target, mcp), /未找到指定/);
  await save(target.profileManifest, '{}');
  const original = '# user settings\n- id: other\n  config:\n    key: !!js process.env.EXAMPLE\n    enabled: false\n';
  await save(target.path, original);
  await writeConfiguration(await configurationPlan(target, mcp));
  const content = await readFile(target.path, 'utf8');
  assert.match(content, /# user settings/); assert.match(content, /!!js process.env.EXAMPLE/);
  const values = parseDocument(content).toJS();
  assert.equal(values[0].config.enabled, false); assert.equal(values[1].insert[0].config.env.PROMPTDIRECTOR_INSTANCE, instance);
  assert.equal((await configurationPlan(target, mcp)).changed, false);
  await assert.rejects(configurationPlan(target, mcpConfiguration(home, '22222222-2222-4222-8222-222222222222')), /未覆盖/);
  await save(target.overlay, '- id: promptdirector-mcp\n  config: {}\n');
  await assert.rejects(configurationPlan(target, mcp), /全局覆盖层/);
  assert.equal(await readFile(target.path, 'utf8'), content);
}));

test('DSH updates only its environment while keeping a disabled entry and tool timeouts', () => temporary(async home => {
  const target = hostConfiguration('dsh', { home, env: {}, profile: 'desktop' }), mcp = mcpConfiguration(home, instance);
  await save(target.profileManifest, '{}');
  await writeConfiguration(await configurationPlan(target, mcp));
  const doc = parseDocument(await readFile(target.path, 'utf8'));
  doc.setIn([0, 'insert', 0, 'disabled'], true);
  doc.setIn([0, 'insert', 0, 'config', 'toolCallTimeoutMs'], 12345);
  await save(target.path, doc.toString());
  const plan = await configurationPlan(target, { ...mcp, env: { ...mcp.env, CUSTOM: 'new' } });
  assert.equal(plan.hostEnabled, false); await writeConfiguration(plan);
  const value = parseDocument(await readFile(target.path, 'utf8')).toJS()[0].insert[0];
  assert.equal(value.config.toolCallTimeoutMs, 12345); assert.equal(value.config.env.CUSTOM, 'new');
}));

test('unverified hosts cannot install or claim connection; GUI import is bound to one library', () => temporary(async home => {
  const blocked = await connect({ host: 'doubao-work', home, root: home, env: {}, extensionId: 'a'.repeat(32), nativeDirectory: join(home, 'native') }, {
    installRuntime: async () => { throw new Error('must not install'); }, verify: async () => { throw new Error('must not probe'); }
  });
  assert.equal(blocked.state, 'host_verification_required'); assert.equal(blocked.connected, false);
  const target = hostConfiguration('qwenwork');
  const plan = await configurationPlan(target, mcpConfiguration(home, instance));
  const result = await writeConfiguration(plan);
  assert.equal(result.state, 'manual_registration_required');
  assert.equal(result.importConfig.mcpServers.promptdirector.env.PROMPTDIRECTOR_INSTANCE, instance);
  assert.equal((await configurationPlan(target, mcpConfiguration(home))).importConfig, undefined);
}));

test('DSH accepts an empty commented patch but rejects duplicate and malformed entries without writing', () => temporary(async home => {
  const target = hostConfiguration('dsh', { home, env: {}, profile: 'desktop' }), mcp = mcpConfiguration(home, instance);
  await save(target.profileManifest, '{}'); await save(target.path, '# my integrations\n');
  await save(target.overlay, '# promptdirector is configured in the profile\n');
  await writeConfiguration(await configurationPlan(target, mcp));
  const content = await readFile(target.path, 'utf8');
  assert.match(content, /my integrations/);
  const duplicate = content + '\n- id: promptdirector-mcp\n  config: {}\n';
  await save(target.path, duplicate);
  await assert.rejects(configurationPlan(target, mcp), /多条/);
  assert.equal(await readFile(target.path, 'utf8'), duplicate);
  await save(target.path, '- insert: [broken');
  await assert.rejects(configurationPlan(target, mcp), /无法解析/);
}));
