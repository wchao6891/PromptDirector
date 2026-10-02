import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseSkillFiles } from '../extension/creative-skill-package.js';
import { createAgentTransfers } from '../extension/agent-transfers.js';
import { boundedMediaBlobFromResponse } from '../extension/bounded-media.js';
import { assertImageDimensions } from '../extension/resource-limits.js';
import { createOrJoinAnalysisTask, normalizeAnalysisTaskRegistry, replaceAnalysisTask } from '../extension/analysis-task-registry.js';
import { startAnalysisAttempt } from '../extension/analysis-tasks.js';
import { skillExtractionWorkload } from '../extension/creative-skill-service.js';
import { analyzeTextDetailedWithDeepSeek } from '../extension/deepseek.js';
import { compileVisualAnalysisInstruction } from '../extension/visual-analysis.js';
import { createFixedFacetCatalog } from '../extension/tag-taxonomy.js';
import { normalizePageCaptureCandidate } from '../extension/page-capture.js';

const MiB = 1024 * 1024;

test('complete Skill packages retain more than 4096 files and originals above 16/128 MiB', async () => {
  const original = new Blob([new Uint8Array(128 * MiB + 1).fill(17)]);
  const markdown = '---\nname: full-package\ndescription: Complete original files\n---\n' + '原始方法。'.repeat(Math.ceil(17 * MiB / 15));
  const files = new Map([
    ['SKILL.md', new Blob([markdown])],
    ['references/long.md', new Blob(['原始引用。'.repeat(Math.ceil(17 * MiB / 15))])],
    ['scripts/original.bin', original],
    ...Array.from({ length: 4097 }, (_, i) => [`data/${i}.txt`, new Blob([`source ${i}`])])
  ]);
  const parsed = await parseSkillFiles(files);
  assert.equal(parsed.files.size, files.size);
  assert.equal(parsed.markdown, markdown);
  assert.equal(parsed.references[0].markdown, await files.get('references/long.md').text());
  assert.equal(parsed.files.get('scripts/original.bin'), original);
  assert.equal(parsed.files.get('data/4096.txt'), files.get('data/4096.txt'));
});

test('Agent Skill transfer delivers a file above 16 MiB with all bytes and SHA-256 intact', async () => {
  const bytes = new Uint8Array(16 * MiB + 1).fill(29);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const records = {};
  const blobs = new Map();
  const transfers = createAgentTransfers({
    storage: { get: async key => ({ [key]: records[key] }), set: async update => Object.assign(records, update), remove: async key => { delete records[key]; } },
    readBlob: async id => blobs.get(id), writeBlob: async (id, blob) => { blobs.set(id, blob); },
    deleteBlob: async id => { blobs.delete(id); }, prepare: async () => { throw new Error('Skill files must remain inert'); }
  });
  const receipt = await transfers.begin({ id: 'above-old-file-quota', name: 'original.bin', byteSize: bytes.length, sha256, purpose: 'skill-file' });
  for (let offset = 0; offset < bytes.length; offset += receipt.chunkBytes) {
    await transfers.append({ id: receipt.id, offset, data: Buffer.from(bytes.subarray(offset, offset + receipt.chunkBytes)).toString('base64') });
  }
  const finished = await transfers.finish({ id: receipt.id });
  assert.equal(finished.state, 'ready');
  assert.equal(blobs.size, 1);
  const delivered = blobs.get(finished.assetId);
  assert.equal(delivered.size, bytes.length);
  assert.equal(createHash('sha256').update(new Uint8Array(await delivered.arrayBuffer())).digest('hex'), sha256);
});

test('default downloads retain videos above 128 MiB and images above 32 MiB', async () => {
  for (const [kind, size, header] of [
    ['video', 128 * MiB + 1, [0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]],
    ['image', 32 * MiB + 1, [137, 80, 78, 71, 13, 10, 26, 10]]
  ]) {
    const source = new Blob([Uint8Array.from(header), new Uint8Array(size - header.length).fill(71)]);
    const downloaded = await boundedMediaBlobFromResponse(new Response(source, { headers: { 'content-length': String(source.size) } }), { kind });
    assert.equal(downloaded.size, size);
    assert.equal(createHash('sha256').update(new Uint8Array(await downloaded.arrayBuffer())).digest('hex'),
      createHash('sha256').update(new Uint8Array(await source.arrayBuffer())).digest('hex'));
  }
  assert.doesNotThrow(() => assertImageDimensions(8192, 8192));
  assert.throws(() => assertImageDimensions(0, 8192), /有效的图片尺寸/);
});

test('adding task 51 preserves running task 1 and its request identity to prevent duplicate paid work', () => {
  let state = {};
  for (let i = 0; i < 51; i++) {
    state = createOrJoinAnalysisTask(state, { sessionId: `session-${i}`, tempReferenceIds: [`image-${i}`], clientRequestId: `request-${i}` }, { taskId: `task-${i}` }).state;
  }
  state = normalizeAnalysisTaskRegistry(state);
  assert.equal(state.items.length, 51);
  const first = state.items[0];
  state = replaceAnalysisTask(state, startAnalysisAttempt(first, { attemptId: 'paid-attempt' }));
  assert.equal(state.items.length, 51);
  const joined = createOrJoinAnalysisTask(state, { sessionId: 'session-0', tempReferenceIds: ['image-0'], clientRequestId: 'request-0' }, { taskId: 'must-not-be-created' });
  assert.equal(joined.created, false);
  assert.equal(joined.task.id, 'task-0');
  assert.equal(joined.task.activeAttemptId, 'paid-attempt');
});

test('Skill batching preserves every source character beyond the old Composer request quota', () => {
  const text = '完整来源\n'.repeat(160000);
  const workload = skillExtractionWorkload({ sources: [{ prompt: text }], maxBatchCharacters: 900001 });
  assert.equal(workload.batches.flat().map(source => source.prompt).join(''), text.trim());
  const defaults = skillExtractionWorkload({ sources: [{ prompt: text }] });
  assert.equal(defaults.batches.flat().map(source => source.prompt).join(''), text.trim());
});

test('custom analysis instructions beyond 1200 characters reach text and visual requests in full', async () => {
  const instruction = '用户完整的分析要求。'.repeat(300) + '最后的要求仍必须生效';
  const catalog = createFixedFacetCatalog();
  let request;
  await analyzeTextDetailedWithDeepSeek({ id: 'full-input', text: '原始提示词' }, catalog, {
    apiKey: 'isolated-fixture', consent: true, analysisModel: 'deepseek-v4-flash',
    analysisInstructionsByLocale: { 'zh-CN': instruction }
  }, async (_url, options) => {
    request = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ tags: [{ g: 'subject.character', t: '角色' }] })
    } }] }));
  });
  assert.ok(request.messages.some(message => message.content === instruction));
  assert.ok(compileVisualAnalysisInstruction({ catalog, customInstruction: instruction }).includes(instruction));
});

test('manual capture retains all 201 selected content targets and inclusion edits', () => {
  const targets = Array.from({ length: 201 }, (_, i) => ({ id: `target-${i}`, kind: 'text', path: `article/p[${i + 1}]` }));
  const edits = targets.map(target => ({ mode: 'include', path: target.path }));
  const candidate = normalizePageCaptureCandidate({ title: '用户选择的全文', canonicalUrl: 'https://fixture.example/article',
    contentText: '保留用户选择', region: { marker: 'region', contentTargets: targets, edits } });
  assert.equal(candidate.region.contentTargets.length, targets.length);
  assert.deepEqual(candidate.region.contentTargets.map(target => target.id), targets.map(target => target.id));
  assert.deepEqual(candidate.region.edits, edits);
});
