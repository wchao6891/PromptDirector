import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalComposerLibraryTools, handleComposerLibraryHost } from '../extension/composer-library-host.js';

import { createComposerSession } from '../extension/composer.js';

const session = createComposerSession({ id: 'video-dialogue', messages: [{ id: 'request', role: 'user', content: '读取参考并继续分析' }] });

test('offscreen video tools delegate canonical task identity and deliver worker events without storage access', async t => {
  const prior = globalThis.chrome;
  t.after(() => { globalThis.chrome = prior; });
  const calls = [], events = [];
  globalThis.chrome = { runtime: { sendMessage: async message => {
    calls.push(message);
    return { ok: true, data: message.operation, events: message.operation === 'execute' ? [{ callId: 'read', status: 'completed' }] : [] };
  } } };
  const tools = createLocalComposerLibraryTools({ session, vision: true, onEvent: event => events.push(event) });
  assert.equal(await tools.execute('read_case_text', { caseId: 'reference' }, { callId: 'read' }), 'execute');
  await tools.loadContinuation({ model: 'model', protocol: 'chat' });
  await tools.saveContinuation({ nextOffset: 24 });
  await tools.retainSkillVersions(['version']);
  await tools.clearContinuation();
  assert.deepEqual(calls.map(call => call.operation), ['execute', 'loadContinuation', 'saveContinuation', 'retainSkillVersions', 'clearContinuation']);
  assert.ok(calls.every(call => call.sessionId === session.id && call.userMessageId === 'request' && !Object.hasOwn(call, 'session')));
  assert.equal(events[0].callId, 'read');
});

test('offscreen cancellation and worker failures do not report successful tool results', async t => {
  const prior = globalThis.chrome;
  t.after(() => { globalThis.chrome = prior; });
  let requests = 0;
  globalThis.chrome = { runtime: { sendMessage: async () => { requests++; return { ok: false, message: '原件已不存在' }; } } };
  const tools = createLocalComposerLibraryTools({ session });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(tools.execute('read_case_text', {}, { signal: controller.signal }));
  assert.equal(requests, 0);
  await assert.rejects(tools.execute('read_case_text', {}), /原件已不存在/);
});

test('worker host rejects deleted user requests and unknown operations before executing actions', async () => {
  const storage = { get: async () => ({ composerSessions: [session] }) };
  await assert.rejects(handleComposerLibraryHost({ operation: 'saveContinuation', sessionId: session.id, userMessageId: 'deleted' }, storage), /用户要求已不存在/);
  await assert.rejects(handleComposerLibraryHost({ operation: 'delete_all', sessionId: session.id, userMessageId: 'request' }, storage), /未知/);
});

test('worker case and Skill tools use the host dispatcher instead of messaging the worker itself', async t => {
  const prior = globalThis.chrome;
  t.after(() => { globalThis.chrome = prior; });
  globalThis.chrome = { storage: { local: {} }, runtime: { sendMessage: () => {
    throw new Error('worker runtime self-message cannot deliver an operation');
  } } };
  const calls = [];
  const tools = createLocalComposerLibraryTools({
    session: createComposerSession({ libraryTools: { candidates: [{ caseId: 'reference' }] } }),
    sendMessage: async message => {
      calls.push(message);
      return message.type === 'CASE_OPERATION'
        ? { ok: true, caseId: 'reference', revision: 'current', content: 'complete original' }
        : { ok: true, data: { callName: 'method', content: 'complete method' } };
    }
  });
  assert.equal((await tools.execute('read_case_details', { caseId: 'reference' }, { callId: 'read' })).data.content, 'complete original');
  assert.equal((await tools.execute('read_skill', { skillId: 'method' }, { callId: 'skill' })).data.content, 'complete method');
  assert.deepEqual(calls.map(call => call.type), ['CASE_OPERATION', 'SKILL_OPERATION']);
});
