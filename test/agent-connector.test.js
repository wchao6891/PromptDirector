import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentTasks } from '../extension/agent-tasks.js';
import { createAgentTransfers } from '../extension/agent-transfers.js';
import { createAgentLibrary } from '../extension/agent-library.js';
import { saveAgentMaterial } from '../extension/agent-save.js';
import { selectLibraryPackage, parseLibraryPackage } from '../extension/library-package.js';
import { createDefaultTaxonomy } from '../extension/taxonomy.js';
import { buildEntry } from '../extension/lib.js';
import { sha256Blob } from '../extension/blob-digest.js';
import { createAgentConnection } from '../extension/agent-connection.js';
import { captureAgentUrl } from '../extension/agent-capture.js';
function storage(initial = {}) {
  const data = structuredClone(initial);
  return { data, async get(key) { return structuredClone(key === null ? data : { [key]: data[key] }); },
    async set(value) { Object.assign(data, structuredClone(value)); }, async remove(key) { delete data[key]; } };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('retrying a write request does not run it twice and cannot change its meaning', async () => {
  const store = storage(); let count = 0; let finish;
  const tasks = createAgentTasks({ storage: store, execute: async () => { count++; await new Promise(resolve => { finish = resolve; }); return { ok: true }; } });
  await tasks.submit('save_material', { title: '案例' }, 'request'); await turn();
  await tasks.submit('save_material', { title: '案例' }, 'request');
  await assert.rejects(tasks.submit('save_material', { title: '另一案例' }, 'request'), { code: 'request_conflict' });
  assert.equal(count, 1); finish(); await turn();
  assert.equal((await tasks.inspect('request')).state, 'completed');
  assert.equal((await tasks.inspect('request')).input, undefined);
});

test('persisted requests tolerate reordered object keys but retain array and value meaning', async () => {
  const store = storage(); let count = 0;
  const tasks = createAgentTasks({ storage: store, execute: async () => { count++; return { ok: true }; } });
  await tasks.submit('save_material', { title: '案例', filePrompts: { b: '乙', a: '甲' }, transferIds: ['a', 'b'] }, 'reordered');
  await turn();
  const resumed = createAgentTasks({ storage: store, execute: async () => { count++; } });
  assert.equal((await resumed.submit('save_material', { transferIds: ['a', 'b'], filePrompts: { a: '甲', b: '乙' }, title: '案例' }, 'reordered')).state, 'completed');
  await assert.rejects(resumed.submit('save_material', { title: '案例', filePrompts: { a: '甲', b: '乙' }, transferIds: ['b', 'a'] }, 'reordered'), { code: 'request_conflict' });
  assert.equal(count, 1);
});

test('worker restart reports interruption instead of claiming an unsaved result', async () => {
  const tasks = createAgentTasks({ storage: storage({ 'agentTask:x': { id: 'x', state: 'running' } }), execute() { throw new Error('must not execute'); } });
  assert.equal((await tasks.inspect('x')).state, 'interrupted');
});

test('staged original files require exact offsets and digest; committed files cannot be discarded', async () => {
  const store = storage(), blobs = new Map(); const original = new Blob(['完整原件']); const sha256 = await sha256Blob(original);
  const transfers = createAgentTransfers({ storage: store, readBlob: async id => blobs.get(id), writeBlob: async (id, blob) => blobs.set(id, blob), deleteBlob: async id => blobs.delete(id), prepare: async record => ({ asset: { id: record.assetId, kind: 'document' }, contentText: '完整原件' }) });
  const input = { id: 'file', name: '原件.txt', mimeType: 'text/plain', byteSize: original.size, sha256 };
  await transfers.begin(input);
  await assert.rejects(transfers.append({ id: 'file', offset: 1, data: 'YQ==' }), { code: 'transfer_position' });
  await transfers.append({ id: 'file', offset: 0, data: Buffer.from(await original.arrayBuffer()).toString('base64') });
  await transfers.finish({ id: 'file' });
  assert.equal(await blobs.get('agent-file:file').text(), '完整原件');
  assert((await transfers.retainedIds()).includes('agent-file:file'));
  await store.set({ 'agentUpload:file': { ...(await transfers.get('file')), state: 'committed' } });
  await assert.rejects(transfers.abort({ id: 'file' }), { code: 'already_committed' });
});

test('corrupt upload never becomes ready or enters the case library', async () => {
  const blobs = new Map(); const transfers = createAgentTransfers({ storage: storage(), readBlob: async id => blobs.get(id), writeBlob: async (id, b) => blobs.set(id, b), deleteBlob: async () => {}, prepare() { assert.fail('must not prepare'); } });
  await transfers.begin({ id: 'bad', name: 'bad.txt', mimeType: 'text/plain', byteSize: 1, sha256: '0'.repeat(64) });
  await transfers.append({ id: 'bad', offset: 0, data: 'YQ==' });
  await assert.rejects(transfers.finish({ id: 'bad' }), { code: 'integrity_failed' });
  assert.equal((await transfers.get('bad')).state, 'uploading');
});

test('library projections search current cases and expose original prompts without runtime secrets', async () => {
  const blob = new Blob(['原件']);
  const entry = { id: 'case', title: '红色广告', text: '案例正文', mediaAssets: [{ id: 'image', kind: 'image', mimeType: 'image/png' }], mediaPrompts: [{ assetId: 'image', text: '红色光影', source: 'manual' }] };
  const library = createAgentLibrary({ loadState: async () => ({ entries: [entry], aiRuntime: { apiKey: 'private-secret' } }), readBlob: async () => blob, readDerived: async () => null, readDerivedMetadata: async () => new Map(), libraryUrl: 'chrome-extension://test/library.html' });
  const result = await library.search({ query: '红色' });
  assert.equal(result.total, 1); assert(!JSON.stringify(result).includes('private-secret'));
  const read = await library.read({ caseId: 'case' }); assert.equal(read.content, '案例正文');
  assert.equal((await library.read({ caseId: 'case', part: 'original_prompt' })).content, '红色光影');
  const media = await library.media({ caseId: 'case', assetId: 'image' }); assert.equal(media.sha256, await sha256Blob(blob));
  await assert.rejects(library.media({ caseId: 'case', assetId: 'another' }), { code: 'asset_not_in_case' });
});

test('creation saves sources and project with receipt in one commit, and lost acknowledgement cannot duplicate', async () => {
  const state = { entries: [{ id: 'source', title: '参考', url: 'https://example.org/' }], organizerState: { collections: [{ id: 'p', name: '项目' }] } };
  let commits = 0;
  const deps = { loadState: async () => state, transfers: { get: async () => assert.fail(), key: id => id }, buildEntry,
    classify: () => ({}), place: (_, entries, ids, placement) => ({ collections: state.organizerState.collections, placement, ids }),
    commit: async update => { commits++; Object.assign(state, update); }, notify: async () => {}, schemaVersion: 1 };
  const input = { title: '创作结果', text: '新脚本', kind: 'creation', project: '项目', sourceCaseIds: ['source'] };
  const result = await saveAgentMaterial(input, 'creation-1', deps);
  assert.equal(result.results[0].status, 'saved');
  assert.equal(state.entries[1].text, '新脚本');
  assert.equal(state.entries[1].agentProvenance.sources[0].caseId, 'source');
  assert.equal(state.organizerState.placement.collectionId, 'p');
  const selected = selectLibraryPackage({ ...state, taxonomy: createDefaultTaxonomy() }, [state.entries[1].id]);
  const restored = parseLibraryPackage({ ...selected, format: 'prompt-case-library', version: 3 });
  assert.deepEqual(restored.entries[0].agentProvenance, state.entries[1].agentProvenance);

  assert.equal((await saveAgentMaterial(input, 'creation-1', deps)).results[0].status, 'duplicate'); assert.equal(commits, 1);
});

function event() {
  const listeners = new Set();
  return { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f), emit: (...args) => Promise.all([...listeners].map(f => f(...args))) };
}
test('disabling during permission lookup cannot reconnect the library', async () => {
  const local = storage({ agentConnection: { enabled: true, instanceId: crypto.randomUUID() } });
  let release; let lookups = 0; let connects = 0;
  const chromeApi = { storage: { local }, runtime: { onStartup: event(), connectNative() { connects++; assert.fail(); } },
    permissions: { onRemoved: event(), contains: () => { lookups++; return new Promise(resolve => { release = resolve; }); } },
    alarms: { onAlarm: event(), clear: async () => {} } };
  const connection = createAgentConnection({ chromeApi, execute: async () => {} });
  const starting = connection.start(); await turn(); assert.equal(lookups, 1);
  await connection.setEnabled(false); release(true); await starting;
  assert.equal(connects, 0); assert.equal((await connection.snapshot()).enabled, false);
});

test('capture uses its own authorized tab and does not commit after navigation changes', async () => {
  let changed = false, commits = 0;
  const chromeApi = { permissions: { contains: async () => true }, tabs: { onUpdated: event(), onRemoved: event(),
    create: async value => { assert.equal(value.active, true); return { id: 1 }; },
    get: async () => ({ id: 1, status: 'complete', url: changed ? 'https://example.org/elsewhere' : 'https://example.org/article' }) } };
  const deps = { chromeApi, loadState: async () => ({ entries: [] }),
    collect: async () => ({ candidates: [{ id: 'candidate', title: '文章', canonicalUrl: 'https://example.org/article', contentText: '原文' }] }),
    commit: async batch => { commits++; assert.equal(batch.selections[0].includeText, true); return { ok: true, results: [{ status: 'saved', entryId: 'case' }] }; } };
  const result = await captureAgentUrl({ url: 'https://example.org/article' }, 'capture-1', deps);
  assert.equal(result.ok, true); assert.equal(commits, 1);
  const collect = deps.collect;
  deps.collect = async () => { changed = true; return collect(); };
  await assert.rejects(captureAgentUrl({ url: 'https://example.org/article' }, 'capture-2', deps), { code: 'page_changed' });
  assert.equal(commits, 1);
});

test('first native permission grant without a worker binding requests manual reload and preserves pairing', async () => {
  const instanceId = '9b51cf6b-8117-4245-ac01-9d679df45c22';
  const local = storage({ agentConnection: { enabled: true, instanceId } });
  let reloads = 0;
  const chromeApi = { storage: { local }, runtime: { id: 'test-extension', onStartup: event(), reload() { reloads++; } },
    permissions: { onRemoved: event(), contains: async () => true },
    alarms: { onAlarm: event(), clear: async () => {}, create: async () => {} } };
  const connection = createAgentConnection({ chromeApi, execute: async () => {} });
  const result = await connection.start();
  assert.equal(result.status, 'error');
  assert.match(result.error, /已授权.*重新加载/);
  assert.doesNotMatch(result.error, /is not a function/);
  assert.equal(result.enabled, true); assert.equal(result.instanceId, instanceId); assert.equal(reloads, 0);
  const port = { onMessage: event(), onDisconnect: event(), postMessage(message) { assert.equal(message.instanceId, instanceId); } };
  chromeApi.runtime.connectNative = () => port;
  const restarted = createAgentConnection({ chromeApi, execute: async () => {} });
  await restarted.start(); await port.onMessage.emit({ type: 'ready' });
  assert.equal((await restarted.snapshot()).status, 'connected');
  assert.equal((await restarted.snapshot()).instanceId, instanceId);
});


test('copying connection instructions creates stable identity without granting access', async () => {
  const store = storage();
  const event = { addListener() {} };
  const connection = createAgentConnection({ chromeApi: {
    storage: { local: store }, runtime: { onStartup: event },
    alarms: { onAlarm: event }, permissions: { onRemoved: event }
  }, execute() { assert.fail('copy does not execute library operations'); } });
  const results = await Promise.all([connection.prepare(), connection.prepare()]);
  assert.equal(results[0].instanceId, results[1].instanceId);
  assert.equal(results[0].enabled, false);
  const { agentConnectionRequest } = await import('../extension/agent-onboarding.js');
  const request = agentConnectionRequest(results[0].instanceId, 'zh_CN', 'https://github.com/example/project');
  assert(request.includes(results[0].instanceId)); assert(request.includes('/blob/main/connector/INSTALL.md'));
  assert.equal((await connection.prepare()).instanceId, results[0].instanceId);
});

test('large generation prompt conflicts are paged through task receipts without overflowing native messages', async () => {
  const large = '长提示词🌧'.repeat(120000);
  const store = storage();
  const tasks = createAgentTasks({ storage: store, execute: async () => ({ok:false,promptConflicts:[{assetId:'image',name:'image',token:'token',originalText:large,embeddedText:large+'new'}]}) });
  await tasks.submit('save_material',{},'large-conflict');await turn();
  const receipt=await tasks.inspect('large-conflict');
  assert.equal(receipt.state,'failed');assert.ok(JSON.stringify(receipt).length<2000);
  assert.equal(receipt.result.promptConflicts[0].originalCharacters,large.length);
  let text='',offset=0;
  do {const part=await tasks.inspect('large-conflict',{conflictToken:'token',conflictPart:'embeddedText',offset,length:49152});text+=part.content;offset=part.nextOffset;} while(offset!==null);
  assert.equal(text,large+'new');
  await assert.rejects(tasks.inspect('large-conflict',{conflictToken:'missing',conflictPart:'embeddedText'}),{code:'invalid_input'});
});
