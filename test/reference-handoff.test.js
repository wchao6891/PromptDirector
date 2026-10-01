import test from 'node:test';
import assert from 'node:assert/strict';
import { pdReference, parsePdReference } from '../extension/pd-reference.js';
import { createReferenceSelection, createSelectionWriter, REFERENCE_SELECTION_KEY } from '../extension/reference-selection.js';
import { createAgentWorkspace } from '../extension/agent-workspace.js';
import { workspacePage } from '../extension/workspace-context.js';
import { createReferenceSnapshots } from '../extension/composer.js';
import { detailPromptSources } from '../extension/prompt-sources.js';
import { normalizeEntryMedia } from '../extension/media.js';

function fixture({ readDerived = async () => null } = {}) {
  const data = { entries: ['a','b'].map((id, i) => ({ id, title: id, text: `原词${id}`, url: `https://example.com/${id}`,
    mediaAssets: [{ id: i ? 'video' : 'image', kind: i ? 'video' : 'image', mimeType: i ? 'video/mp4' : 'image/png', storageMode:'managed', byteSize: 100 }],
    mediaPrompts: [{ assetId:i ? 'video' : 'image', text:`独立原词${id}`, source:'manual' }]
  })), compoundCases: [], aiSettings: { apiKey: 'must-not-expose' } };
  let queue = Promise.resolve();
  const api = createReferenceSelection({ storage: { get: async key => ({ [key]: data[key] }), set: async values => Object.assign(data, structuredClone(values)) },
    loadState: async () => data, readDerived, getLibraryId: async () => 'library',
    enqueue: work => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; } });
  return { data, api };
}
function referenceText(ref) { return ref.referenceText ?? ref.referenceTextParts.map(part => typeof part === 'string' ? part : part.source === 'originalText' ? ref.originalText : ref.referenceSources[part.index].text).join(''); }
const code = name => error => error.code === name;
test('PD identity round trips encoded characters and rejects ambiguous or foreign formats', () => {
  const identity = { libraryId:'lib space', caseId:'案例/#?', assetId:'v:a' };
  assert.deepEqual(parsePdReference(pdReference(identity)), identity);
  for (const uri of ['https://example.com', 'promptdirector://reference?v=2&library=a&case=b',
    'promptdirector://reference?v=1&library=a&case=b&case=c', 'promptdirector://reference/path?v=1&library=a&case=b',
    'promptdirector://user@reference?v=1&library=a&case=b']) assert.throws(() => parsePdReference(uri));
});
test('selection survives service reads without touching cases; exact prompts and original media stay paired', async () => {
  const { data, api } = fixture(), originals = structuredClone(data.entries);
  await api.update({ expectedRevision:0, caseIds:['b','a'] });
  const context = await api.read({});
  assert.deepEqual(context.references.map(r => [r.caseId, r.media[0].assetId]), [['b','video'],['a','image']]);
  for (const ref of context.references) {
    const content = await api.read({ part:'reference', referenceId:ref.referenceId, expectedRevision:context.revision });
    assert.equal(JSON.parse(content.content).originalText, `独立原词${ref.caseId}`);
    assert.equal((await api.resolve({ reference:ref.reference })).caseId, ref.caseId);
  }
  assert(!JSON.stringify(context).includes('must-not-expose'));
  assert.deepEqual(data.entries, originals);
  assert.deepEqual(data[REFERENCE_SELECTION_KEY].caseIds, ['b','a']);
});

test('selected images share human-priority and original-evidence rules with detail and internal Composer', async () => {
  for (const prompts of [[], [{ assetId: 'image', source: 'manual', text: '人工修正词' }, { assetId: 'image', source: 'webpage', text: '旧网页词' }]]) {
    const { data, api } = fixture();
    data.entries[0] = normalizeEntryMedia({ ...data.entries[0], text: '普通正文，不是原始提示词',
      sourceFacts: { originalPromptAvailable: false }, mediaPrompts: prompts });
    const entry = data.entries[0], expected = detailPromptSources(entry, entry.mediaAssets[0]).original;
    await api.update({ expectedRevision: 0, caseIds: ['a'] });
    const overview = await api.read({});
    const page = await api.read({ part: 'reference', referenceId: overview.references[0].referenceId, expectedRevision: overview.revision });
    const external = JSON.parse(page.content), internal = createReferenceSnapshots([entry], [{ entryId: 'a', assetIds: ['image'] }], 'zh-CN', 'image')[0];
    assert.equal(external.originalText, expected);
    assert.equal(internal.originalText, expected);
    assert.equal(overview.references[0].originalPromptCharacters, expected.length);
    if (!prompts.length) for (const ref of [internal, external]) assert(referenceText(ref).includes(entry.text), 'Non-prompt prose remains readable as reference content');
    else for (const ref of [internal, external]) {
      assert(!ref.originalText.includes('旧网页词'));
      assert.equal(referenceText(ref), expected);
    }
  }
});
test('same original may belong to two cases but identity must preserve case ownership', async () => {
  const { data, api } = fixture(); data.entries[1].mediaAssets = structuredClone(data.entries[0].mediaAssets);
  for (const caseId of ['a','b']) assert.equal((await api.resolve({reference:pdReference({libraryId:'library',caseId,assetId:'image'})})).caseId, caseId);
  await assert.rejects(api.resolve({reference:pdReference({libraryId:'elsewhere',caseId:'a'})}), code('library_mismatch'));
  await assert.rejects(api.resolve({reference:pdReference({libraryId:'library',caseId:'a',assetId:'video'})}), code('asset_not_in_case'));
  await assert.rejects(api.resolve({reference:pdReference({libraryId:'library',caseId:'deleted'})}), code('case_not_found'));
});
test('concurrent stale page cannot overwrite a newer human selection', async () => {
  const { api } = fixture();
  const results = await Promise.allSettled(['a','b'].map(id=>api.update({expectedRevision:0,caseIds:[id]})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'selection_conflict');
});
test('pagination detects edited prompts and removed selections instead of mixing old and new text', async () => {
  const { api, data } = fixture(); await api.update({expectedRevision:0,caseIds:['a','b']});
  const context = await api.read({limit:1}); assert.equal(context.nextOffset,1);
  data.entries[0].mediaPrompts[0].text='人工刚修改';
  await assert.rejects(api.read({expectedRevision:context.revision,offset:1}),code('selection_changed'));
  const fresh = await api.read({});
  await assert.rejects(api.read({part:'reference',referenceId:'not-selected',expectedRevision:fresh.revision}),code('reference_not_selected'));
  await api.update({expectedRevision:1,caseIds:[]});
  assert.equal((await api.read({})).total,0);
});
test('deleted references are reported without replacing the selection; new invalid IDs still fail', async () => {
  const { api, data }=fixture();
  await assert.rejects(api.update({expectedRevision:0,caseIds:['a','a']}),code('invalid_input'));
  await assert.rejects(api.update({expectedRevision:0,caseIds:['gone']}),code('case_not_found'));
  await api.update({expectedRevision:0,caseIds:['a']}); data.entries=[];
  const result = await api.read({});
  assert.equal(result.completeness,'partial'); assert.equal(result.availableCaseCount,0);
  assert.deepEqual(result.selectedCaseIds,['a']); assert.equal(result.issues[0].code,'case_not_found');
});
test('rapid UI clicks save in order, reinitialization waits for outstanding saves', async () => {
  const {api}=fixture(),errors=[];
  const writer=createSelectionWriter({read:api.get,write:api.update,onError:e=>errors.push(e),onRefresh:()=>{}});
  await writer.initialize(); writer.save(['a']); writer.save(['a','b']); writer.save(['b']);
  assert.deepEqual((await writer.initialize()).caseIds,['b']); assert.equal(errors.length,0);
});
test('UI conflict refresh cancels queued stale writes, then accepts a new explicit choice', async () => {
  const {api}=fixture(),errors=[],refreshes=[];
  const writer=createSelectionWriter({read:api.get,write:api.update,onError:e=>errors.push(e),onRefresh:v=>refreshes.push(v)});
  await writer.initialize(); await api.update({expectedRevision:0,caseIds:['b']});
  writer.save(['a']); writer.save(['a','b']); await writer.flush();
  assert.deepEqual((await api.get()).caseIds,['b']); assert.equal(errors.length,1); assert.equal(refreshes.length,1);
  await writer.save(['a']); assert.deepEqual((await api.get()).caseIds,['a']);
});
test('disk/read failure does not create an unhandled promise or silently continue unsaved writes', async () => {
  let fail=false,writes=0; const errors=[];
  const writer=createSelectionWriter({read:async()=>{if(fail)throw Error('unavailable');return{revision:0,caseIds:[]};},
    write:async()=>{writes++;throw Error('disk full');},onRefresh:()=>{},onError:e=>errors.push(e)});
  await writer.initialize(); fail=true; await writer.save(['a']); await writer.save(['b']);
  assert.equal(writes,1); assert.equal(errors.length,1);
});
test('external selection reads need neither an open creative workspace nor a configured internal model', async () => {
  const api=createAgentWorkspace({chromeApi:{runtime:{getURL:path=>`chrome-extension://test/${path}`}}, readSelection: async()=>({total:2})});
  assert.deepEqual(await api.read(),{total:2});
});
test('workspace projection whitelists context, supports full drafts without exposing provider secrets', async () => {
  const value={surface:'composer',references:[],instruction:'人类草稿'.repeat(2000),apiKey:'secret',provider:{token:'secret'}};
  const context=await workspacePage(value); assert.equal(context.instruction.nextOffset,4000);
  const rest=await workspacePage(value,{part:'instruction',expectedRevision:context.revision,offset:4000});
  assert.equal(context.instruction.text+rest.content,value.instruction); assert(!JSON.stringify(context).includes('secret'));
});

test('a selected compound keeps both original media kinds without selecting its poster as a reference', async () => {
  const {api,data}=fixture();
  data.entries[1].mediaAssets.push({id:'poster',kind:'image',usage:'poster',storageMode:'managed'});
  data.compoundCases=[{id:'compound',memberEntryIds:['a','b'],createdAt:'2026-09-27T00:00:00Z',title:'混合组合'}];
  await api.update({expectedRevision:0,caseIds:['compound']});
  const context=await api.read({});
  assert.equal(context.total,1); assert.equal(context.references[0].scope,'case');
  assert.deepEqual(context.references[0].media.map(a=>a.assetId),['image','video']);
  const content=await api.read({part:'reference',expectedRevision:context.revision,referenceId:context.references[0].referenceId});
  assert(referenceText(JSON.parse(content.content)).includes('原词a'));
  assert(referenceText(JSON.parse(content.content)).includes('原词b'));
});

test('a whole selection pages into one complete ordered JSON bundle with sources and no provider data', async () => {
  const {api}=fixture(); await api.update({expectedRevision:0,caseIds:['b','a']});
  const context=await api.read({}); let content='',offset=0;
  do {const page=await api.read({part:'selection',expectedRevision:context.revision,offset,length:71});
    assert.equal(page.format,'json'); content+=page.content; offset=page.nextOffset;
  } while(offset!==null);
  const bundle=JSON.parse(content);
  assert.deepEqual(bundle.selectedCaseIds,['b','a']);
  assert.deepEqual(bundle.references.map(r=>[r.entryId,r.originalText,r.sourceUrl]),[
    ['b','独立原词b','https://example.com/b'],['a','独立原词a','https://example.com/a']]);
  assert(!content.includes('must-not-expose'));
});
test('case count differs from expanded media count and missing original prompts are explicit', async () => {
  const {api,data}=fixture();
  data.entries[0].mediaAssets.push({id:'second-image',kind:'image',storageMode:'managed',mimeType:'image/png'});
  data.entries[1].text=''; data.entries[1].mediaPrompts=[];
  await api.update({expectedRevision:0,caseIds:['a','b']});
  const context=await api.read({}); assert.equal(context.selectedCaseCount,2);assert.equal(context.total,3);
  assert.deepEqual(context.selectedCaseIds,['a','b']);
  assert.equal(context.references.find(r=>r.caseId==='b').originalPromptCharacters,0);
});
test('source corrections invalidate a paged selection and clearing returns an explicit empty bundle', async () => {
  const {api,data}=fixture(); await api.update({expectedRevision:0,caseIds:['a']});
  const context=await api.read({}); data.entries[0].url='https://example.com/corrected';
  await assert.rejects(api.read({part:'selection',expectedRevision:context.revision}),code('selection_changed'));
  await api.update({expectedRevision:1,caseIds:[]}); const empty=await api.read({});
  assert.deepEqual(JSON.parse((await api.read({part:'selection',expectedRevision:empty.revision})).content),{selectedCaseIds:[],references:[],issues:[]});
});


test('a deleted case does not block remaining references or erase user intent, and old pages cannot mix', async () => {
  const {api,data}=fixture(); await api.update({expectedRevision:0,caseIds:['b','a']});
  const before=await api.read({}); data.entries=data.entries.filter(entry=>entry.id==='a');
  await assert.rejects(api.read({part:'selection',expectedRevision:before.revision}),code('selection_changed'));
  const context=await api.read({});
  assert.equal(context.completeness,'partial'); assert.equal(context.selectedCaseCount,2); assert.equal(context.availableCaseCount,1);
  assert.deepEqual(context.references.map(ref=>ref.caseId),['a']);
  assert.deepEqual(context.issues.map(issue=>[issue.caseId,issue.code]),[['b','case_not_found']]);
  const bundle=JSON.parse((await api.read({part:'selection',expectedRevision:context.revision})).content);
  assert.deepEqual(bundle.selectedCaseIds,['b','a']); assert.equal(bundle.references[0].originalText,'独立原词a');
  assert.deepEqual(bundle.issues,context.issues); assert.deepEqual((await api.get()).caseIds,['b','a']);
  // Keeping an already-selected missing ID must not prevent an explicit reorder.
  await api.update({expectedRevision:1,caseIds:['a','b']});
  await api.update({expectedRevision:2,caseIds:['a']});
  assert.equal((await api.read({})).completeness,'complete');
});
test('a document read failure reports the affected original without blocking other prompts or exposing errors', async () => {
  const {api,data}=fixture({readDerived:async()=>{throw Error('private storage path / secret');}});
  data.entries[0].mediaAssets.push({id:'doc',kind:'document',mimeType:'application/pdf',storageMode:'managed'});
  await api.update({expectedRevision:0,caseIds:['a','b']});
  const context=await api.read({}); assert.equal(context.availableCaseCount,2); assert.equal(context.completeness,'partial');
  assert.deepEqual(context.issues.map(issue=>[issue.caseId,issue.assetId,issue.code]),[['a','doc','document_unavailable']]);
  assert(!JSON.stringify(context).includes('secret'));
  const bundle=JSON.parse((await api.read({part:'selection',expectedRevision:context.revision})).content);
  assert.deepEqual(bundle.references.map(ref=>ref.originalText),['独立原词a','独立原词b']);
  assert.deepEqual(bundle.references.map(ref=>ref.alias),['@参考1','@参考2']);
});
test('external storage changes refresh selection without writing back or rolling back newer changes', async () => {
  const {api}=fixture(),refreshes=[],errors=[];let writes=0;
  const writer=createSelectionWriter({read:api.get,write:async input=>{writes++;return api.update(input);},onRefresh:v=>refreshes.push(v),onError:e=>errors.push(e)});
  await writer.initialize();
  const external=await api.update({expectedRevision:0,caseIds:['a']}); await writer.observe(external);
  assert.deepEqual(refreshes[0].caseIds,['a']); assert.equal(writes,0);
  await writer.save(['a','b']); await writer.observe(external);
  assert.deepEqual((await api.get()).caseIds,['a','b']); assert.equal(refreshes.length,1);assert.equal(errors.length,0);
});
test('own-write notifications during rapid clicks never repaint an intermediate selection', async () => {
  const {api}=fixture(),refreshes=[],errors=[];let writer;
  writer=createSelectionWriter({read:api.get,write:async input=>{
    const value=await api.update(input); void writer.observe(value); return value;
  },onRefresh:v=>refreshes.push(v),onError:e=>errors.push(e)});
  await writer.initialize(); writer.save(['a']); writer.save(['a','b']); writer.save(['b']);
  await writer.flush(); await writer.flush();
  assert.deepEqual((await api.get()).caseIds,['b']);assert.equal(refreshes.length,0);assert.equal(errors.length,0);
});


test('a malformed reference is isolated and a document with no extracted text is not claimed complete', async () => {
  const {api,data}=fixture(); data.entries[0].mediaPrompts='invalid historical value';
  data.entries[1].mediaAssets.push({id:'doc',kind:'document',mimeType:'application/pdf',storageMode:'managed'});
  await api.update({expectedRevision:0,caseIds:['a','b']});
  const context=await api.read({}); assert.equal(context.availableCaseCount,1);
  assert.deepEqual(context.issues.map(issue=>issue.code),['reference_unavailable','document_text_unavailable']);
  const result=await api.read({part:'selection',expectedRevision:context.revision});
  assert.equal(result.completeness,'partial'); assert.equal(result.selectedCaseCount,2);
  assert.equal(JSON.parse(result.content).references[0].originalText,'独立原词b');
});
test('a storage event arriving during initialization is applied after the initial read', async () => {
  let release; const initial=new Promise(resolve=>{release=resolve;}); const refreshes=[];
  const writer=createSelectionWriter({read:()=>initial,write:()=>{throw Error('unexpected write');},onError:e=>{throw e;},onRefresh:v=>refreshes.push(v)});
  const initializing=writer.initialize();
  const observed=writer.observe({revision:1,caseIds:['latest']});
  release({revision:0,caseIds:[]}); await initializing; await observed;
  assert.deepEqual(refreshes.map(value=>value.caseIds),[['latest']]);
});


test('an external event cannot lend its fresh revision to a click made against stale page selection', async () => {
  const {api}=fixture(),refreshes=[];
  const writer=createSelectionWriter({read:api.get,write:api.update,onRefresh:v=>refreshes.push(v),onError:e=>{throw e;}});
  await writer.initialize();
  const other=await api.update({expectedRevision:0,caseIds:['b']});
  void writer.observe(other); // The refresh has not painted before this click.
  await writer.save(['a']);
  assert.deepEqual((await api.get()).caseIds,['b']);assert.deepEqual(refreshes[0].caseIds,['b']);
  await writer.save(['b','a']); // A fresh explicit click after synchronization.
  assert.deepEqual((await api.get()).caseIds,['b','a']);
});
