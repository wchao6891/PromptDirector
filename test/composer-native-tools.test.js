import test from 'node:test';
import assert from 'node:assert/strict';
import { executeComposerTurnWithService, composerServiceCatalog } from '../extension/composer-service.js';
import { createComposerSession, normalizeComposerSettings } from '../extension/composer.js';
import { createComposerLibraryTools } from '../extension/composer-library-tools.js';
import { buildSearchIndex } from '../extension/search-index.js';

function textResponse(protocol, step, model) {
  const output = step === 0 ? [{ type: 'function_call', call_id: 'read', name: 'search_cases', arguments: '{"query":"雨夜"}' }]
    : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"route":"chat","status":"ready"}\n找到雨夜案例' }] }];
  const payload = protocol === 'responses' ? { status: 'completed', model, output, usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 } }
    : { model, choices: [{ finish_reason: step === 0 ? 'tool_calls' : 'stop', message: step === 0
      ? { role: 'assistant', content: null, reasoning_content: 'opaque', tool_calls: [{ id: 'read', type: 'function', function: { name: 'search_cases', arguments: '{"query":"雨夜"}' } }] }
      : { role: 'assistant', content: '{"route":"chat","status":"ready"}\n找到雨夜案例' } }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } };
  return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
}
for (const { serviceId, model, protocol, settings } of [
  { serviceId: 'deepseek', model: 'deepseek-v4-flash', protocol: 'chat_completions', settings: { ai: { consent: true, apiKey: 'fixture', model: 'deepseek-v4-flash' }, vision: {} } },
  { serviceId: 'openai', model: 'gpt-5-mini', protocol: 'responses', settings: { ai: {}, vision: { consent: true, openai: { apiKey: 'fixture', model: 'gpt-5-mini' } } } },
  { serviceId: 'compatible', model: 'declared-fixture', protocol: 'chat_completions', settings: { ai: {}, vision: { consent: true, compatible: { protocol: 'chat_completions', endpoint: 'https://fixture.invalid/v1/chat/completions', apiKey: 'fixture', model: 'declared-fixture' }, providerProfiles: { 'custom-media': { discoveredModels: [{ id: 'declared-fixture', supportedParameters: ['tools'], inputModalities: ['text','image'] }] } } } } }
]) {
  test(`${serviceId}: execute-turn adapter continues native tool-only replies and returns the final chat`, async () => {
    const entries = [{ id: 'a', title: '雨夜案例', text: '雨夜' + 'hidden body'.repeat(90) }];
    const session = createComposerSession({ aiProfile: { serviceId, model }, messages: [{ role: 'user', content: '查询雨夜案例' }] });
    let stats; const requests = [];
    const runtime = createComposerLibraryTools({ session, loadLibrary: async () => ({ entries, searchIndex: buildSearchIndex(entries) }), maxCharacters: 750000, onRequest: value => { stats = value; } });
    const result = await executeComposerTurnWithService({ session, route: 'auto', composerSettings: normalizeComposerSettings() }, settings, [], {
      toolRuntime: runtime, fetchImpl: async (_url, init) => { const request = JSON.parse(init.body); requests.push(request); return textResponse(protocol, requests.length - 1, model); }
    });
    assert.equal(result.kind, 'chat'); assert.equal(result.text, '找到雨夜案例'); assert.equal(requests.length, 2);
    assert.equal(requests[0].tools.length, runtime.specs.length); assert.equal(stats.requestCount, 2); assert.equal(stats.usage.totalTokens, 24);
    assert.ok(JSON.stringify(requests[1]).includes('excerptOnly')); assert.ok(!JSON.stringify(requests[1]).includes('hidden body'.repeat(80)));
  });
}
test('unknown compatible model keeps ordinary creation without declaring unsupported tools', async () => {
  const catalog = composerServiceCatalog({}, { consent: true, compatible: { endpoint: 'https://fixture.invalid/v1/responses', protocol: 'responses', apiKey: 'fixture', model: 'unknown-fixture' } });
  assert.equal(catalog.find(item => item.serviceId === 'compatible').nativeTools, false);
});

test('image generation carries a tool-authorized original from prompt assembly to the image endpoint', async () => {
  const entries = [{ id: 'a', title: '雨夜案例', text: '雨夜', mediaAssets: [{ id: 'a-image', kind: 'image', usage: 'content', mimeType: 'image/png', storageMode: 'managed' }] }];
  const session = createComposerSession({ outputMode: 'create_image', imageReferenceMode: 'conditioned',
    aiProfile: { serviceId: 'openai', model: 'gpt-5-mini' }, generationAiProfile: { serviceId: 'compatible', model: 'fixture-planner' },
    messages: [{ role: 'user', content: '用雨夜案例的图片生成画面' }] });
  const original = 'data:image/png;base64,aW1hZ2U=';
  const runtime = createComposerLibraryTools({ session, vision: true, maxCharacters: 750000,
    loadLibrary: async () => ({ entries }), readImage: async () => ({ dataUrl: original }) });
  const requests = [];
  const result = await executeComposerTurnWithService({ session, route: 'compose', composerSettings: normalizeComposerSettings() }, { ai: {}, vision: {
    consent: true, openai: { apiKey: 'fixture', model: 'gpt-5-mini' }, compatible: { endpoint: 'https://fixture.invalid/v1/responses', protocol: 'responses', apiKey: 'fixture', model: 'fixture-planner',
      imageGeneration: { protocol: 'images_generations', endpoint: 'https://fixture.invalid/v1/images/generations', editsEndpoint: 'https://fixture.invalid/v1/images/edits', apiKey: 'fixture-image', model: 'fixture-image', size: '1024x1024', sizes: ['1024x1024'] } }
  } }, [], { toolRuntime: runtime, fetchImpl: async (url, init) => {
    const body = init.body instanceof FormData ? init.body : JSON.parse(init.body); requests.push({ url, body });
    const payload = requests.length === 1 ? { status: 'completed', output: [{ type: 'function_call', call_id: 'image', name: 'use_case_images', arguments: '{"caseId":"a","imageIds":["a-image"]}' }] }
      : requests.length === 2 ? { status: 'completed', output_text: '雨夜街道，冷色光，忠实保持主体构图。' }
      : { data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' }] };
    return new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json' } });
  } });
  assert.equal(result.kind, 'image'); assert.equal(requests.length, 3);
  assert.ok(JSON.stringify(requests[1].body).includes(original));
  assert.equal(await requests[2].body.get('image').text(), 'image');
  assert.equal([...requests[2].body.keys()].filter(key => key.startsWith('image')).length, 1);
  assert.match(requests[2].url, /images\/edits/);
});
