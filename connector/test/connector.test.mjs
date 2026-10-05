import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { encodeFrame, frameDecoder, NATIVE_FROM_CHROME_MAX } from '../framing.mjs';
import { createAgentLibrary } from '../../extension/agent-library.js';
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

test('a large native response is assembled without copying the growing prefix for every pipe chunk', () => {
  const value = { data: 'a'.repeat(4 * 1024 * 1024) };
  const frame = encodeFrame(value, 64 * 1024 * 1024);
  let copied = 0;
  const concat = Buffer.concat;
  const messages = [];
  try {
    Buffer.concat = (parts, ...args) => { copied += parts.reduce((sum, part) => sum + part.length, 0); return concat(parts, ...args); };
    const decode = frameDecoder(message => messages.push(message));
    for (let offset = 0; offset < frame.length; offset += 32 * 1024) decode(frame.subarray(offset, offset + 32 * 1024));
  } finally { Buffer.concat = concat; }
  assert.deepEqual(messages, [value]);
  assert(copied <= frame.length * 3, `Frame assembly copied ${copied} bytes for a ${frame.length} byte response`);
});

test('large original crosses the authenticated native broker in full and verified local cache stays current', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-large-original-'));
  const input = new PassThrough(), output = new PassThrough();
  const extensionId = 'd'.repeat(32), instanceId = randomUUID();
  const bytes = Buffer.alloc(32 * 1024 * 1024 + 47, 109);
  const hash = createHash('sha256').update(bytes).digest('hex');
  let reads = 0;
  const library = createAgentLibrary({loadState:async()=>({entries:[{id:'case', mediaAssets:[{id:'original',kind:'video',mimeType:'video/mp4'}]}]}),readBlob:async()=>new Blob([bytes],{type:'video/mp4'})});
  await writeFile(join(root, 'config.json'), JSON.stringify({ extensionId }));
  await writeFile(join(root, 'selected.json'), JSON.stringify({ instanceId }));
  let ready; const readiness = new Promise(resolve => { ready = resolve; });
  output.on('data', frameDecoder(message => {
    if (message.type === 'ready') ready();
    else if (message.type === 'request') {
      reads++;
      void library.media(message.input).then(result=>{
        const frame=encodeFrame({type:'response',id:message.id,result},NATIVE_FROM_CHROME_MAX);
        for(let offset=0;offset<frame.length;offset+=32*1024) input.write(frame.subarray(offset,offset+32*1024));
      });
    }
  }));
  const host = await startNativeHost({ root, origin:`chrome-extension://${extensionId}/`, input, output });
  try {
    input.write(encodeFrame({type:'hello',protocolVersion:1,extensionId,instanceId}));await readiness;
    const call=(op,args)=>callExtension(op,args,{root});
    const result=await receiveMedia({caseId:'case',assetId:'original'},call,root);
    assert.equal(result.byteSize,bytes.length);assert.equal(result.sha256,hash);
    assert.deepEqual(await readFile(result.path),bytes);assert.equal(reads,3);
    const cached=await receiveMedia({caseId:'case',assetId:'original'},call,root);
    assert.equal(cached.path,result.path);assert.equal(reads,4,'A cache hit still consults the current library');
  } finally {await host.close();input.destroy();output.destroy();await rm(root,{recursive:true,force:true});}
});

test('real native broker binds one library, authenticates and forwards response', { timeout: process.platform === 'win32' ? 30000 : 5000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-'));
  const input = new PassThrough(), output = new PassThrough();
  const extensionId = 'a'.repeat(32), instanceId = randomUUID();
  await writeFile(join(root, 'config.json'), JSON.stringify({ extensionId }));
  await writeFile(join(root, 'selected.json'), JSON.stringify({ instanceId }));
  let ready; const readiness = new Promise(resolve => { ready = resolve; });
  output.on('data', frameDecoder(message => {
    if (message.type === 'ready') ready();
    else if (message.type === 'request') input.write(encodeFrame({ type: 'response', id: message.id, result: message.operation === 'status' ? { sourceProtectionVersion: 1 } : { operation: message.operation, input: message.input } }));
  }));
  const host = await startNativeHost({ root, origin: `chrome-extension://${extensionId}/`, input, output });
  try {
    input.write(encodeFrame({ type: 'hello', protocolVersion: 1, extensionId, instanceId }));
    await readiness;
    assert.deepEqual(await callExtension('search', { query: '案例' }, { root }), { operation: 'search', input: { query: '案例' } });
    const client = new Client({ name: 'full-path-test', version: '1' });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp.mjs', import.meta.url))], env: { ...process.env, PROMPTDIRECTOR_CONNECTOR_HOME: root } }));
      const response = await client.callTool({ name: 'promptdirector_search_cases', arguments: { query: '素材' } });
      const content = JSON.parse(response.content[0].text);
      assert.equal(content.operation, 'search'); assert.equal(content.input.query, '素材');
      for (const [name, args] of [
        ['search_cases', { query: '动作', mediaKind: 'video', hasOriginalPrompt: true, alternatives: ['打斗'], sort: 'newest', minDurationMs: 1000, maxDurationMs: 5000, expectedRevision: 'search-version', countOnly: false, offset: 0, limit: 24 }],
        ['read_live_workspace', { tabId: 7 }],
        ['wait_workspace_changes', { tabId: 7, afterRevision: 'page:1', waitMs: 15000 }],
        ['control_workspace', { tabId: 7, expectedRevision: 'page:2', requestId: 'visible', action: 'set_loop', enabled: true, startMs: 100, endMs: 2000 }],
        ['read_workspace_content', { part: 'selection', expectedRevision: 'selected-version', offset: 0, length: 49152 }],
        ['manage_analysis_batch',{action:'create',requestId:'batch',instruction:'分析',items:[{caseId:'case',expectedRevision:'revision',assets:[]}]}],
        ['list_analysis_batches',{query:'广告',status:'partial'}],
        ['read_analysis_batch',{batchId:'batch',part:'items',offset:24,expectedRevision:2}],
        ['submit_analysis_results',{requestId:'page',batchId:'batch',epoch:0,items:[{caseId:'case',attemptId:'attempt',result:{tags:[{g:'scene.place'}]}}]}],
        ['submit_analysis_result',{requestId:'result',batchId:'batch',caseId:'case',epoch:0,attemptId:'attempt',result:{tags:[{g:'scene.place'}]}}],
        ['list_skills', {query: '动作'}],
        ['read_skill', {skillId: 'skill', part: 'files', expectedRevision: 'revision', offset: 0, length: 31}],
        ['read_skill_file', {skillId: 'skill', expectedRevision: 'revision', source: 'package', path: 'scripts/frames.py', encoding: 'text'}],
        ['read_projects', { offset: 0, length: 31 }],
        ['read_projects', { name: '目标项目' }],
        ['read_projects', { path: ['父项目', '目标项目'] }],
        ['create_project', { requestId: 'project', name: '子项目', parentId: 'parent', requirements: '完整要求' }],
        ['update_project', { requestId: 'brief', projectId: 'parent', expectedRevision: 'version', requirements: '新要求' }],
        ['read_case_details', { caseId: 'case', part: 'source', length: 31 }],
        ['read_case_details', { caseId: 'case', part: 'analysis_coverage' }],
        ['submit_analysis_result',{requestId:'complete-result',batchId:'batch',caseId:'case',epoch:0,attemptId:'attempt',result:{
          imageAnalyses:[{assetId:'image',reconstructionPrompt:'完整图片',tags:[{g:'scene.place',t:'摄影棚'}]}],
          videoAnalyses:[{assetId:'video',reconstructionPrompt:'完整视频',tags:Array.from({length:4},(_,i)=>({g:`group${i}`,t:'标签'})),uncertainties:['焦距未知'],analysisScope:'visual'}],
          visualSetAnalyses:[{assetIds:['image'],imageRoles:[{assetId:'image',role:'角色'}],sharedVisualSystem:[],differences:[],continuity:[],compositionRules:[],reusablePrompt:'整组提示词'}]
        }}],
        ['edit_case', { requestId: 'edit', caseId: 'case', expectedRevision: 'version', patch: { sourceFacts: { engagement: null }, title: '新标题' } }],
        ['organize_case', { requestId: 'split', caseId: 'case', expectedRevision: 'version', action: 'split_media', groups: [{ assetIds: ['media'], title: '独立案例', text: '', sourceUrl: 'https://example.com/post' }] }]
      ]) {
        const response = await client.callTool({ name: `promptdirector_${name}`, arguments: args });
        assert(!response.isError, JSON.stringify(response));
        const expectedInput = name === 'read_workspace_content' ? { source: 'selection', ...args } : args;
        assert.deepEqual(JSON.parse(response.content[0].text), { operation: name === 'search_cases' ? 'search' : name, input: expectedInput });
      }
    } finally { await client.close(); }
    await assert.rejects(startNativeHost({ root, origin: `chrome-extension://${'b'.repeat(32)}/`, input: new PassThrough(), output }), /identity/);
  } finally { await host.close(); input.destroy(); output.destroy(); await rm(root, { recursive: true, force: true }); }
});

test('SDK client performs real stdio MCP handshake and discovers bounded tools', async () => {
  const client = new Client({ name: 'connector-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp.mjs', import.meta.url))] });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 33);
    assert(list.tools.some(tool => tool.name === 'promptdirector_capture_url'));
    const organize = list.tools.find(tool => tool.name === 'promptdirector_organize_case').inputSchema.properties;
    assert(organize.action.enum.includes('combine_cases'));
    assert(organize.action.enum.includes('split_compound'));
    assert(organize.additionalCases.items.properties.expectedRevision);
    const edit = list.tools.find(tool => tool.name === 'promptdirector_edit_case').inputSchema.properties.patch.properties;
    assert(edit.coverVisualId);
    const result=list.tools.find(tool=>tool.name==='promptdirector_submit_analysis_result').inputSchema.properties.result.properties;
    assert(result.imageAnalyses.items.properties.reconstructionPrompt);
    assert(result.videoAnalyses.items.properties.uncertainties);
    assert(result.visualSetAnalyses.items.properties.imageRoles);
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

test('installer creates a reviewable private runtime and origin-bound registration in an isolated directory', { timeout: process.platform === 'win32' ? 60000 : 10000 }, async () => {
  const { installationPlan, install, pair } = await import('../install.mjs');
  const root = await mkdtemp(join(tmpdir(), process.platform === 'win32' ? 'pd 案例 ! 100% ' : 'pd-'));
  const extensionId = 'c'.repeat(32), instanceId = randomUUID();
  try {
    const plan = await installationPlan({ root, nativeDirectory: join(root, 'registration'), extensionId });
    await install(plan, { register: async () => {} });
    await install(plan, { register: async () => {} }); // Updating keeps the same runtime and pairing location.
    const installedSpecs=await import(pathToFileURL(join(root,'extension/analysis-batch-specs.js')).href);
    assert(installedSpecs.ANALYSIS_RESULT_FIELDS.includes('imageAnalyses'));
    const manifest = JSON.parse(await readFile(plan.registration, 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
    assert.equal(manifest.path, plan.launcher);
    assert((await readFile(plan.launcher, 'utf8')).includes('PROMPTDIRECTOR_CONNECTOR_HOME'));
    const { instancePaths } = await import('../paths.mjs');
    await writeFile(instancePaths(root, instanceId).record, JSON.stringify({ instanceId, secret: 'a'.repeat(64) }));
    const paired = await pair(instanceId, root); assert.equal(paired.instanceId, instanceId);
    const native = process.platform === 'win32'
      ? spawn(process.env.ComSpec, ['/d', '/s', '/c', `""${plan.launcher}" chrome-extension://${extensionId}/"`], { windowsVerbatimArguments: true, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(plan.launcher, [`chrome-extension://${extensionId}/`], { stdio: ['pipe', 'pipe', 'pipe'] });
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
    try { await client.connect(new StdioClientTransport(paired.mcp)); assert.equal((await client.listTools()).tools.length, 33); }
    finally { await client.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('CLI discovers the same MCP operations without a second command registry', {timeout:5000}, async () => {
  const {callFromCli}=await import('../call.mjs');
  const result=await callFromCli('list');
  assert.equal(result.tools.length,33);
  assert(result.tools.some(tool=>tool.name==='promptdirector_read_workspace_context'));
  await assert.rejects(callFromCli('not_a_real_operation'), /not|unknown|不存在/i);
});

test('MCP save returns completion in one tool round; lost wait replies and old running backends retain the same task identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd-save-wait-'));
  const input = new PassThrough(), output = new PassThrough();
  const extensionId = 'a'.repeat(32), instanceId = randomUUID();
  await writeFile(join(root, 'config.json'), JSON.stringify({ extensionId }));
  await writeFile(join(root, 'selected.json'), JSON.stringify({ instanceId }));
  const tasks = new Map(), calls = []; let saves = 0, loseReply = false, oldBackend = false, selectionChanged = false;
  let ready; const readiness = new Promise(resolve => { ready = resolve; });
  output.on('data', frameDecoder(message => {
    if (message.type === 'ready') return ready();
    if (message.type !== 'request') return;
    calls.push(message.operation);
    const { requestId } = message.input;
    let result, error;
    if (message.operation === 'read_workspace_context') result = { revision: 'current-selection', selectedCaseCount: 2 };
    else if (message.operation === 'read_workspace_content') {
      assert.equal(message.input.expectedRevision, 'current-selection');
      if (selectionChanged) error = { code: 'selection_changed', message: 'Selection changed between the reads' };
      else result = { revision: 'current-selection', content: 'complete original prompts', nextOffset: null };
    } else if (message.operation === 'save_material') {
      if (!tasks.has(requestId)) { saves++; tasks.set(requestId, { id: requestId, state: 'completed', result: { ok: true, results: [{ status: 'saved', entryId: requestId }] } }); }
      result = { id: requestId, state: 'queued' };
    } else if (message.operation === 'get_task') {
      assert.equal(message.input.waitMs, 15000);
      if (loseReply) error = { code: 'connector_offline', message: 'Lost acknowledgement' };
      else result = oldBackend ? { id: requestId, state: 'running' } : tasks.get(requestId);
    } else assert.fail(`Unexpected operation ${message.operation}`);
    input.write(encodeFrame({ type: 'response', id: message.id, ...(error ? { error } : { result }) }));
  }));
  const host = await startNativeHost({ root, origin: `chrome-extension://${extensionId}/`, input, output });
  const client = new Client({ name: 'save-wait-test', version: '1' });
  try {
    input.write(encodeFrame({ type: 'hello', protocolVersion: 1, extensionId, instanceId })); await readiness;
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../mcp.mjs', import.meta.url))], env: { ...process.env, PROMPTDIRECTOR_CONNECTOR_HOME: root } }));
    const save = async requestId => {
      const response = await client.callTool({ name: 'promptdirector_save_material', arguments: { requestId, title: 'Fixture', text: 'Complete text' } });
      assert(!response.isError, JSON.stringify(response)); return JSON.parse(response.content[0].text);
    };
    assert.equal((await save('first')).state, 'completed');
    assert.deepEqual(calls, ['save_material', 'get_task']);
    loseReply = true;
    const uncertain = await save('second');
    assert.equal(uncertain.id, 'second'); assert.equal(uncertain.state, 'queued');
    assert.equal(uncertain.waitError.code, 'connector_offline');
    loseReply = false;
    assert.equal((await save('second')).result.results[0].entryId, 'second');
    assert.equal(saves, 2, 'Lost acknowledgement must never trigger a second save');
    oldBackend = true; assert.equal((await save('old')).state, 'running');
    calls.length = 0;
    const read = args => client.callTool({ name: 'promptdirector_read_workspace_content', arguments: args });
    const full = await read({ part: 'selection' });
    assert.equal(JSON.parse(full.content[0].text).content, 'complete original prompts');
    assert.deepEqual(calls, ['read_workspace_context', 'read_workspace_content']);
    calls.length = 0;
    assert.equal((await read({ part: 'selection', offset: 1 })).isError, true);
    assert.equal((await read({ part: 'reference', referenceId: 'ref' })).isError, true);
    assert.deepEqual(calls, [], 'An unpinned continuation must never get a fresh version');
    await read({ part: 'selection', expectedRevision: 'current-selection', offset: 1 });
    assert.deepEqual(calls, ['read_workspace_content'], 'Reuse an existing version without rediscovery');
    selectionChanged = true;
    const changed = await read({ part: 'selection' });
    assert.equal(changed.isError, true); assert.equal(JSON.parse(changed.content[0].text).code, 'selection_changed');
  } finally { await client.close(); await host.close(); input.destroy(); output.destroy(); await rm(root, { recursive: true, force: true }); }
});
