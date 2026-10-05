import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createMediaStage, createStagedMediaRegistry } from '../extension/staged-media.js';

const source = path => readFileSync(new URL(`../extension/${path}`, import.meta.url), 'utf8');
function actualFunction(path, name) {
  const text = source(path);
  const found = new RegExp(`(?:async )?function ${name}\\(`).exec(text);
  assert.ok(found, `actual ${name} exists`);
  const following = text.slice(found.index).match(/\n(?:async )?function /);
  return text.slice(found.index, following ? found.index + following.index : text.length);
}
const noop = () => {};
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a pending title edit and later classification preserve both edits in the capture draft', async () => {
  const requests = [];
  let titleChanged;
  const context = vm.createContext({
    draft: { id: 'draft', title: 'old', contentTypeId: 'old-type' }, metadataUpdates: Promise.resolve(true),
    elements: { draftTitle: { value: 'new-title', addEventListener: (type, handler) => { titleChanged = handler; } } },
    chrome: { runtime: { sendMessage: message => new Promise(resolve => requests.push({ message, resolve })) } },
    render: noop, showFeedback: noop
  });
  vm.runInContext(actualFunction('collector.js', 'updateDraft') + '\n' + actualFunction('collector.js', 'updateCaptureMetadata'), context);
  vm.runInContext(source('collector.js').split('\n').find(line => line.startsWith('elements.draftTitle.addEventListener')), context);
  titleChanged();
  const later = context.updateCaptureMetadata({ contentTypeId: 'new-type', contentTypeExplicit: true });
  await tick();
  while (requests.length) { const { message, resolve } = requests.shift(); resolve({ ok: true, draft: message.draft }); await tick(); }
  await later;
  assert.equal(context.draft.title, 'new-title', 'saving classification must not restore a stale title');
  assert.equal(context.draft.contentTypeId, 'new-type');
});

function skillContext() {
  let release;
  const controller = new AbortController();
  const run = { controller, skillId: 'A', view: 'refine', draftMarkdown: 'draft A', totalUnits: 1, completedUnits: 0 };
  const context = vm.createContext({ DOMException, activeView: 'refine', activeSkillId: 'A', activeSkillRun: run,
    elements: { skillGoal: { value: 'goal A' }, skillTextInstruction: { value: 'instruction A' },
      skillMarkdown: { value: 'draft A' }, skillCallName: { value: 'A' }, skillDescription: { value: 'A' },
      skillDraftStep: {}, skillRunPanel: {}, skillStopRun: {}, skillRunProgress: {}, skillGenerationFeedback: {} },
    extractCreativeSkillDraftBatched: () => new Promise(resolve => { release = resolve; }),
    visualSuccesses: [], currentLocale: () => 'zh', completeSkillRunUnit: noop, touchSkillRun: noop,
    updateSkillRun: noop, clearSkillRunTimers: noop, t: value => value, appendSkillRunLog: noop,
    showDraftResult: noop, setTaskProgress: noop, setFeedback: noop, setTaskFeedbackState: noop, renderSkillRunStages: noop,
    confirmAppAction: async () => false });
  for (const name of ['isCurrentSkillRun', 'assertCurrentSkillRun']) {
    if (source('skills-page.js').includes(`function ${name}(`)) vm.runInContext(actualFunction('skills-page.js', name), context);
  }
  vm.runInContext(actualFunction('skills-page.js', 'finishSkillRun') + '\n' + actualFunction('skills-page.js', 'generateTextDraft'), context);
  return { context, controller, run, release: value => release(value) };
}

test('leaving Skill A cancels its request and late output cannot overwrite Skill B', async () => {
  const { context, controller, release } = skillContext();
  const pending = context.generateTextDraft({}, []);
  context.finishSkillRun(); context.activeSkillId = 'B'; context.elements.skillMarkdown.value = 'B human draft';
  release({ markdown: 'late A', model: 'fixture' });
  await pending.catch(error => { assert.equal(error.name, 'AbortError'); });
  assert.equal(context.elements.skillMarkdown.value, 'B human draft');
  assert.equal(controller.signal.aborted, true, 'leaving must cancel an ongoing paid request');
});

test('typing in the same Skill during extraction does not silently replace that human draft', async () => {
  const { context, release } = skillContext();
  const pending = context.generateTextDraft({}, []);
  context.elements.skillMarkdown.value = 'human edit while awaiting AI';
  release({ markdown: 'AI result', model: 'fixture' }); await pending;
  assert.equal(context.elements.skillMarkdown.value, 'human edit while awaiting AI');
});

test('human edits during the visual preparation phase are still protected when text extraction starts', async () => {
  const { context, release } = skillContext();
  context.elements.skillMarkdown.value = 'human edit during visual analysis';
  const pending = context.generateTextDraft({}, []);
  release({ markdown: 'AI result after vision', model: 'fixture' }); await pending;
  assert.equal(context.elements.skillMarkdown.value, 'human edit during visual analysis');
});

test('a current Skill request can apply its completed draft and leave generation ready', async () => {
  const { context, release } = skillContext();
  const pending = context.generateTextDraft({}, []);
  release({ markdown: 'new AI method', model: 'fixture' }); await pending;
  assert.equal(context.elements.skillMarkdown.value, 'new AI method');
  assert.equal(context.elements.skillDraftStep.hidden, false);
  assert.equal(context.activeSkillRun, null);
});

test('an edited Skill draft is replaced only when its owner explicitly confirms', async () => {
  const { context, release } = skillContext();
  let confirmations = 0;
  context.confirmAppAction = async () => { confirmations += 1; return true; };
  const pending = context.generateTextDraft({}, []);
  context.elements.skillMarkdown.value = 'human edit';
  release({ markdown: 'approved AI result', model: 'fixture' }); await pending;
  assert.equal(confirmations, 1);
  assert.equal(context.elements.skillMarkdown.value, 'approved AI result');
});

test('a late visual batch cannot add Skill A analysis to a new Skill B run', async () => {
  const { context, controller } = skillContext();
  let release;
  Object.assign(context, {
    renderContactSheetBatch: async () => ({ blob: new Blob(['image']) }), blobToDataUrl: async () => 'fixture',
    getMediaBlob: noop, analyzeCreativeSkillVisualBatch: () => new Promise(resolve => { release = resolve; }), visualFailures: [],
    elements: { ...context.elements, skillVisionInstruction: { value: '' }, skillRetryVision: {} }
  });
  vm.runInContext(actualFunction('skills-page.js', 'runVisualBatches'), context);
  const pending = context.runVisualBatches([{ items: [] }], { settings: { visionRuntime: { available: true } } });
  await tick();
  context.finishSkillRun(); context.activeSkillId = 'B';
  const nextRun = { controller: new AbortController(), skillId: 'B', view: 'refine' };
  context.activeSkillRun = nextRun; context.visualSuccesses = ['B analysis'];
  release({ description: 'late A image analysis', model: 'fixture' });
  await assert.rejects(pending, { name: 'AbortError' });
  assert.deepEqual(context.visualSuccesses, ['B analysis']);
  assert.equal(context.activeSkillRun, nextRun);
  assert.equal(controller.signal.aborted, true);
});

function curatedContext(mode) {
  const entry = { id: 'source', curatedOrigin: { sourceEntryId: 'S' }, mediaAssets: [{ id: 'asset', storageMode: 'managed', assetPath: 'assets/A' }] };
  const originals = new Set(), referenced = new Set(), deleted = [];
  const stageRecords = {};
  const registry = createStagedMediaRegistry({ storage: {
    get: async key => structuredClone({ [key]: stageRecords[key] }),
    set: async update => Object.assign(stageRecords, structuredClone(update))
  }, activeDocuments: async () => ['page'], cleanup: async ids => {
    for (const id of ids) if (!referenced.has(id)) { deleted.push(id); originals.delete(id); }
  } });
  let release = Promise.resolve();
  const context = vm.createContext({ Set, Blob, listenForProgress: () => noop,
    loadPackageIndex: async () => ({ library: { entries: [entry] }, reader: { read: async () => new Map() } }),
    prepareCuratedEntriesPackage: value => value, prepareCuratedEntryPackage: value => value,
    parseLibraryPackage: () => ({ entries: [entry], assets: new Map([['asset', new Blob(['ORIGINAL'])]]) }),
    saveMediaBlob: async id => { originals.add(id); }, deleteMediaBlob: async id => { deleted.push(id); originals.delete(id); }, emitProgress: noop,
    chrome: { runtime: { sendMessage: async message => {
      if (message.type === 'REGISTER_STAGED_MEDIA') { await registry.register(message.operationId, 'page', message.assetIds); return { ok: true }; }
      if (message.type === 'RELEASE_STAGED_MEDIA') { release = registry.release(message.operationId, 'page'); await release; return { ok: true }; }
      if (message.type === 'PREVIEW_CURATED_IMPORT') return { ok: true, importedSourceEntryIds: ['S'] };
      if (message.type === 'APPLY_CURATED_IMPORT') {
        if (mode === 'before-commit') return { ok: false, message: 'commit rejected' };
        referenced.add('asset');
        if (mode === 'reply-lost') throw new Error('reply lost after commit');
        return { ok: true, importedVisualIds: ['asset'], warnings: ['saved; auxiliary analysis failed'] };
      }
      if (message.type === 'DISCARD_UNREFERENCED_MEDIA') { for (const id of message.assetIds) if (!referenced.has(id)) { deleted.push(id); originals.delete(id); } return { ok: true }; }
      throw new Error(`unexpected message ${message.type}`);
    } } } });
  context.createMediaStage = () => createMediaStage(context.chrome);
  vm.runInContext(actualFunction('curated-page.js', 'saveCuratedSelection'), context);
  return { context, originals, referenced, deleted, settled: () => release };
}

test('a curated import failure after commit only discards unreferenced staging originals', async () => {
  const { context, originals, deleted, settled } = curatedContext('reply-lost');
  await assert.rejects(context.saveCuratedSelection({ id: 'P', caseCount: 1 }, ['S'], { mode: 'case' }), /reply lost after commit/);
  await settled();
  assert.ok(originals.has('asset'), 'a committed case must keep its referenced original even when the reply is lost');
  assert.deepEqual(deleted, []);
});

test('a curated commit rejection still cleans up its unreferenced staging original', async () => {
  const { context, originals, deleted, settled } = curatedContext('before-commit');
  await assert.rejects(context.saveCuratedSelection({ id: 'P', caseCount: 1 }, ['S'], { mode: 'case' }), /commit rejected/);
  await settled();
  assert.equal(originals.size, 0);
  assert.deepEqual(deleted, ['asset']);
});

test('a committed curated import with auxiliary warnings remains a success and keeps the original', async () => {
  const { context, originals, deleted, settled } = curatedContext('warnings');
  const result = await context.saveCuratedSelection({ id: 'P', caseCount: 1 }, ['S'], { mode: 'case' });
  await settled();
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
  assert.ok(originals.has('asset'));
  assert.deepEqual(deleted, []);
});
