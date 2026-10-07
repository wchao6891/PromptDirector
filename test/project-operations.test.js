import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectOperations, projectRevision } from '../extension/project-operations.js';
import { normalizeOrganizerState, renameCollection, mergeOrganizerStateWithMap } from '../extension/organizer.js';
import { saveAgentMaterial, resolveAgentProject } from '../extension/agent-save.js';
import { caseRevision, createCaseOperations } from '../extension/case-operations.js';
import { buildEntry } from '../extension/lib.js';
import { selectProjectPackage, parseLibraryPackage } from '../extension/library-package.js';
import { createDefaultTaxonomy } from '../extension/taxonomy.js';
import { withComposerCaseOperations } from '../extension/composer-case-operations.js';

function setup() {
  const state = { entries: [{ ...buildEntry({ title: '原始素材', text: '导演人工正文' }), id: 'reference',
    mediaAssets: [{ id: 'video', kind: 'video', durationMs: 5000, mimeType: 'video/mp4', storageMode: 'managed' }],
    primaryMediaId: 'video' }], organizerState: normalizeOrganizerState({ collections: [] }), compoundCases: [], taxonomy: createDefaultTaxonomy() };
  let commits = 0, fail = false, queue = Promise.resolve();
  const deps = { loadState: async () => structuredClone(state), storage: { get: async key => ({ [key]: state[key] }) },
    enqueue: fn => { const next = queue.then(fn, fn); queue = next.catch(() => {}); return next; },
    commit: async update => { if (fail) throw Error('disk full'); commits++; Object.assign(state, structuredClone(update)); } };
  const saveDeps = { ...deps, buildEntry, getInstanceId: async () => 'library', classify: () => ({}),
    transfers: { get: () => assert.fail('No files or copies for text creation') }, notify: async () => {}, schemaVersion: 1,
    place: (organizer, entries, ids, { collectionId }) => normalizeOrganizerState({ ...organizer,
      collections: organizer.collections.map(p => p.id === collectionId ? { ...p, entryIds: [...p.entryIds, ...ids] } : p) }, entries.map(e => e.id)) };
  return { state, api: createProjectOperations(deps), cases: createCaseOperations(deps), save: (input, requestId) => deps.enqueue(() => saveAgentMaterial(input, requestId, saveDeps)),
    get commits() { return commits; }, fail(value) { fail = value; } };
}

test('new nested project retains full requirements and retry acknowledges exactly one creation across restart', async () => {
  const run = setup();
  const root = await run.api.execute('create_project', { requestId: 'root', name: '电影' });
  const input = { requestId: 'child', name: '预告', parentId: root.project.id, requirements: '完整需求\n'.repeat(3000) };
  const result = await run.api.execute('create_project', input);
  assert.equal((await run.api.execute('create_project', input)).project.id, result.project.id);
  assert.equal(run.commits, 2);
  let content = '', offset = 0, revision;
  do {
    const page = await run.api.read({ offset, length: 123, ...(revision ? { expectedRevision: revision } : {}) });
    content += page.content; offset = page.nextOffset; revision = page.revision;
  } while (offset !== null);
  const child = JSON.parse(content)[1];
  assert.equal(child.requirements, input.requirements);
  assert.deepEqual(child.path.map(p => p.name), ['电影', '预告']);
  assert.equal(child.revision, result.project.revision);
  assert(!content.includes('apiKey')); assert(!content.includes('entryIds'));
  await assert.rejects(run.api.execute('create_project', { ...input, name: '另一项目' }), { code: 'request_conflict' });
  await assert.rejects(run.api.execute('create_project', { ...input, requestId: 'another' }), /已经存在/);
  run.state.organizerState = renameCollection(run.state.organizerState, child.id, '新名字');
  assert.equal(run.state.organizerState.collections[1].requirements, input.requirements);
  await assert.rejects(run.api.read({ offset: 10, expectedRevision: revision }), { code: 'project_conflict' });
});

test('same names under different parents require exact identity and ID takes precedence over another project name', async () => {
  const run = setup();
  const a = await run.api.execute('create_project', { requestId: 'a', name: '甲' });
  const b = await run.api.execute('create_project', { requestId: 'b', name: '乙' });
  const first = await run.api.execute('create_project', { requestId: 'a-child', name: '广告', parentId: a.project.id });
  await run.api.execute('create_project', { requestId: 'b-child', name: '广告', parentId: b.project.id });
  assert.throws(() => resolveAgentProject(run.state, '广告'), { code: 'ambiguous_project' });
  await run.api.execute('create_project', { requestId: 'name-id', name: first.project.id });
  assert.equal(resolveAgentProject(run.state, first.project.id), first.project.id);
  assert.equal(JSON.parse((await run.api.read({ projectId: a.project.id })).content).length, 2);
});

test('project updates reject stale versions; failed storage leaves project and acknowledgement untouched', async () => {
  const run = setup();
  const { project } = await run.api.execute('create_project', { requestId: 'new', name: '原名', requirements: '原要求' });
  const input = { requestId: 'edit', projectId: project.id, expectedRevision: project.revision, requirements: '更新要求' };
  run.fail(true); await assert.rejects(run.api.execute('update_project', input), /disk full/);
  assert.equal(run.state.organizerState.collections[0].requirements, '原要求');
  assert(!run.state['projectOperation:edit']);
  run.fail(false); await run.api.execute('update_project', input);
  assert.equal((await run.api.execute('update_project', input)).replayed, true);
  await assert.rejects(run.api.execute('update_project', { ...input, requestId: 'stale', name: '不能覆盖' }), { code: 'project_conflict' });
  assert.equal(run.state.organizerState.collections[0].name, '原名');
});

test('creation saves exact video range and project requirements version; second version keeps original and export preserves lineage', async () => {
  const run = setup(), before = structuredClone(run.state.entries[0]);
  const { project } = await run.api.execute('create_project', { requestId: 'new', name: '新片', requirements: '主角在雨中' });
  const ref = { caseId: 'reference', expectedRevision: await caseRevision(run.state, before), assetId: 'video', startMs: 100, endMs: 2300 };
  const input = { title: '第一稿', text: '镜头一：雨滴落下', kind: 'creation', project: project.id, projectRevision: project.revision, sourceReferences: [ref] };
  const first = await run.save(input, 'first'), firstId = first.results[0].entryId;
  const saved = structuredClone(run.state.entries.at(-1));
  assert.equal(saved.agentProvenance.references[0].endMs, 2300);
  assert.equal(saved.agentProvenance.sources[0].caseId, 'reference');
  assert.equal(saved.agentProvenance.creationVersion.number, 1);
  assert.equal((await run.save(input, 'first')).replayed, true);
  await assert.rejects(run.save({ ...input, text: '不能复用编号改写' }, 'first'), { code: 'request_conflict' });
  const currentProject = run.state.organizerState.collections[0];
  const next = { ...input, title: '第二稿', text: '镜头一：雨滴落在刀锋', projectRevision: await projectRevision(currentProject),
    previousCreation: { caseId: firstId, expectedRevision: await caseRevision(run.state, saved) } };
  await run.save(next, 'second');
  assert.deepEqual(run.state.entries[0], before); assert.deepEqual(run.state.entries[1], saved);
  const second = run.state.entries[2];
  assert.equal(second.agentProvenance.creationVersion.number, 2);
  assert.equal(second.agentProvenance.creationVersion.rootCaseId, firstId);
  assert.equal(second.agentProvenance.creationVersion.previous.caseId, firstId);
  const selected = selectProjectPackage(run.state, project.id);
  const restored = parseLibraryPackage({ ...selected, format: 'prompt-case-library', version: 3 });
  assert.equal(restored.organizerState.collections[0].requirements, '主角在雨中');
  assert.deepEqual(restored.entries.find(e => e.id === second.id).agentProvenance, second.agentProvenance);
  const details = await run.cases.read({ caseId: second.id, part: 'source' });
  assert.deepEqual(JSON.parse(details.content).provenance, second.agentProvenance);
});

test('wrong assets, stale source/project and out-of-range intervals never create misleading results', async () => {
  const run = setup();
  const { project } = await run.api.execute('create_project', { requestId: 'p', name: '项目' });
  const ref = { caseId: 'reference', expectedRevision: await caseRevision(run.state, run.state.entries[0]), assetId: 'video', startMs: 0, endMs: 1000 };
  const base = { title: '结果', text: '内容', kind: 'creation', project: project.id, sourceReferences: [ref] };
  for (const change of [{ assetId: 'missing' }, { endMs: 0 }, { endMs: 6000 }, { startMs: -1 }, { expectedRevision: 'stale' }, { assetId: undefined }]) {
    const bad = { ...ref, ...change }; if (bad.assetId === undefined) delete bad.assetId;
    await assert.rejects(run.save({ ...base, sourceReferences: [bad] }, 'bad'));
  }
  await assert.rejects(run.save({ ...base, previousCreation: { caseId: 'reference', expectedRevision: ref.expectedRevision } }, 'not-creation'));
  await run.api.execute('update_project', { requestId: 'change', projectId: project.id, expectedRevision: project.revision, requirements: '修改的需求' });
  await assert.rejects(run.save({ ...base, projectRevision: project.revision }, 'old-brief'), { code: 'project_conflict' });
  assert.equal(run.state.entries.length, 1);
});

test('internal creative workspace can create project and save text through the same domain services', async () => {
  const run = setup(), events = [];
  const wrapper = withComposerCaseOperations({ tools: { specs: [], instructions: '' }, session: { messages: [{ id: 'user' }], referenceSnapshots: [{ entryId: 'reference' }] },
    onEvent: event => events.push(event), invoke: (name, args) => {
      if (name === 'read_projects') return run.api.read(args);
      if (name === 'save_material') { const { requestId, ...input } = args; return run.save(input, requestId); }
      return run.api.execute(name, args);
    } });
  const created = (await wrapper.execute('create_project', { requestId: 'composer-project', name: '创作台项目' }, {})).data;
  const result = (await wrapper.execute('save_material', { requestId: 'composer-save', project: created.project.id, title: '脚本', text: '创作台正文', kind: 'creation', sourceCaseIds: ['reference'] }, {})).data;
  assert(result.ok); assert.equal(events.at(-1).candidates[0].caseId, result.results[0].entryId);
  const invalid = await wrapper.execute('save_material', { requestId: 'unknown', title: '正文', text: '不能引用未知案例', sourceCaseIds: ['unknown'] }, {});
  assert.match(invalid.data.error, /先查询/);
  assert.equal(run.state.entries.length, 2);
});


test('retrying an acknowledged save after later deletion cannot resurrect the creation', async () => {
  const run = setup(), input = {title:'草稿',text:'正文',kind:'creation'};
  const saved = await run.save(input,'retained-receipt');
  run.state.entries = run.state.entries.filter(e => e.id !== saved.results[0].entryId);
  const before = run.commits;
  const retry = await run.save(input,'retained-receipt');
  assert(retry.replayed); assert.equal(run.commits,before); assert.equal(run.state.entries.length,1);
});

test('imported project requirements do not overwrite or disappear behind a same-name local project', () => {
  const current = {collections:[{id:'p',name:'广告',entryIds:['local'],requirements:'本机人工要求'}]};
  const imported = {collections:[{id:'p',name:'广告',entryIds:['source'],requirements:'导入完整要求'},
    {id:'child',name:'分镜',parentId:'p',entryIds:[],requirements:'子项目要求'}]};
  const result = mergeOrganizerStateWithMap(current,imported,{source:'received'});
  assert.equal(result.state.collections.length,3);
  assert.equal(result.state.collections[0].requirements,'本机人工要求');
  const incoming = result.state.collections.find(p => p.id === result.collectionIdMap.p);
  assert.notEqual(incoming.id,'p'); assert.notEqual(incoming.name,'广告');
  assert.equal(incoming.requirements,'导入完整要求'); assert.deepEqual(incoming.entryIds,['received']);
  assert.equal(result.state.collections.find(p=>p.id==='child').parentId,incoming.id);
  const merged = mergeOrganizerStateWithMap({collections:[{id:'p',name:'广告',entryIds:[]}]},imported,{source:'received'});
  assert.equal(merged.state.collections[0].requirements,'导入完整要求');
});

test('save acknowledgement identifies persisted body, exact sources and project revision without routine extra reads', async () => {
  const run = setup();
  const { project } = await run.api.execute('create_project', { requestId: 'receipt-project', name: '保存回执' });
  const ref = { caseId: 'reference', expectedRevision: await caseRevision(run.state, run.state.entries[0]), assetId: 'video' };
  const result = await run.save({ title: '成果', text: '逐字保存的正文', kind: 'creation', project: project.id, projectRevision: project.revision, sourceReferences: [ref] }, 'receipt-save');
  const item = result.results[0], saved = run.state.entries.find(e => e.id === item.entryId);
  assert.equal(item.revision, await caseRevision(run.state, saved));
  assert.equal(item.project.id, project.id);
  assert.equal(item.project.revision, await projectRevision(run.state.organizerState.collections[0]));
  assert.deepEqual(item.sourceReferences, saved.agentProvenance.references);
  assert.equal(item.body.characters, saved.text.length);
  assert.match(item.body.sha256, /^[a-f0-9]{64}$/);
});

test('new materials save and read back authored fields, labels, source evidence and explicit classification through shared schemas', async () => {
  const run=setup(), pathIds=[run.state.taxonomy.nodes[0].id];
  const input={title:'新创作方案',text:'自己的方案正文',kind:'creation',creative:{prompt:'镜头创作词',summary:'提炼',notes:'待审',purpose:'广告',plan:'版本A'},customLabels:['人工选择'],classificationPathIds:pathIds,sourceFacts:{author:'明确提供的作者',license:'fixture license'}};
  const receipt=await run.save(input,'authored-new');assert(receipt.ok);
  const id=receipt.results[0].entryId;
  const creative=JSON.parse((await run.cases.read({caseId:id,part:'creative'})).content);
  assert.deepEqual(creative,input.creative);
  const annotations=JSON.parse((await run.cases.read({caseId:id,part:'annotations'})).content);
  assert.deepEqual(annotations.customLabels,input.customLabels);assert.deepEqual(annotations.classification.pathIds,pathIds);
  assert.equal(JSON.parse((await run.cases.read({caseId:id,part:'source'})).content).sourceFacts.author,input.sourceFacts.author);
  assert.equal(run.state.entries.length,2);
});
