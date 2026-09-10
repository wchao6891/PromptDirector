import test from 'node:test';
import assert from 'node:assert/strict';
import { appendCaptureCandidate, draftCaptureAddition, savedDraftCaptureItems } from '../extension/capture-additions.js';
import { normalizePageCaptureCandidate, normalizePageCaptureBatch, applyPageCaptureSelections, pageCaptureDefaultMediaIds } from '../extension/page-capture.js';
const candidate = () => normalizePageCaptureCandidate({id:'main',title:'main',canonicalUrl:'https://x.com/user/status/1',contentText:'Original',
  textBlocks:[{id:'body',kind:'paragraph',relevance:'explicit-creative',text:'Original'}],articleDocument:{blocks:[{id:'body',kind:'paragraph',relevance:'explicit-creative',text:'Original'}]},
  media:[{id:'one',url:'https://pbs.twimg.com/media/image?format=jpg&name=small',kind:'image',placement:'inline'},
    {id:'quote',url:'https://pbs.twimg.com/media/quote',kind:'image',placement:'inline',quotedPostUrl:'https://x.com/user/status/2'}]});
const selection={candidateId:'main',selectedTextBlockIds:candidate().textBlocks.map(b=>b.id),selectedMediaIds:['one'],mediaDecision:'confirmed'};
test('quoted images remain optional while the main image group is selected',()=>assert.deepEqual(pageCaptureDefaultMediaIds(candidate()),['one']));
test('appending selected text and local media preserves prior selections and saves one complete candidate',()=>{
  const draft={id:'draft',fragments:[{id:'f',text:'Extra selected text'}],visuals:[{id:'local',mimeType:'image/avif'}]};
  const addition=draftCaptureAddition(draft);
  const result=appendCaptureCandidate(candidate(),addition,selection);
  const [saved]=applyPageCaptureSelections(normalizePageCaptureBatch({candidates:[result.candidate],selections:[result.selection]}));
  assert.match(saved.contentText,/Original/);assert.match(saved.contentText,/Extra selected text/);
  assert.equal(saved.media.length,2);assert.equal(saved.media[1].localAssetId,'local');assert.equal(saved.media[1].mimeType,'image/avif');
  assert.ok(!result.selection.selectedMediaIds.includes('quote'));
  assert.equal(draftCaptureAddition(draft,new Set(addition.consumed)).media.length,0);
});
test('duplicate image URLs and text do not override exclusions or grow the draft',()=>{
  const base=candidate();
  const addition={...base,id:'again',media:[{...base.media[0],id:'same-original',url:'https://pbs.twimg.com/media/image?name=orig&format=jpg'}]};
  const result=appendCaptureCandidate(base,addition,{...selection,selectedMediaIds:[]});
  assert.equal(result.candidate.media.length,2);assert.equal(result.candidate.textBlocks.length,1);assert.deepEqual(result.selection.selectedMediaIds,[]);
});

test('text-only save retains local images and excluded fragments in the pending draft', () => {
  const draft = { id: 'draft', fragments: [{ id: 'saved', text: 'keep' }, { id: 'excluded', text: 'later' }], visuals: [{ id: 'image' }] };
  const consumed = new Set(['text:saved', 'text:excluded', 'image:image']);
  const selected = [{ textBlocks: [{ id: 'added:draft:saved', text: 'edited keep' }], media: [] }];
  assert.deepEqual(savedDraftCaptureItems(draft, selected, consumed), [{ kind: 'text', id: 'saved' }]);
  assert.deepEqual(savedDraftCaptureItems(draft, [], consumed), []);
});
test('identical local image bytes with a new selection ID stay as one image', () => {
  const draft = { id: 'draft', fragments: [], visuals: [{ id: 'local1', contentHash: 'a'.repeat(64) }] };
  const first = appendCaptureCandidate(candidate(), draftCaptureAddition(draft), selection);
  const nextDraft = { ...draft, visuals: [{ ...draft.visuals[0], id: 'local2' }] };
  const second = appendCaptureCandidate(first.candidate, draftCaptureAddition(nextDraft), first.selection);
  assert.equal(second.candidate.media.filter(m => m.localAssetId).length, 1);
  assert.deepEqual(savedDraftCaptureItems(nextDraft, [second.candidate], new Set(['image:local2'])), [{ kind: 'image', id: 'local2' }]);
});

test('adding a webpage preserves headings and quotes without repeating original section text', () => {
  const base = candidate();
  const addition = normalizePageCaptureCandidate({ id: 'article', title: 'Supplement', pageType: 'article', canonicalUrl: 'https://example.com/article',
    textBlocks: [{ id: 'heading', kind: 'heading', text: 'A heading' }, { id: 'quote', kind: 'quote', text: 'A quoted creative direction.' }],
    articleDocument: { blocks: [{ id: 'heading', kind: 'heading', text: 'A heading' }, { id: 'quote', kind: 'quote', text: 'A quoted creative direction.' }] } });
  const result = appendCaptureCandidate(base, addition, selection);
  const blocks = result.candidate.articleDocument.blocks;
  assert.equal(blocks.filter(b => b.text === 'Original').length, 1);
  assert.ok(blocks.some(b => b.kind === 'heading' && b.text === 'A heading'));
  assert.ok(blocks.some(b => b.kind === 'quote' && b.text === 'A quoted creative direction.'));
  assert.equal(blocks.map(b => b.text || '').join(' ').match(/A quoted creative direction/g).length, 1);
});


test("saved capture outcomes consume partial and duplicate cases but preserve unsaved candidates", async () => {
  const { savedPageCaptureCandidateIds } = await import("../extension/capture-additions.js");
  const candidates = ["saved", "partial", "duplicate", "failed"].map(id => ({ id }));
  const results = candidates.map(({ id }) => ({ candidateId: id, status: id, ...(id !== "failed" ? { entryId: `entry:${id}` } : {}) }));
  assert.deepEqual([...savedPageCaptureCandidateIds({}, candidates, results)], ["saved", "partial", "duplicate"]);
  assert.deepEqual([...savedPageCaptureCandidateIds({}, candidates, [])], []);
  assert.deepEqual([...savedPageCaptureCandidateIds({captureMode:"list",saveMode:"combined"}, candidates,
    [{candidateId:"combined-id",entryId:"saved-entry",status:"partial"}])], candidates.map(item => item.id));
  assert.deepEqual([...savedPageCaptureCandidateIds({captureMode:"list",saveMode:"combined"}, candidates,
    [{candidateId:"combined-id",status:"failed"}])], []);
});
