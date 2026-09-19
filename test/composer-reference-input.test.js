import test from 'node:test';
import assert from 'node:assert/strict';
import { createComposerSession } from '../extension/composer.js';
import { executeComposerTurnWithService } from '../extension/composer-service.js';
import { prepareComposerVideos } from '../extension/composer-video-references.js';
const image = {visualId:'image-1',dataUrl:'data:image/png;base64,AQID'};
const video = {assetId:'video-1',mimeType:'video/mp4',dataUrl:'data:video/mp4;base64,AQID'};
const refs = [
 {entryId:'image-case',alias:'@参考1',referenceText:'图片原提示词',imageRefs:[{visualId:image.visualId}]},
 {entryId:'video-case',alias:'@参考2',referenceKind:'video_sources',referenceText:'视频原提示词与逆推文字',assetRefs:[{assetId:video.assetId,kind:'video'}]}
];
const settings = serviceId => ({ai:{apiKey:'fixture',consent:true},vision:{providerProfiles:{[serviceId]:{
 id:serviceId,label:serviceId,apiKey:'fixture',consent:true,endpoint:'https://example.test/v1/chat/completions',protocol:'chat_completions',
 capabilities:['creativePlanning'],models:{creativePlanning:serviceId==='deepseek'?'deepseek-flash':'account-model'},
 discoveredModels:[{id:'account-model',tasks:['creativePlanning'],inputModalities:['text'],status:'available'}]
}}}});
for(const serviceId of ['deepseek','custom-text']) for(const originals of [false,true]) {
 test(`${serviceId}: explicit reference choice sends ${originals?'original media':'text only'} without capability veto`, async()=>{
   const session=createComposerSession({aiProfile:{serviceId,model:serviceId==='deepseek'?'deepseek-flash':'account-model'},
     imageReferenceMode:originals?'conditioned':'text_only',videoReferenceMode:originals?'original':'text_only',referenceSnapshots:refs});
   let requests=0;
   const result=await executeComposerTurnWithService({session,route:'chat',instruction:'分析参考'},settings(serviceId),originals?[image]:[],{
     preparedVideos:originals?[video]:[],stream:false,fetchImpl:async(_url,options)=>{
       requests++;const body=JSON.parse(options.body);assert.match(options.body,/视频原提示词与逆推文字/);assert.match(options.body,/图片原提示词/);
       const parts=body.messages.flatMap(m=>Array.isArray(m.content)?m.content:[]);
       assert.equal(parts.filter(p=>p.type==='image_url').length,originals?1:0);
       assert.equal(parts.filter(p=>p.type==='video_url').length,originals?1:0);
       return body.stream ? new Response('data: '+JSON.stringify({choices:[{delta:{content:'参考结果'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}}) : new Response(JSON.stringify({choices:[{message:{content:'参考结果'},finish_reason:'stop'}]}));
     }});
   assert.equal(result.text,'参考结果');assert.equal(requests,1);
 });
}
test('text-only video never loads or encodes the original',async()=>{
 assert.deepEqual(await prepareComposerVideos({videoReferenceMode:'text_only',referenceSnapshots:refs},{loadVideo:async()=>{throw Error('must not read video')}}),[]);
});
test('user can exclude an image that has no analysis text without silently re-enabling it',()=>{
 assert.equal(createComposerSession({imageReferenceMode:'text_only',referenceSnapshots:[{entryId:'image',imageRefs:[{visualId:'x'}]}]}).imageReferenceMode,'text_only');
});
test('provider refusal remains one explicit failure, no text fallback or retry',async()=>{
 let calls=0;const session=createComposerSession({aiProfile:{serviceId:'custom-text',model:'account-model'},referenceSnapshots:refs,imageReferenceMode:'conditioned',videoReferenceMode:'text_only'});
 await assert.rejects(executeComposerTurnWithService({session,route:'chat'},settings('custom-text'),[image],{fetchImpl:async()=>{
 calls++;return new Response(JSON.stringify({error:{message:'provider rejects this image input'}}),{status:400});}}),/provider rejects this image input/);
 assert.equal(calls,1);
});

test('compatible Responses forwards explicitly selected video using input_video without capability veto', async()=>{
 const config=settings('custom-text');config.vision.providerProfiles['custom-text'].protocol='responses';
 const session=createComposerSession({aiProfile:{serviceId:'custom-text',model:'account-model'},imageReferenceMode:'text_only',videoReferenceMode:'original',referenceSnapshots:refs});
 let requests=0;
 await executeComposerTurnWithService({session,route:'chat'},config,[],{preparedVideos:[video],stream:false,fetchImpl:async(_url,init)=>{
   requests++;const body=JSON.parse(init.body);const videos=body.input.at(-1).content.filter(part=>part.type==='input_video');
   assert.deepEqual(videos,[{type:'input_video',video_url:video.dataUrl}]);
   return new Response(JSON.stringify({output_text:'已接收视频'}));
 }});
 assert.equal(requests,1);
});
