import {caseRevision, editCaseEntry} from './case-operations.js';
import {sha256Blob} from './blob-digest.js';
import {agentError} from './agent-protocol.js';
import {assertCaseFilesReadable} from './case-file-status.js';
import {applyFixedAnalysisTags, validateAnalysisTagResponse} from './tag-taxonomy.js';
import {facetAssignmentIdentity} from './facet-assignments.js';
import { normalizeEntryMedia } from './media.js';
import { normalizeVisualModelResponse, normalizeVisualSetSummaryV1, prepareVisualSetSummary } from './visual-analysis.js';
import { normalizeVideoReconstructionResult, VIDEO_RECONSTRUCTION_CONTRACT_VERSION } from './video-analysis.js';
import { applyCompletedImageResult, applyCompletedVideoResult } from './media-analysis-results.js';

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
export async function planExternalAnalysisResult(state,item,result,{readBlob,entriesById,membershipsById,model='',batchId='',now=new Date().toISOString()}={}) {
  const entry=await checkAnalysisInput(state,item,entriesById,membershipsById);
  if(!Object.keys(result).length) fail('invalid_input','分析结果不能为空。');
  for(const asset of item.assets) {
    const blob=await readBlob(asset.assetId);
    if(!(blob instanceof Blob)||await sha256Blob(blob)!==asset.sha256) fail('analysis_media_changed','分析原件缺失或已变化，本次结果未写入。');
  }
  const allowed=new Set(item.assets.map(a=>a.assetId));
  const analyses=[...(result.imageAnalyses??[]),...(result.videoAnalyses??[])];
  for(const output of [...(result.mediaPrompts??[]),...(result.timeNotes??[]),...analyses]) if(!allowed.has(output.assetId)) fail('analysis_scope','结果超出已登记并读取的素材范围。');
  const promptIds=[...(result.mediaPrompts??[]),...analyses].map(p=>p.assetId);
  if(new Set(promptIds).size!==promptIds.length) fail('invalid_input','同一素材不能提交多份AI提示词。');
  for(const prompt of [...(result.mediaPrompts??[]),...analyses]) {
    const asset=entry.mediaAssets.find(a=>a.id===prompt.assetId);
    if(asset.visionAnalysis?.userEdited || entry.videoAnalyses?.some(a=>a.assetId===prompt.assetId&&a.userEdited) ||
      entry.mediaPrompts?.some(p=>p.assetId===prompt.assetId&&p.source==='ai-suggestion'&&p.text!==(prompt.text??prompt.reconstructionPrompt).trim())) fail('manual_analysis_conflict','已有编辑过或保存的AI提示词，请单独核对后编辑，批量结果不能替换。');
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
  const evidence=ids=>({caseId:item.caseId,caseRevision:item.expectedRevision,batchId,attemptId:item.attemptId,
    assets:item.assets.filter(asset=>ids.includes(asset.assetId)).map(asset=>({...asset}))});
  for(const output of result.imageAnalyses??[]) {
    const asset=next.mediaAssets.find(asset=>asset.id===output.assetId);
    if(asset.kind!=='image') fail('analysis_scope','逐图分析只能写回已登记的图片。');
    strictTags(output.tags,facetCatalog,6);
    const normalized=normalizeVisualModelResponse({reconstructionPrompt:output.reconstructionPrompt,tags:output.tags},facetCatalog);
    const input=item.assets.find(asset=>asset.assetId===output.assetId);
    const applied=applyCompletedImageResult({entries:[next],facetCatalog},next,asset,normalized,{
      imageFingerprint:input.sha256,providerType:'external',model,analyzedAt:now,catalogRevision:facetCatalog.revision,
      inputEvidence:evidence([asset.id]),batchJobId:batchId
    });
    next=applied.state.entries[0];facetCatalog=applied.state.facetCatalog;
  }
  for(const output of result.videoAnalyses??[]) {
    const asset=next.mediaAssets.find(asset=>asset.id===output.assetId);
    if(asset.kind!=='video') fail('analysis_scope','视频逆推只能写回已登记的视频。');
    const normalized=normalizeVideoReconstructionResult({reconstructionPrompt:output.reconstructionPrompt,tags:output.tags,uncertainties:output.uncertainties},{catalog:facetCatalog});
    const applied=applyCompletedVideoResult({entries:[next],facetCatalog},next,asset,{
      id:`video-analysis:${crypto.randomUUID()}`,...normalized,provider:'external',model,createdAt:now,
      requestId:item.attemptId,contractVersion:VIDEO_RECONSTRUCTION_CONTRACT_VERSION,includeTags:true,
      analysisScope:output.analysisScope,finishReason:'external_result',userEdited:false,
      inputEvidence:evidence([asset.id]),batchJobId:batchId
    });
    next=applied.state.entries[0];facetCatalog=applied.state.facetCatalog;
  }
  for(const output of result.visualSetAnalyses??[]) {
    const {assetIds,...value}=output;
    if(assetIds.some(id=>!allowed.has(id)||next.mediaAssets.find(asset=>asset.id===id)?.kind!=='image')) fail('analysis_scope','整组总结必须限定在已登记的图片中。');
    const prepared=prepareVisualSetSummary(assetIds.map(id=>{
      const asset=next.mediaAssets.find(asset=>asset.id===id);
      return {assetId:id,imageFingerprint:item.assets.find(input=>input.assetId===id).sha256,analysis:asset.visionAnalysis};
    }));
    if(!prepared.ready) fail('missing_individual_analysis','整组总结需要每张图片已有与当前原件一致的有效独立分析。');
    const summary=normalizeVisualSetSummaryV1(value,assetIds);
    next=normalizeEntryMedia({...next,visualSetAnalyses:[...(next.visualSetAnalyses??[]),{
      id:`visual-set:${crypto.randomUUID()}`,...summary,text:summary.reusablePrompt,mode:'group',
      provider:'external',model,createdAt:now,inputEvidence:evidence(assetIds)
    }]});
  }
  if(result.tags) {
    strictTags(result.tags,facetCatalog);
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
  const update={entries:state.entries.map(e=>e.id===next.id?next:e),...(result.tags||analyses.length?{facetCatalog}: {})};
  return {update,revision:await caseRevision({...state,...update},next,membershipsById?.get(item.caseId))};
}

function strictTags(tags,catalog,maxTags) {
  const diagnostics=[];
  const normalized=validateAnalysisTagResponse({tags},catalog,{diagnostics,...(maxTags?{maxTags}:{} )});
  if(diagnostics.length||normalized.length!==tags.length||normalized.some((tag,i)=>tag.g!==tags[i]?.g||tag.t!==(tags[i]?.t?.trim()||undefined))) fail('analysis_tags_invalid','标签包含无效、重复或超限内容；请修正后提交，不会静默丢弃。');
}
