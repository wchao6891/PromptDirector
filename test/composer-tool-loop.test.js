import test from 'node:test';
import assert from 'node:assert/strict';
import { runComposerToolLoop, readToolResponse } from '../extension/composer-tool-loop.js';
const spec = { name: 'search_cases', description: 'search', parameters: { type: 'object', properties: { query: { type: 'string' } } } };
const chat = (message, extra = {}) => new Response(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls?.length ? 'tool_calls' : 'stop' }], ...extra }), { headers: { 'content-type': 'application/json' } });
const call = (id, args) => ({ id, type: 'function', function: { name: 'search_cases', arguments: JSON.stringify(args) } });
const body = () => ({ model: 'fixture-model', messages: [{ role: 'user', content: '查询案例' }] });
const sse = events => new Response(new ReadableStream({ start(controller) { const text = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''); const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i+7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
test('ordinary response makes one request and executes zero tools; missing usage stays unknown', async () => {
  let requests = 0;
  const result = await runComposerToolLoop({ body: body(), protocol: 'chat_completions', maxCharacters: 750000,
    request: async () => { requests++; return chat({ role: 'assistant', content: '回答' }); }, runtime: { specs: [spec], execute: () => assert.fail('no tools') } });
  assert.equal(requests, 1); assert.equal(result.usageKnown, false);
});
test('empty text tool reply preserves each call ID and reasoning, then resumes with actual results', async () => {
  const requests = []; const executed = [];
  const result = await runComposerToolLoop({ body: body(), protocol: 'chat_completions', maxCharacters: 750000,
    request: async request => { requests.push(structuredClone(request)); return requests.length === 1
      ? chat({ role: 'assistant', content: null, reasoning_content: 'opaque reasoning', tool_calls: [call('one', { query: '雨夜' }), call('two', { query: '晴天' })] }, { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
      : chat({ role: 'assistant', content: '找到两个案例' }, { usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }); },
    runtime: { specs: [spec], execute: async (name, args, context) => { executed.push(context.callId); return { data: { title: args.query } }; } } });
  assert.deepEqual(executed, ['one', 'two']); assert.equal(requests[1].messages[1].reasoning_content, 'opaque reasoning');
  assert.deepEqual(requests[1].messages.slice(2).map(item => item.tool_call_id), ['one', 'two']);
  assert.equal(result.usage.totalTokens, 40); assert.equal(result.requestCount, 2);
});
test('streamed fragmented arguments finish before execution, including UTF8', async () => {
  const response = sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'one', function: { name: 'search_cases', arguments: '{"query":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"雨夜"}' } }] }, finish_reason: 'tool_calls' }] }]);
  const parsed = await readToolResponse(response, 'chat_completions');
  assert.equal(parsed.calls[0].arguments, '{"query":"雨夜"}'); assert.equal(parsed.content, '');
});
test('Responses carries encrypted reasoning and call outputs; image bytes only after explicit runtime result', async () => {
  const requests = [];
  const result = await runComposerToolLoop({ body: { model: 'fixture', store: false, input: [{ role: 'user', content: '用指定图' }] }, protocol: 'responses', maxCharacters: 750000,
    request: async request => { requests.push(structuredClone(request)); return new Response(JSON.stringify(requests.length === 1 ? { status: 'completed', output: [
      { type: 'reasoning', id: 'r', encrypted_content: 'opaque' }, { type: 'function_call', call_id: 'one', name: 'search_cases', arguments: '{"query":"图"}' }] } : { status: 'completed', output_text: '完成' }), { headers: { 'content-type': 'application/json' } }); },
    runtime: { specs: [spec], execute: async () => ({ data: { imageId: 'allowed' }, images: [{ label: '指定图', dataUrl: 'data:image/png;base64,ALLOWED' }] }) } });
  assert.equal(result.content, '完成'); assert.ok(requests[0].include.includes('reasoning.encrypted_content'));
  assert.equal(requests[1].input[1].encrypted_content, 'opaque');
  assert.equal(requests[1].input[3].call_id, 'one');
  assert.equal(requests[1].input[4].content[1].image_url, 'data:image/png;base64,ALLOWED');
});
test('Responses SSE output items preserve complete tool call', async () => {
  const item = { type: 'function_call', call_id: 'one', name: 'search_cases', arguments: '' };
  const parsed = await readToolResponse(sse([
    { type: 'response.output_item.added', output_index: 0, item },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"query":' },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '"雨夜"}' },
    { type: 'response.completed', response: { status: 'completed' } }
  ]), 'responses');
  assert.equal(parsed.calls[0].id, 'one'); assert.equal(parsed.calls[0].arguments, '{"query":"雨夜"}');
});
test('stop during a tool prevents the next request; incomplete streams execute nothing', async () => {
  const controller = new AbortController(); let requests = 0;
  await assert.rejects(runComposerToolLoop({ body: body(), protocol: 'chat_completions', signal: controller.signal, maxCharacters: 750000,
    request: async () => { requests++; return chat({ role: 'assistant', tool_calls: [call('one', { query: '' })] }); },
    runtime: { specs: [spec], execute: async () => { controller.abort(); return { data: {} }; } } }), { name: 'AbortError' });
  assert.equal(requests, 1);
  await assert.rejects(readToolResponse(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'search_cases', arguments: '{' } }] } }] }]), 'chat_completions'), /中断/);
});
test('repeated no-progress calls stop; unknown tool never executes', async () => {
  let count = 0;
  await assert.rejects(runComposerToolLoop({ body: body(), protocol: 'chat_completions', maxCharacters: 750000,
    request: async () => chat({ role: 'assistant', tool_calls: [call(crypto.randomUUID(), { query: '' })] }),
    runtime: { specs: [spec], execute: async () => { count++; return { data: {} }; } } }), /重复/);
  assert.equal(count, 1);
  await assert.rejects(runComposerToolLoop({ body: body(), protocol: 'chat_completions', maxCharacters: 750000,
    request: async () => chat({ role: 'assistant', tool_calls: [{ ...call('x', {}), function: { name: 'shell', arguments: '{}' } }] }),
    runtime: { specs: [spec], execute: () => assert.fail() } }), /不可用/);
});


test('same batch duplicate reads reuse local work but each call receives its own result', async () => {
  let executes = 0; const requests = [];
  await runComposerToolLoop({ body: body(), protocol: 'chat_completions', maxCharacters: 750000,
    request: async request => { requests.push(structuredClone(request)); return requests.length === 1
      ? chat({ role: 'assistant', tool_calls: [call('one', {query:'a'}), call('two', {query:'a'})] })
      : chat({ role: 'assistant', content: '完成' }); },
    runtime: { specs: [spec], execute: async () => { executes++; return {data: { title: 'a' }}; } } });
  assert.equal(executes, 1);
  assert.deepEqual(requests[1].messages.filter(item => item.role === 'tool').map(item => item.tool_call_id), ['one', 'two']);
});

test('native video bytes stay intact without consuming the text budget; retrieved text still counts', async () => {
  const maxCharacters = 2048;
  const video = 'A'.repeat(maxCharacters * 2);
  const input = { model: 'video-fixture', messages: [{ role: 'user', content: [
    { type: 'text', text: '参考原视频' }, { type: 'video_url', video_url: { url: video } }
  ] }] };
  let requests = 0;
  await assert.rejects(runComposerToolLoop({ body: input, protocol: 'chat_completions', maxCharacters,
    request: async current => {
      requests++;
      assert.equal(current.messages[0].content[1].video_url.url, video);
      return chat({ role: 'assistant', tool_calls: [call('read', { query: '资料' })] });
    }, runtime: { specs: [spec], execute: async () => ({ data: { text: '字'.repeat(maxCharacters) } }) }
  }), /请求容量/);
  assert.equal(requests, 1, 'the original video must reach the provider before an oversized text result is rejected');
});
