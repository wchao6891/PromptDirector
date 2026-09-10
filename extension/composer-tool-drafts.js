import { createCreativeSkill, normalizeCreativeSkillsState } from './creative-skills.js';
const clean=value=>String(value??'').trim();
export function normalizeToolDraft(value) {
  if(!value || typeof value!=='object') return null;
  const saved=value.savedId?{savedId:clean(value.savedId),savedAt:clean(value.savedAt)}:{};
  if(value.kind==='skill' && clean(value.callName) && clean(value.description) && clean(value.skillMarkdown)) return {
    kind:'skill',callName:clean(value.callName),description:clean(value.description),skillMarkdown:clean(value.skillMarkdown),...saved
  };
  const tags=[...new Set((Array.isArray(value.tags)?value.tags:[]).filter(item=>typeof item==='string').map(clean).filter(Boolean))];
  if(value.kind==='tags' && clean(value.caseId) && tags.length) return {kind:'tags',caseId:clean(value.caseId),title:clean(value.title),tags,...saved};
  return null;
}
// Called inside the background write queue. Asset changes and the saved receipt commit together.
export function saveComposerToolDraft(state,message) {
  const result=structuredClone(state);
  result.creativeSkills=normalizeCreativeSkillsState(result.creativeSkills);
  result.entries??=[];
  const session=result.composerSessions?.find(item=>item.id===message.sessionId);
  const event=session?.libraryTools?.events.find(item=>item.callId===message.callId && item.userMessageId===message.userMessageId && item.status==='completed');
  if(!event?.draft) throw Error('这份草稿已不存在，请回到对话重新查看');
  if(event.draft.savedId) return result;
  if(['submitted','waiting','receiving','stop_requested'].includes(session.activeTurn?.status)) throw Error('请等本轮回复结束后再保存草稿');
  const draft=normalizeToolDraft({...message.draft,kind:event.draft.kind,caseId:event.draft.caseId,title:event.draft.title});
  if(!draft) throw Error('请填写完整内容后保存');
  const now=new Date().toISOString();
  if(draft.kind==='skill') {
    assertPortableSkillDraft(draft.skillMarkdown,session.referenceSnapshots.map(item=>item.alias));
    const created=createCreativeSkill(result.creativeSkills,{...draft,source:'generated'});
    result.creativeSkills=created.state;
    draft.savedId=created.skill.id;
  } else {
    const entry=result.entries?.find(item=>item.id===draft.caseId);
    if(!entry) throw Error('原案例已删除，未写入标签');
    entry.customLabels=[...new Set([...(entry.customLabels??[]),...draft.tags])];
    entry.libraryUpdatedAt=now;
    draft.savedId=entry.id;
  }
  draft.savedAt=now;
  event.draft=draft;
  event.label=draft.kind==='skill'?`Skill 已保存 · ${draft.callName}`:`标签已添加 · ${draft.title}`;
  session.updatedAt=now;
  return result;
}

export function preserveSavedToolDrafts(session,previous) {
  for(const event of session.libraryTools.events) {
    const saved=previous?.libraryTools?.events.find(item=>item.callId===event.callId && item.userMessageId===event.userMessageId && item.draft?.savedId);
    if(saved) {event.draft=structuredClone(saved.draft);event.label=saved.label;}
  }
  return session;
}

export function assertPortableSkillDraft(markdown,aliases=[]) {
  if(aliases.some(alias=>alias && String(markdown).includes(alias))) throw Error('Skill 正文仍依赖本次对话的参考编号，请把对应方法写完整，移除临时引用后再生成草稿');
}
