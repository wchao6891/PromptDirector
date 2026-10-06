import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../mcp.mjs';
import { callExtension } from '../bridge-client.mjs';
import { stageFiles } from '../transfers.mjs';
import { nodeCommand } from '../node-command.mjs';
import { verifyConnection } from '../setup.mjs';
import { skillPackageLimits } from '../../extension/creative-skill-package.js';

test('impossible Skill packages fail before reading local files or making any backend call', async () => {
  let calls = 0;
  const server = createServer(async () => { calls++; assert.fail('must reject before querying or uploading'); });
  try {
    const save = server._registeredTools.promptdirector_save_skill.handler;
    const files = [{ path: '/not-read/SKILL.md', packagePath: 'SKILL.md' }];
    for (const args of [
      { files, skillMarkdown: '另一份正文' }, { files, references: [] },
      { files: [...files, ...files] }, { files: [{ path: '/not-read/file', packagePath: '../SKILL.md' }] },
      { files: [{ path: '/not-read/file', packagePath: 'references/source.md' }] }
    ]) {
      const result = await save({ requestId: 'preflight', ...args });
      assert(result.isError); assert.equal(JSON.parse(result.content[0].text).code, 'invalid_input');
    }
    assert.equal(calls, 0);
  } finally { await server.close(); }
});

test('a new MCP service never reports ignored author filters or unversioned text from an older browser as valid', async () => {
  const calls = [];
  const server = createServer(async operation => {
    calls.push(operation);
    if (operation === 'status') return { searchFilters: ['query', 'sort'] };
    if (operation === 'read_case') return { content: '旧正文', nextOffset: 2 };
    assert.fail('unsupported filters must fail before searching');
  });
  try {
    const search = server._registeredTools.promptdirector_search_cases.handler;
    const result = await search({ query: '', authorHandle: 'Arvin' });
    assert.equal(JSON.parse(result.content[0].text).code, 'unsupported_search_filters');
    assert.deepEqual(calls, ['status']);
    const read = server._registeredTools.promptdirector_read_case.handler;
    assert.equal(JSON.parse((await read({ caseId: 'a' })).content[0].text).code, 'unsupported_case_text_revision');
    assert.equal(JSON.parse((await read({ caseId: 'a', offset: 2 })).content[0].text).code, 'case_revision_required');
    assert.deepEqual(calls, ['status', 'read_case']);
  } finally { await server.close(); }
});

test('structured query and field discovery refuse an older backend before any ignored query can run', async () => {
  const calls = [];
  const server = createServer(async operation => { calls.push(operation); return {}; });
  try {
    for (const [name, args] of [['search_cases', { select: ['title'] }], ['search_cases', { where: { field: 'mediaCount', op: 'gte', value: 3 } }], ['describe_case_query', {}]]) {
      const result = await server._registeredTools[`promptdirector_${name}`].handler(args);
      assert.equal(JSON.parse(result.content[0].text).code, 'unsupported_case_query');
    }
    assert.deepEqual(calls, ['status', 'status', 'status']);
  } finally { await server.close(); }
});

test('missing-prompt expansion cannot silently become an unfiltered search on an older extension', async () => {
  const calls = [];
  const server = createServer(async operation => {
    calls.push(operation);
    assert.equal(operation, 'status');
    return { caseQueryVersion: 1, searchFilters: ['query', 'mediaKind', 'similarTo'] };
  });
  try {
    const result = await server._registeredTools.promptdirector_search_cases.handler({ mediaKind: 'video', hasPrompt: false });
    assert.equal(JSON.parse(result.content[0].text).code, 'unsupported_search_filters');
    assert.deepEqual(calls, ['status']);
  } finally { await server.close(); }
});

test('actual declared text parsing budget is checked across package references before uploading any bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pd-text-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const main = join(root, 'SKILL.md'), reference = join(root, 'source.md');
  await writeFile(main, '1234'); await writeFile(reference, '5678');
  const files = [{ path: main, packagePath: 'folder\\SKILL.md' }, { path: reference, packagePath: 'folder\\references\\source.md' }];
  await assert.rejects(stageFiles(files, undefined, 'fixture', async () => assert.fail('must not upload'), { purpose: 'skill-file', limits: skillPackageLimits({ budget: { maxTextBytes: 7 } }) }), { code: 'RESOURCE_BUDGET_REACHED' });
});

test('oversized inline messages give a file route before touching pairing or connecting', async () => {
  await assert.rejects(callExtension('save_skill', { references: [{ markdown: '完整原词'.repeat(100000) }] }, { root: '/must-not-create' }), error => {
    assert.equal(error.code, 'native_message_too_large'); assert.match(error.message, /无需缩短/); return true;
  });
});

test('setup uses an existing symlink for the same runtime and never silently selects a different Node', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pd-node-path-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = join(root, 'runtime'), launch = join(root, 'launch');
  await mkdir(runtime);
  const executable = join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'), other = join(root, 'other-node'), link = join(launch, process.platform === 'win32' ? 'node.exe' : 'node');
  await writeFile(executable, '', { mode: 0o700 }); await writeFile(other, '', { mode: 0o700 });
  // Windows directory junctions do not require symlink creation privileges.
  await symlink(runtime, launch, 'junction');
  assert.equal(nodeCommand({ executable, invoked: link, path: '' }), link);
  assert.equal(nodeCommand({ executable, invoked: other, path: launch }), link);
  await rm(launch);
  assert.equal(nodeCommand({ executable, invoked: other, path: launch }), executable);
});

test('offline diagnostics report checked files without guessing browser switches or exposing pairing secrets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pd-offline-facts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const instanceId = '11111111-1111-4111-8111-111111111111';
  await writeFile(join(root, `${instanceId}.json`), '{"secret":"must-not-print"}');
  const result = await verifyConnection({ root, instanceId, probe: async () => [] });
  assert.equal(result.state, 'awaiting_browser');
  assert.equal(result.diagnostics.pairing, 'present'); assert.equal(result.diagnostics.runtime, 'missing');
  assert.equal(result.diagnostics.agentSwitchEnabled, 'unknown');
  assert(!JSON.stringify(result).includes('must-not-print'));
});

test('editing through a new connector refuses an old backend before unprotected source writes', async () => {
  const calls=[];const server=createServer(async op=>{calls.push(op);return {};});
  try {
    const result=await server._registeredTools.promptdirector_edit_case.handler({requestId:'edit',caseId:'c',expectedRevision:'r',patch:{sourceFacts:{author:'inference'}}});
    assert(result.isError);assert.equal(JSON.parse(result.content[0].text).code,'unsupported_source_protection');assert.deepEqual(calls,['status']);
  } finally {await server.close();}
});
test('stale temporary preview rejects before reading or uploading a local file; a retained retry may reach its original receipt', async () => {
  const calls=[];const server=createServer(async (op,input)=>{calls.push(op);return {revision:'new',requestKnown:false};});
  try {
    const result=await server._registeredTools.promptdirector_control_workspace.handler({tabId:1,requestId:'preview',expectedRevision:'old',action:'open_temporary',file:{path:'/not-read/sample.webm'}});
    assert(result.isError);assert.equal(JSON.parse(result.content[0].text).code,'workspace_changed');assert.deepEqual(calls,['read_live_workspace']);
  } finally {await server.close();}
});

test('one extension session checks capabilities once and re-checks after an upgrade or reload before sending work', async () => {
  const calls = [];
  let status = { caseQueryVersion: 1, searchFilters: ['query'] };
  let hostSession = 'host-a';
  const server = createServer(async (operation, _input, options = {}) => {
    if (options.expectedHostSession && options.expectedHostSession !== hostSession) {
      calls.push(`refused:${operation}`);
      throw Object.assign(new Error('reloaded'), { code: 'connector_session_changed' });
    }
    options.onHostSession?.(hostSession);
    calls.push(operation);
    return operation === 'status' ? status : { items: [] };
  });
  try {
    const describe = server._registeredTools.promptdirector_describe_case_query.handler;
    const search = server._registeredTools.promptdirector_search_cases.handler;
    await describe({}); await describe({});
    assert.deepEqual(calls, ['status', 'describe_case_query', 'describe_case_query'], 'a supported capability is not re-queried');

    status = { ...status, searchFilters: ['query', 'authorHandle'] };
    calls.length = 0;
    assert(!(await search({ query: '', authorHandle: 'a' })).isError, 'a newly needed filter is found by re-reading status once');
    assert.deepEqual(calls, ['status', 'search']);

    hostSession = 'host-b';
    status = { caseQueryVersion: 0, searchFilters: ['query'] };
    calls.length = 0;
    const downgraded = await search({ query: '', authorHandle: 'a' });
    assert.equal(JSON.parse(downgraded.content[0].text).code, 'unsupported_search_filters');
    assert.deepEqual(calls, ['refused:search', 'status'], 'a reloaded older extension never receives a search it would silently ignore');
  } finally { await server.close(); }
});
