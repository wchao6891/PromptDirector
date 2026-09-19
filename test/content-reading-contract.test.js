import test from 'node:test';
import assert from 'node:assert/strict';
import { detailPromptSources } from '../extension/prompt-sources.js';
import { canonicalTextAnalysisInput } from '../extension/analysis-input.js';
import { caseTextPart } from '../extension/composer-library-tools.js';
import { composerSourceText } from '../extension/composer-source-text.js';
import { createAgentLibrary } from '../extension/agent-library.js';
import { classifyImportedMedia } from '../extension/classifier.js';
import { CONTENT_IDS } from '../extension/taxonomy.js';
import { renderLibraryJson } from '../extension/lib.js';

function fixture(kind) {
  return { id:`case-${kind}`, title:'原始资料', text:'来源中的完整提示词', textRevision:4,
    sourceFacts:{originalPromptAvailable:true},
    classification:{pathIds:[kind==='video'?CONTENT_IDS.videoCase:CONTENT_IDS.imageCase],status:'confirmed',source:'manual'},
    mediaAssets:[{id:'asset',kind,usage:'content'}], primaryMediaId:'asset' };
}
for (const kind of ['image','video']) test(`${kind}: original remains readable across detail, text analysis, composer, Agent and export despite user classification`, async () => {
  const entry = fixture(kind), before = structuredClone(entry);
  const library = createAgentLibrary({loadState:async()=>({entries:[entry]}),libraryUrl:'chrome-extension://fixture/library.html'});
  assert.equal(detailPromptSources(entry,entry.mediaAssets[0]).original,entry.text);
  assert.equal(canonicalTextAnalysisInput(entry).text,entry.text);
  assert.equal(caseTextPart(entry,'original_prompt'),entry.text);
  assert.equal(composerSourceText(entry),entry.text);
  assert.equal((await library.read({caseId:entry.id,part:'original_prompt'})).content,entry.text);
  assert.equal(JSON.parse(renderLibraryJson([entry],{})).entries[0].text,entry.text);
  assert.deepEqual(entry,before);
});
test('video analysis uses its selected original, not a poster or adopted AI text', () => {
  const entry=fixture('video');
  entry.mediaAssets.unshift({id:'poster',kind:'image',usage:'poster'});
  entry.mediaPrompts=[{assetId:'asset',text:'AI推测',source:'ai-suggestion'},
    {assetId:'asset',text:'视频原始输入',source:'manual',textRevision:6}];
  assert.deepEqual(canonicalTextAnalysisInput(entry),{text:'视频原始输入',textRevision:6,source:'media_prompt',assetId:'asset'});
  assert.equal(detailPromptSources(entry,entry.mediaAssets[1]).original,'视频原始输入');
  assert.doesNotMatch(caseTextPart(entry,'original_prompt'),/AI推测/);
});
test('an adopted AI prompt remains analyzable when no original is present, without becoming an original', () => {
  const entry=fixture('image');
  entry.text='';
  entry.sourceFacts.originalPromptAvailable=false;
  entry.mediaPrompts=[{assetId:'asset',text:'用户已采用的AI提示词',source:'ai-suggestion',textRevision:2}];
  assert.deepEqual(canonicalTextAnalysisInput(entry),{text:'用户已采用的AI提示词',textRevision:2,source:'ai_prompt',assetId:'asset'});
  assert.equal(detailPromptSources(entry,entry.mediaAssets[0]).original,'');
  assert.equal(caseTextPart(entry,'original_prompt'),'');
});
test('article and compound reading never promotes article prose to original prompts', () => {
  const article={id:'article',title:'教程',text:'文章正文',articleDocument:{blocks:[{kind:'paragraph',text:'文章正文'}]}};
  const video=fixture('video');
  const compound={id:'compound',text:'文章正文\n来源中的完整提示词',memberEntries:[article,video]};
  assert.equal(caseTextPart(article,'original_prompt'),'');
  assert.match(caseTextPart(compound,'original_prompt'),/来源中的完整提示词/);
  assert.doesNotMatch(caseTextPart(compound,'original_prompt'),/文章正文/);
});
test('new file imports classify from recorded original evidence while respecting manual organization', () => {
  for (const kind of ['image','video']) {
    const entry=fixture(kind);
    const manual=entry.classification;
    assert.deepEqual(classifyImportedMedia(entry).pathIds,manual.pathIds);
    assert.equal(classifyImportedMedia(entry).source,manual.source);
    delete entry.classification;
    assert.deepEqual(classifyImportedMedia(entry).pathIds,[kind==='video'?CONTENT_IDS.promptVideo:CONTENT_IDS.promptImage]);
    entry.sourceFacts={originalPromptAvailable:false};entry.text='随手备注';
    assert.deepEqual(classifyImportedMedia(entry).pathIds,[kind==='video'?CONTENT_IDS.videoCase:CONTENT_IDS.imageCase]);
    entry.mediaPrompts=[{assetId:'asset',source:'embedded',text:'文件中真实原词'}];
    assert.deepEqual(classifyImportedMedia(entry).pathIds,[kind==='video'?CONTENT_IDS.promptVideo:CONTENT_IDS.promptImage]);
  }
});
