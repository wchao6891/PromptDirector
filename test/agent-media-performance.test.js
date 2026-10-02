import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentLibrary } from '../extension/agent-library.js';
import { AGENT_CHUNK_BYTES, agentDownloadChunkBytes, bytesToBase64 } from '../extension/agent-protocol.js';
import { reusableAgentFile } from '../extension/agent-transfer-reuse.js';
import { createAgentTransfers } from '../extension/agent-transfers.js';
import { sha256Blob } from '../extension/blob-digest.js';
import { saveAgentMaterial } from '../extension/agent-save.js';

test('older Chrome encoding fallback keeps all bytes across aligned groups and smaller working sets shrink only the chunk',()=>{
  for(const length of [0,1,2,3,24575,24576,24577,49153]) {
    const bytes=Uint8Array.from({length},(_,i)=>i%256);
    Object.defineProperty(bytes,'toBase64',{value:undefined});
    assert.deepEqual(Buffer.from(bytesToBase64(bytes),'base64'),Buffer.from(bytes));
  }
  assert.equal(agentDownloadChunkBytes({workingBytes:32*1024*1024}),1024*1024);
  assert.equal(agentDownloadChunkBytes({workingBytes:2*1024*1024*1024}),16*1024*1024);
});

test('a large original uses the Chrome-to-host envelope without repeating thousands of library reads', async () => {
  const original = new Blob([new Uint8Array(32 * 1024 * 1024 + 47)]);
  let reads = 0;
  const library = createAgentLibrary({ loadState: async () => {
    reads++; return { entries: [{ id: 'case', text: 'Complete content remains available',
      mediaAssets: [{ id: 'original', kind: 'video', mimeType: 'video/mp4' }] }] };
  }, readBlob: async () => original });
  let offset = 0, hash;
  do {
    const part = await library.media({ caseId: 'case', assetId: 'original', offset, expectedHash: hash });
    assert.equal(part.offset, offset);
    assert(Buffer.byteLength(JSON.stringify(part)) < 64 * 1024 * 1024);
    hash ??= part.sha256;
    assert.equal(part.sha256, hash);
    offset += Buffer.from(part.data, 'base64').length;
    if (part.nextOffset === null) break;
    assert.equal(part.nextOffset, offset);
  } while (offset < original.size);
  assert.equal(offset, original.size);
  assert(reads <= 4, `32 MiB original required ${reads} full library reads`);
  assert.equal(AGENT_CHUNK_BYTES, 192 * 1024, 'Host-to-Chrome upload boundary stays separately bounded');
});

test('saving the same original reuses verified library bytes and abort cannot delete the source or its poster', async () => {
  const blob = new Blob(['Original video bytes'], { type: 'video/mp4' });
  const hash = await sha256Blob(blob);
  const poster = new Blob(['poster'], { type: 'image/png' });
  const media = [{ id: 'original', kind: 'video', storageMode: 'managed', byteSize: blob.size, mimeType: blob.type, contentHash: hash, posterAssetId: 'poster' },
    { id: 'poster', kind: 'image', usage: 'content', storageMode: 'managed', mimeType: poster.type }];
  const state = { entries: [{ id: 'source', mediaAssets: media }] };
  const bytes = new Map([['original', blob], ['poster', poster]]);
  const record = { name: 'video.mp4', byteSize: blob.size, mimeType: blob.type, sha256: hash };
  const getBlob = async id => bytes.get(id);
  const matched = await reusableAgentFile(record, state, getBlob);
  assert.equal(matched.asset.id, 'original'); assert.equal(matched.poster.id, 'poster');
  assert.equal(matched.poster.usage, 'poster', 'A borrowed video cover must not become an extra content image');
  assert.equal(matched.poster.derivedFromAssetId, 'original');
  assert.equal(state.entries[0].mediaAssets[1].usage, 'content', 'Reuse must not mutate the source case');
  assert.equal(await reusableAgentFile({ ...record, sha256: '0'.repeat(64) }, state, getBlob), null);
  assert.equal(await reusableAgentFile({ ...record, purpose: 'skill-file' }, state, getBlob), null);
  bytes.set('original', new Blob(['Corrupt same length!!']));
  assert.equal(await reusableAgentFile(record, state, getBlob), null);
  bytes.set('original', blob);
  const data = {};
  const storage = { get: async key => key === null ? { ...data } : { [key]: data[key] },
    set: async value => Object.assign(data, value), remove: async key => { delete data[key]; } };
  const transfers = createAgentTransfers({ storage, readBlob: getBlob,
    reuse: input => reusableAgentFile(input, state, getBlob),
    writeBlob: async () => assert.fail('Existing originals must not be uploaded again'),
    prepare: async () => assert.fail('Existing video must not be decoded again'),
    deleteBlob: async () => assert.fail('Aborting a reuse must never delete the source'),
    estimateStorage: async () => ({ quota: 0, usage: 0 }) });
  assert.equal((await transfers.begin({ ...record, id: 'reuse' })).state, 'ready');
  assert.equal((await transfers.finish({ id: 'reuse' })).assetId, 'original');
  assert.deepEqual(await transfers.retainedIds(), [], 'Reuse borrows a source; it does not own a disposable upload');
  const reused = await transfers.get('reuse');
  bytes.delete('original');
  await assert.rejects(transfers.finish({ id: 'reuse' }), { code: 'integrity_failed' });
  await assert.rejects(saveAgentMaterial({ title: 'New result', text: 'Full notes', transferIds: ['reuse'] }, 'save', {
    loadState: async () => state, transfers, readBlob: getBlob,
    commit: async () => assert.fail('Missing source original must never be committed')
  }), { code: 'integrity_failed' });
  assert.equal(reused.prepared.asset.id, 'original');
  bytes.set('original', blob);
  await transfers.abort({ id: 'reuse' });
  assert.equal(bytes.get('original'), blob); assert.equal(bytes.get('poster'), poster);
});

test('two pending files with identical bytes retain distinct identities for their separate prompts',async()=>{
  const blob=new Blob(['same image bytes'],{type:'image/png'});const hash=await sha256Blob(blob);
  const state={entries:[{id:'source',mediaAssets:[{id:'image',kind:'image',storageMode:'managed',byteSize:blob.size,mimeType:blob.type,contentHash:hash}]}]};
  const data={};const bytes=new Map([['image',blob]]);
  const transfers=createAgentTransfers({storage:{get:async key=>key===null?{...data}:{[key]:data[key]},set:async values=>Object.assign(data,values),remove:async key=>{delete data[key]}},
    readBlob:async id=>bytes.get(id),reuse:record=>reusableAgentFile(record,state,async id=>bytes.get(id)),
    estimateStorage:async()=>({quota:1024*1024,usage:0}),writeBlob:async(id,value)=>bytes.set(id,value),deleteBlob:async id=>bytes.delete(id),
    prepare:async record=>({asset:{id:record.assetId,kind:'image',storageMode:'managed',mimeType:blob.type,byteSize:blob.size}})});
  const input={name:'image.png',byteSize:blob.size,mimeType:blob.type,sha256:hash};
  assert.equal((await transfers.begin({...input,id:'first'})).state,'ready');
  assert.equal((await transfers.begin({...input,id:'second'})).state,'uploading');
  await transfers.append({id:'second',offset:0,data:Buffer.from(await blob.arrayBuffer()).toString('base64')});
  await transfers.finish({id:'second'});
  assert.notEqual((await transfers.get('first')).assetId,(await transfers.get('second')).assetId);
  assert.equal(bytes.get('image'),blob);
});
