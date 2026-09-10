import test from 'node:test';
import assert from 'node:assert/strict';
import { createComposerSession, plannerRequestPayload } from '../composer.js';
import { executeComposerTurnWithService } from '../composer-service.js';

test('letter choices inherit Chinese just like numeric replies',()=>{
 for(const content of ['A','B','C']) {
  const session=createComposerSession({messages:[{role:'user',content:'查看精选目录'},{role:'assistant',content:'A：查看目录\nB：继续讨论'},{role:'user',content}]});
  assert.equal(plannerRequestPayload(session,'').outputLanguage,'zh-CN');
 }
});
test('the provider receives real chronological conversation roles and the latest user choice',async()=>{
 let request;
 const session=createComposerSession({aiProfile:{serviceId:'deepseek',model:'deepseek-flash'},messages:[{role:'user',content:'看精选目录有什么'},{role:'assistant',content:'A：查目录\nB：聊创意'},{role:'user',content:'A'}]});
 await executeComposerTurnWithService({session,route:'auto'}, {ai:{apiKey:'fixture',consent:true},vision:{}},[],{stream:false,fetchImpl:async(_url,init)=>{
  request=JSON.parse(init.body);
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"route":"chat","status":"ready"}\n测试回答'}}]}));
 }});
 assert.ok(request.messages.some(m=>m.role==='assistant'&&m.content==='A：查目录\nB：聊创意'));
 const latest=request.messages.at(-1);
 assert.equal(latest.role,'user');
 assert.equal(latest.content.at(-1).text,'A');
 assert.ok(!JSON.parse(latest.content[0].text).messages);
});
