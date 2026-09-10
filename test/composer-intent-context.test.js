import test from 'node:test';
import assert from 'node:assert/strict';
import { plannerRequestPayload } from '../extension/composer.js';
import { getAiModelCapability } from '../extension/ai-model-capabilities.js';
import { composerServiceCatalog } from '../extension/composer-service.js';
import { normalizeAiProviderRegistry } from '../extension/ai-provider-registry.js';

const history = [
  {role:'user', type:'request', content:'先找人像案例给我选'},
  {role:'assistant', type:'chat', content:'想看真人还是插画？'}
];
test('short replies in a Chinese conversation retain its language', () => {
  for (const content of ['1', '2', '👍']) {
    const payload = plannerRequestPayload({messages:[...history, {role:'user',content}]}, '', {});
    assert.equal(payload.outputLanguage, 'zh-CN');
  }
  assert.equal(plannerRequestPayload({messages:[{role:'user',content:'Find portraits for me'}, {role:'user',content:'1'}]},'',{}).outputLanguage,'en');
  assert.equal(plannerRequestPayload({outputLanguage:'en',messages:history},'1',{}).outputLanguage,'en');
});
test('auto mode provides chronological conversation without preselecting prompt composition', () => {
  const messages = [...history, {role:'assistant',type:'prompt',content:'先前生成的提示词'}, {role:'user',content:'不是，我要你先找案例我选'}];
  const payload=plannerRequestPayload({messages,promptVersions:[{text:'先前生成的提示词'}]},'',{});
  assert.equal(payload.taskMethod,'');
  assert.equal(payload.previousPrompt,'');
  assert.deepEqual(payload.messages.map(m=>m.content),messages.map(m=>m.content));
});
test('current DeepSeek Flash and officially accepted Flash aliases can see images', () => {
  for (const id of ['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp']) {
    assert.ok(getAiModelCapability('deepseek',id)?.inputModalities.includes('image'),id);
  }
  assert.ok(!getAiModelCapability('deepseek','deepseek-v4-pro').inputModalities.includes('image'));
});
test('saved text-only Flash catalog cannot override the current official vision capability', () => {
  const profile={apiKey:'test-key',consent:true,models:{creativePlanning:'deepseek-flash'},discoveredModels:[{id:'deepseek-flash',tasks:['creativePlanning'],inputModalities:['text'],outputModalities:['text'],confidence:'declared'}]};
  const registry=normalizeAiProviderRegistry({providers:{deepseek:profile}});
  assert.ok(registry.providers.deepseek.discoveredModels[0].tasks.includes('imageAnalysis'));
  assert.equal(composerServiceCatalog({apiKey:'test-key',consent:true},{providerProfiles:{deepseek:profile}}).find(item=>item.serviceId==='deepseek'&&item.model==='deepseek-flash')?.vision,true);
});

test('Flash sends the selected original once, honors thinking, and needs no separate analysis',async()=>{
  const {executeComposerTurnWithService}=await import('../extension/composer-service.js');
  const {createComposerSession}=await import('../extension/composer.js');
  for(const thinking of [false,true]) {
    const requests=[];
    const session=createComposerSession({aiProfile:{serviceId:'deepseek',model:'deepseek-flash',thinking},
      messages:[{role:'user',content:'说说这张图的构图'}],referenceSnapshots:[{entryId:'image-case',alias:'@参考1',imageRefs:[{visualId:'image'}]}]});
    const result=await executeComposerTurnWithService({session,route:'auto'}, {ai:{apiKey:'fixture',consent:true},vision:{}},
      [{visualId:'image',dataUrl:'data:image/png;base64,aW1hZ2U='}],{stream:false,fetchImpl:async (_url,init)=>{
        requests.push(JSON.parse(init.body));
        return new Response(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop',message:{content:'{"route":"chat","status":"ready"}\n主体位于画面中央。'}}]}));
      }});
    assert.equal(requests.length,1);assert.equal(result.kind,'chat');
    assert.equal(requests[0].messages[1].content.filter(item=>item.type==='image_url').length,1);
    assert.deepEqual(requests[0].thinking,{type:thinking?'enabled':'disabled'});
    assert.equal(requests[0].reasoning_effort,thinking?'high':undefined);
  }
});
