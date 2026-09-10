import test from 'node:test';
import assert from 'node:assert/strict';
import { createComposerWorkspaceTools } from '../composer-workspace-tools.js';
import { createComposerSession } from '../composer.js';
import { createCreativeSkill } from '../creative-skills.js';
import { saveComposerToolDraft } from '../composer-tool-drafts.js';
const session = createComposerSession({id:'chat', libraryRetrievalEnabled:false, messages:[{id:'u',role:'user',content:'提炼成 Skill'}]});
const skill = createCreativeSkill({}, {callName:'布光',description:'布光方法',skillMarkdown:'先判断主光方向。'}).skill;
const state = {entries:[{id:'case',title:'人像',customLabels:['已有']}], creativeSkills:{items:[skill]}};
function runtime(overrides={}) {
 const events=[];
 const tools=createComposerWorkspaceTools({session,caseTools:{specs:[],instructions:'',execute(){throw Error('unexpected');}},loadState:async()=>state,onEvent:async e=>events.push(e),...overrides});
 return {tools,events};
}
test('workspace help and Skill tools work with case search disabled, without leaking settings',async()=>{
 const {tools}=runtime({loadState:async()=>({...state,aiSettings:{apiKey:'secret'}})});
 const list=await tools.execute('list_skills',{query:''},{callId:'list'});
 assert.equal(list.data.items[0].callName,'布光'); assert.ok(!JSON.stringify(list).includes('secret'));
 const read=await tools.execute('read_skill',{skillId:skill.id},{callId:'read'});
 assert.equal(read.data.skillMarkdown,'先判断主光方向。');
 assert.ok(!tools.specs.some(s=>s.name==='inspect_case_tags'));
});
test('Skill draft uses the current response, survives session normalization, saves once after review',async()=>{
 const {tools,events}=runtime();
 const args={callName:'肖像构图',description:'可复用构图流程',skillMarkdown:'# 构图\n确定视觉中心。'};
 const result=await tools.execute('draft_skill',args,{callId:'draft'});
 assert.equal(result.data.saved,false);
 const current=createComposerSession({...session,libraryTools:{events}});
 assert.equal(current.libraryTools.events.at(-1).draft.skillMarkdown,args.skillMarkdown);
 const input={sessionId:current.id,callId:'draft',userMessageId:'u',draft:{...args,callName:'修改后的构图'}};
 const saved=saveComposerToolDraft({...state,composerSessions:[current]},input);
 assert.equal(saved.creativeSkills.items.at(-1).callName,'修改后的构图');
 const retry=saveComposerToolDraft(saved,input);
 assert.equal(retry.creativeSkills.items.length,saved.creativeSkills.items.length);
});
test('tag proposals require a known case and never overwrite existing user labels',async()=>{
 const {tools,events}=runtime({session:{...session,libraryRetrievalEnabled:true,libraryTools:{candidates:[{caseId:'case'}]}}});
 assert.ok((await tools.execute('draft_case_tags',{caseId:'unknown',tags:['建议']},{callId:'bad'})).data.error);
 await tools.execute('draft_case_tags',{caseId:'case',tags:['建议']},{callId:'tags'});
 const current=createComposerSession({...session,libraryTools:{events}});
 const saved=saveComposerToolDraft({...state,composerSessions:[current]}, {sessionId:current.id,callId:'tags',userMessageId:'u',draft:{tags:['确认标签']}});
 assert.deepEqual(saved.entries[0].customLabels,['已有','确认标签']);
});
test('invalid arguments and unavailable curated network report failure without invented results',async()=>{
 const {tools}=runtime({loadCurated:async()=>{throw Error('目录暂时无法连接');}});
 assert.ok((await tools.execute('draft_skill',{callName:'空白'},{callId:'invalid'})).data.error);
 assert.equal((await tools.execute('check_curated_library',{}, {callId:'network'})).data.error,'目录暂时无法连接');
});

test('search pagination and reviewed receipts remain available when the user says more or asks if saved',async()=>{
 const {plannerRequestPayload}=await import('../composer.js');
 const current=createComposerSession({...session,libraryTools:{events:[{callId:'s',userMessageId:'u',name:'search_cases',status:'completed',search:{query:'人像',offset:0,total:100,nextOffset:24}},{callId:'d',userMessageId:'u',name:'draft_skill',status:'completed',draft:{kind:'skill',callName:'方法',description:'说明',skillMarkdown:'方法',savedId:'saved-skill'}}]}});
 const payload=plannerRequestPayload(current,'还有更多吗');
 assert.equal(payload.toolHistory[0].search.nextOffset,24);
 assert.equal(payload.toolHistory[1].draft.saved,true);
});
test('stale conversation checkpoints preserve the saved receipt and cannot create a second Skill',async()=>{
 const {preserveSavedToolDrafts}=await import('../composer-tool-drafts.js');
 const draft={kind:'skill',callName:'方法',description:'说明',skillMarkdown:'方法'};
 const current=createComposerSession({...session,libraryTools:{events:[{callId:'d',userMessageId:'u',status:'completed',draft}]}});
 const previous=structuredClone(current);previous.libraryTools.events[0].draft.savedId='actual-saved-id';
 preserveSavedToolDrafts(current,previous);
 assert.equal(current.libraryTools.events[0].draft.savedId,'actual-saved-id');
});

test('cancelled actions and deleted cases do not persist drafts or labels',async()=>{
 const controller=new AbortController();controller.abort();
 const {tools,events}=runtime();
 await assert.rejects(tools.execute('draft_skill',{callName:'方法',description:'说明',skillMarkdown:'正文'},{callId:'cancel',signal:controller.signal}));
 assert.equal(events.length,0);
 const current=createComposerSession({...session,libraryTools:{events:[{callId:'d',userMessageId:'u',status:'completed',draft:{kind:'tags',caseId:'deleted',title:'已删除',tags:['标签']}}]}});
 assert.throws(()=>saveComposerToolDraft({...state,composerSessions:[current]}, {sessionId:current.id,callId:'d',userMessageId:'u',draft:{tags:['标签']}}),/已删除/);
});
test('diagnostics include real tool results and draft receipts without exporting credentials',async()=>{
 const {buildComposerDiagnostic}=await import('../composer-diagnostics.js');
 const diagnostic=buildComposerDiagnostic({...session,apiKey:'secret',libraryTools:{events:[{callId:'search',userMessageId:'u',name:'search_cases',status:'error',label:'查询失败'}]}});
 assert.equal(diagnostic.session.libraryTools.events[0].status,'error');
 assert.ok(!JSON.stringify(diagnostic).includes('secret'));
});

test('Skill drafting rejects ephemeral reference aliases instead of saving an unusable method',async()=>{
 const {tools}=runtime({session:{...session,referenceSnapshots:[{entryId:'case',alias:'@参考2',imageRefs:[]}]}});
 const result=await tools.execute('draft_skill',{callName:'方法',description:'测试',skillMarkdown:'按照 @参考2 的参数布光。'},{callId:'portable'});
 assert.match(result.data.error,/参考编号/);
});
