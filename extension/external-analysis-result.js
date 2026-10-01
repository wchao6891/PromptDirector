import {caseRevision, editCaseEntry} from './case-operations.js';
import {sha256Blob} from './blob-digest.js';
import {agentError} from './agent-protocol.js';
import {assertCaseFilesReadable} from './case-file-status.js';
import {applyFixedAnalysisTags, validateAnalysisTagResponse} from './tag-taxonomy.js';
import {facetAssignmentIdentity} from './facet-assignments.js';

const fail = (code,message) => {throw agentError(code,message);};
export async function checkAnalysisInput(state,item,entriesById,membershipsById) {
  const entry=entriesById?entriesById.get(item.caseId):state.entries.find(entry=>entry.id===item.caseId);
  if(!entry) fail('case_not_found','案例已删除或不存在；组合请指定成员。');
  assertCaseFilesReadable(entry);
  if(await caseRevision(state,entry,membershipsById?.get(item.caseId))!==item.expectedRevision) fail('case_conflict','案例或项目关系已变化，请重新核对分析输入。');
  if(new Set(item.assets.map(a=>a.assetId)).size!==item.assets.length) fail('invalid_input','分析素材不能重复。');
  for(const input of item.assets) if(!entry.mediaAssets?.some(a=>a.id===input.assetId&&['image','video'].includes(a.kind)&&a.usage!=='poster')) fail('asset_not_in_case','分析素材不属于当前案例。');
  return entry;
}
export async function planExternalAnalysisResult(state,item,result,{readBlob,entriesById,membershipsById,now=new Date().toISOString()}={}) {
  const entry=await checkAnalysisInput(state,item,entriesById,membershipsById);
  if(!Object.keys(result).length) fail('invalid_input','分析结果不能为空。');
  for(const asset of item.assets) {
    const blob=await readBlob(asset.assetId);
    if(!(blob instanceof Blob)||await sha256Blob(blob)!==asset.sha256) fail('analysis_media_changed','分析原件缺失或已变化，本次结果未写入。');
  }
  const allowed=new Set(item.assets.map(a=>a.assetId));
  for(const output of [...(result.mediaPrompts??[]),...(result.timeNotes??[])]) if(!allowed.has(output.assetId)) fail('analysis_scope','结果超出已登记并读取的素材范围。');
  const promptIds=(result.mediaPrompts??[]).map(p=>p.assetId);
  if(new Set(promptIds).size!==promptIds.length) fail('invalid_input','同一素材不能提交多份AI提示词。');
  for(const prompt of result.mediaPrompts??[]) {
    const asset=entry.mediaAssets.find(a=>a.id===prompt.assetId);
    if(asset.visionAnalysis?.userEdited || entry.videoAnalyses?.some(a=>a.assetId===prompt.assetId&&a.userEdited) ||
      entry.mediaPrompts?.some(p=>p.assetId===prompt.assetId&&p.source==='ai-suggestion'&&p.text!==prompt.text.trim())) fail('manual_analysis_conflict','已有编辑过或保存的AI提示词，请单独核对后编辑，批量结果不能替换。');
  }
  for(const note of result.timeNotes??[]) {
    const asset=entry.mediaAssets.find(a=>a.id===note.assetId);
    if(asset.kind!=='video'||(note.endMs!==undefined&&note.endMs<=note.startMs)||
      (asset.durationMs>0&&(note.startMs>asset.durationMs||(note.endMs??note.startMs)>asset.durationMs))) fail('invalid_input','时间笔记必须在所选视频时长范围内。');
  }
  let next=editCaseEntry(entry,{
    ...(result.mediaPrompts?{mediaPrompts:result.mediaPrompts.map(p=>({...p,source:'ai-suggestion'}))}:{}),
    ...(result.timeNotes?{timeNotes:result.timeNotes}: {})
  },now);
  let facetCatalog=state.facetCatalog;
  if(result.tags) {
    const diagnostics=[];
    const normalized=validateAnalysisTagResponse({tags:result.tags},facetCatalog,{diagnostics});
    if(diagnostics.length||normalized.some((tag,i)=>tag.g!==result.tags[i]?.g||tag.t!==(result.tags[i]?.t?.trim()||undefined))) fail('analysis_tags_invalid','标签包含无效、重复或超限内容；请修正后提交，不会静默丢弃。');
    const existing=next.facetAssignments??[];
    const applied=applyFixedAnalysisTags({entries:[{...next,facetAssignments:[]}],facetCatalog},entry.id,result.tags,{source:item.assets.length?'vision_model':'deepseek_text',replaceExisting:false});
    facetCatalog=applied.state.facetCatalog;
    // Assign one visual scope per result. Multi-image comparisons keep explicit
    // coverage in the durable receipt, rather than attributing every tag to every image.
    const incoming=applied.state.entries[0].facetAssignments.map(a=>item.assets.length===1?{...a,visualId:item.assets[0].assetId}:a);
    const identities=new Set(existing.map(facetAssignmentIdentity));
    next={...next,facetAssignments:[...existing,...incoming.filter(a=>!identities.has(facetAssignmentIdentity(a)))]};
  }
  next={...next,libraryUpdatedAt:now};
  const update={entries:state.entries.map(e=>e.id===next.id?next:e),...(result.tags?{facetCatalog}: {})};
  return {update,revision:await caseRevision({...state,...update},next,membershipsById?.get(item.caseId))};
}
