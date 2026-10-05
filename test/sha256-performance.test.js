import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Blob } from '../extension/blob-digest.js';
import { prepareLocalMedia } from '../extension/local-media.js';
import { createCaseTextPager } from '../extension/case-text-page.js';
import { createCreativeSkill } from '../extension/creative-skills.js';
import { createSkillOperations } from '../extension/skill-operations.js';
import { createAgentTransfers } from '../extension/agent-transfers.js';
import { reusableAgentFile } from '../extension/agent-transfer-reuse.js';
import { saveAgentMaterial } from '../extension/agent-save.js';
import { AGENT_CHUNK_BYTES } from '../extension/agent-protocol.js';

test('preparing a verified upload does not scan its bytes again; ordinary imports still compute their identity', async () => {
  const file = new File(['original notes'], 'notes.txt', { type: 'text/plain' });
  const expected = await sha256Blob(file);
  let scans = 0;
  const stream = file.stream.bind(file);
  file.stream = () => { scans++; return stream(); };
  const verified = await prepareLocalMedia(file, 'verified', { verifiedContentHash: expected });
  assert.equal(verified.asset.contentHash, expected);
  assert.equal(verified.contentText, 'original notes');
  assert.equal(scans, 0);
  assert.equal((await prepareLocalMedia(file, 'ordinary')).asset.contentHash, expected);
  assert.equal(scans, 1);
});

test('ready reuse skips the middle scan while final saving still rejects same-size changed originals', async () => {
  const blob = new Blob(['original'], { type: 'image/png' });
  const sha256 = await sha256Blob(blob);
  let scans = 0, current = blob;
  const stream = blob.stream.bind(blob);
  blob.stream = () => { scans++; return stream(); };
  const state = { entries: [{ id: 'case', mediaAssets: [{ id: 'image', kind: 'image', storageMode: 'managed',
    mimeType: blob.type, byteSize: blob.size, contentHash: sha256 }] }] };
  const data = {};
  const transfers = createAgentTransfers({ storage: {
    get: async key => key === null ? { ...data } : { [key]: data[key] },
    set: async values => Object.assign(data, values), remove: async key => { delete data[key]; }
  }, readBlob: async () => current, reuse: record => reusableAgentFile(record, state, async () => current) });
  await transfers.begin({ id: 'reuse', name: 'image.png', mimeType: blob.type, byteSize: blob.size, sha256 });
  assert.equal(scans, 1);
  await transfers.finish({ id: 'reuse' });
  await transfers.finish({ id: 'reuse' });
  assert.equal(scans, 1, 'Ready acknowledgements do not repeat the successful reuse scan');
  current = new Blob(['replaced'], { type: blob.type });
  assert.equal(current.size, blob.size);
  await transfers.finish({ id: 'reuse' });
  await assert.rejects(saveAgentMaterial({ title: 'Result', text: 'Notes', transferIds: ['reuse'] }, 'save', {
    loadState: async () => state, transfers, readBlob: async () => current,
    commit: async () => assert.fail('Changed bytes must not be committed')
  }), { code: 'integrity_failed' });
});

test('long text pagination hashes unchanged text once and detects equal-length edits and different requested parts', async () => {
  let scans = 0;
  const page = createCaseTextPager({ digest: blob => { scans++; return sha256Blob(blob); } });
  const input = { caseId: 'case', part: 'body', text: 'original text '.repeat(10000), offset: 0, length: 12000 };
  let result = await page(input), content = result.content;
  while (result.nextOffset !== null) {
    result = await page({ ...input, offset: result.nextOffset, expectedRevision: result.revision });
    content += result.content;
  }
  assert.equal(content, input.text);
  assert.equal(scans, 1);
  await assert.rejects(page({ ...input, text: 'X' + input.text.slice(1), offset: 1, expectedRevision: result.revision }), { code: 'case_text_changed' });
  assert.equal(scans, 2);
  await assert.rejects(page({ ...input, part: 'original_prompt', expectedRevision: result.revision }), { code: 'case_text_changed' });
});

test('evicting text cache releases work but preserves deterministic pagination and full text', async () => {
  let scans = 0;
  const page = createCaseTextPager({ budget: { maxRequests: 1, maxTextBytes: 8 },
    digest: blob => { scans++; return sha256Blob(blob); } });
  const input = { caseId: 'first', part: 'body', text: 'long original', offset: 0, length: 4 };
  const first = await page(input);
  await page({ ...input, caseId: 'other' });
  const resumed = await page({ ...input, offset: first.nextOffset, expectedRevision: first.revision });
  assert.equal(resumed.revision, first.revision);
  assert.equal(resumed.totalCharacters, input.text.length);
  assert.equal(scans, 3);
});

function skillReader({ blob, hash, budget } = {}) {
  let current = blob, scans = 0, decodes = 0;
  const created = createCreativeSkill({}, { callName: 'File reader', portableId: 'reader', description: 'Read originals', skillMarkdown: 'Read.',
    packageFiles: [{ path: 'references/original.txt', assetId: 'original', ...(hash ? { sha256: hash } : {}) }] });
  const state = { creativeSkills: created.state };
  const options = { loadState: async () => structuredClone(state), budget,
    // Real IndexedDB returns new wrappers even when the file has not changed.
    readBlob: async () => {
      if (!current) return null;
      const wrapper = new Blob([current], { type: current.type });
      const arrayBuffer = wrapper.arrayBuffer.bind(wrapper);
      wrapper.arrayBuffer = () => { decodes++; return arrayBuffer(); };
      return wrapper;
    }, digest: value => { scans++; return sha256Blob(value); } };
  return { service: createSkillOperations(options), restart: () => createSkillOperations(options), state,
    input: { skillId: created.skill.id, source: 'package', path: 'references/original.txt' },
    get scans() { return scans; }, get decodes() { return decodes; }, set current(value) { current = value; } };
}

test('Skill text pages hash and decode a stored snapshot once despite new storage Blob wrappers', async () => {
  const text = 'Full original 原文\n'.repeat(30000);
  const f = skillReader({ blob: new Blob([text]) });
  f.input.expectedRevision = (await f.service.execute('read_skill', { skillId: f.input.skillId })).revision;
  let result = await f.service.execute('read_skill_file', f.input), content = result.content;
  while (result.nextOffset !== null) {
    result = await f.service.execute('read_skill_file', { ...f.input, offset: result.nextOffset,
      expectedRevision: result.revision, expectedHash: result.sha256 });
    content += result.content;
  }
  assert.equal(content, text);
  assert.equal(f.scans, 1);
  assert.equal(f.decodes, 1);
  f.current = null;
  await assert.rejects(f.service.execute('read_skill_file', { ...f.input, offset: 1,
    expectedRevision: result.revision, expectedHash: result.sha256 }), { code: 'skill_file_missing' });
});

test('Skill byte pages stay on one verified snapshot; a fresh read or worker restart cannot hide changed bytes', async () => {
  const bytes = new Uint8Array(AGENT_CHUNK_BYTES * 2 + 31).fill(65);
  const original = new Blob([bytes]);
  const hash = await sha256Blob(original);
  const f = skillReader({ blob: original, hash });
  f.input.expectedRevision = (await f.service.execute('read_skill', { skillId: f.input.skillId })).revision;
  const input = { ...f.input, encoding: 'binary' };
  const first = await f.service.execute('read_skill_file', input);
  bytes.fill(66); f.current = new Blob([bytes]);
  const continuation = { ...input, offset: first.nextOffset, expectedRevision: first.revision, expectedHash: hash };
  const next = await f.service.execute('read_skill_file', continuation);
  assert(Buffer.from(next.data, 'base64').every(byte => byte === 65), 'Never splice replacement bytes into an existing file read');
  assert.equal(f.scans, 1);
  await assert.rejects(f.service.execute('read_skill_file', input), { code: 'skill_file_changed' });
  await assert.rejects(f.restart().execute('read_skill_file', continuation), { code: 'skill_file_changed' });
});
