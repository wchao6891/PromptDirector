import {ANALYSIS_BATCH_SPECS,ANALYSIS_RESULT_PAGE_SIZE} from './analysis-batch-specs.js';
import {validate} from './case-operation-specs.js';
import {canonicalInput} from './agent-tasks.js';
import {sha256Blob} from './blob-digest.js';
import {agentError} from './agent-protocol.js';
import {analysisTaxonomyPayload} from './tag-taxonomy.js';
import {checkAnalysisInput,planExternalAnalysisResult} from './external-analysis-result.js';
import {caseOrganizationIndex} from './case-operations.js';

const fail=(code,message)=>{throw agentError(code,message);};
const hash=value=>sha256Blob(new Blob([JSON.stringify(canonicalInput(value))]));
const metaKey=id=>`externalAnalysis:${id}`;
const rowKey=(id,index)=>`${metaKey(id)}:item:${index}`;
const lookupKey=(id,caseId)=>`${metaKey(id)}:case:${caseId}`;
const brief=row=>{const {output,previousAttempts,...rest}=row;return rest;};
const status=batch=>batch.canceled?'canceled':!batch.sealed?'collecting':batch.saved+batch.failed<batch.total?'awaiting_results':batch.failed?'partial':'completed';
const summary=batch=>({...batch,status:status(batch),pending:batch.total-batch.saved-batch.failed});

// Each item has its own record. Progress updates do not rewrite or read every
// other result, and task metadata contains no growing array of case snapshots.
export function createExternalAnalysisBatches({storage,loadState,commit,enqueue,readBlob,getLibraryId}) {
  const get=async key=>(await storage.get(key))[key];
  async function own(batch) {
    if(!batch) fail('analysis_batch_not_found','分析批次不存在。');
    if(batch.libraryId!==await getLibraryId()) fail('library_mismatch','分析批次属于另一份资料库。');
    return structuredClone(batch);
  }
  async function rowFor(batch,caseId) {
    const index=await get(lookupKey(batch.id,caseId));
    const row=index===undefined?null:await get(rowKey(batch.id,index));
    if(!row) fail('analysis_item_not_found','案例没有登记在此批次。');
    return structuredClone(row);
  }
  async function list(input) {
    const libraryId=await getLibraryId();
    if(!libraryId) fail('library_identity_invalid','资料库身份不可用。');
    const keys=(await storage.getKeys()).filter(key=>/^externalAnalysis:[a-zA-Z0-9_-]{1,128}$/.test(key));
    const stored=keys.length?await storage.get(keys):{};
    if(keys.some(key=>!stored[key])) fail('analysis_batch_changed','任务记录已变化，请重新读取列表。');
    const query=(input.query??'').trim().toLocaleLowerCase();
    const batches=keys.map(key=>stored[key]).filter(batch=>batch.libraryId===libraryId)
      .map(summary).filter(batch=>(!input.status||batch.status===input.status)&&
        (!query||`${batch.id}\n${batch.instruction}`.toLocaleLowerCase().includes(query)))
      .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id));
    const revision=await hash({libraryId,query,status:input.status??null,batches:batches.map(batch=>[batch.id,batch.revision])});
    const offset=input.offset??0;
    if((offset&&!input.expectedRevision)||(input.expectedRevision&&input.expectedRevision!==revision)) fail('analysis_batch_changed','任务或筛选已变化，请从第一页重新读取。');
    if(offset>batches.length) fail('invalid_input','读取位置超出任务列表。');
    if(await getLibraryId()!==libraryId) fail('library_mismatch','资料库已切换，请重新读取任务。');
    return {ok:true,revision,total:batches.length,offset,batches:batches.slice(offset,offset+ANALYSIS_RESULT_PAGE_SIZE).map(({instruction,...batch})=>({...batch,instructionExcerpt:instruction.slice(0,240),instructionTruncated:instruction.length>240})),nextOffset:offset+ANALYSIS_RESULT_PAGE_SIZE<batches.length?offset+ANALYSIS_RESULT_PAGE_SIZE:null,untrustedContent:true};
  }
  async function read(input) {
    const batch=await own(await get(metaKey(input.batchId)));
    const offset=input.offset??0;
    if((offset&&!Object.hasOwn(input,'expectedRevision'))||
      (input.expectedRevision!==undefined&&batch.revision!==input.expectedRevision)) fail('analysis_batch_changed','批次已变化，请从第一页重新读取。');
    const part=input.part??'items';
    if(part==='items') {
      if(offset>batch.total) fail('invalid_input','读取位置超出批次。');
      const end=Math.min(batch.total,offset+ANALYSIS_RESULT_PAGE_SIZE);
      const keys=Array.from({length:end-offset},(_,i)=>rowKey(batch.id,offset+i));
      const stored=keys.length?await storage.get(keys):{};
      if(keys.some(key=>!stored[key])) fail('analysis_batch_incomplete','批次记录缺失，请检查资料，不能把缺失项当已完成。');
      return {ok:true,...summary(batch),items:keys.map(key=>brief(stored[key])),offset,nextOffset:end<batch.total?end:null,untrustedContent:true};
    }
    const content=part==='taxonomy'?analysisTaxonomyPayload((await loadState()).facetCatalog):JSON.stringify(await rowFor(batch,input.caseId));
    const contentRevision=await hash(content);
    if(part==='taxonomy'&&((offset&&!input.expectedContentRevision)||(input.expectedContentRevision&&input.expectedContentRevision!==contentRevision))) fail('analysis_taxonomy_changed','标签分类已变化，请从第一页重新读取。');
    if(offset>content.length) fail('invalid_input','读取位置超出结果。');
    return {ok:true,...summary(batch),part,contentRevision,content:content.slice(offset,offset+12000),offset,totalCharacters:content.length,nextOffset:offset+12000<content.length?offset+12000:null,untrustedContent:true};
  }
  return {execute:(name,input)=>enqueue(async()=>{
    const spec=ANALYSIS_BATCH_SPECS.find(spec=>spec.name===name);
    if(!spec) fail('unknown_operation','未知分析批次操作。');
    validate(spec.parameters,input,name);
    if(name==='list_analysis_batches') return list(input);
    if(name==='read_analysis_batch') return read(input);
    const receiptKey=`externalAnalysisReceipt:${input.requestId}`;
    const fingerprint=await hash({name,input});
    const prior=await get(receiptKey);
    if(prior) {
      await own(await get(metaKey(prior.result.batchId)));
      if(prior.fingerprint!==fingerprint) fail('request_conflict','此请求编号已用于其他分析操作。');
      return {...prior.result,replayed:true};
    }
    const creating=name==='manage_analysis_batch'&&input.action==='create';
    if(creating&&(input.batchId!==undefined||input.expectedRevision!==undefined)) fail('invalid_input','新建批次不传batchId或expectedRevision。');
    if(!creating&&!input.batchId) fail('invalid_input','请指定分析批次。');
    const id=creating?input.requestId:input.batchId;
    let batch=creating?{id,libraryId:await getLibraryId(),instruction:input.instruction,total:0,saved:0,failed:0,epoch:0,revision:0,sealed:false,canceled:false,createdAt:new Date().toISOString()}:await own(await get(metaKey(id)));
    if(!batch.libraryId) fail('library_identity_invalid','资料库身份不可用。');
    if(creating&&await get(metaKey(id))) fail('request_conflict','批次编号已存在。');
    let changes={},itemResult,itemResults;
    if(name==='manage_analysis_batch') {
      const action=input.action;
      if(action==='cancel') {
        if(input.epoch!==batch.epoch) fail('analysis_epoch_changed','批次已取消或恢复过，请核对当前状态再取消。');
      } else if(!creating&&input.expectedRevision!==batch.revision) fail('analysis_batch_changed','批次已变化，请读取最新状态后再管理。');
      if(!creating&&input.instruction!==undefined) fail('invalid_input','已有批次的分析要求不能改变；不同要求请新建批次。');
      if(!['create','add','retry'].includes(action)&&input.items!==undefined) fail('invalid_input','此操作不接受案例清单。');
      if(['create','add','retry'].includes(action)) {
        if(!input.items?.length||(creating&&!input.instruction)) fail('invalid_input','请提供分析要求及案例清单。');
        if(batch.canceled) fail('analysis_batch_canceled','批次已取消；恢复接收前不能新增或重试。');
        if(action==='add'&&batch.sealed) fail('analysis_batch_sealed','批次已登记完毕；新增范围请另建批次。');
        if(action==='retry'&&input.items.length!==1) fail('invalid_input','每次重试一项，便于明确新输入版本。');
        if(new Set(input.items.map(item=>item.caseId)).size!==input.items.length) fail('invalid_input','同批登记的案例不能重复。');
        const state=await loadState();
        const entriesById=new Map(state.entries.map(entry=>[entry.id,entry]));
        const membershipsById=caseOrganizationIndex(state,input.items.map(item=>item.caseId));
        const lookups=await storage.get(input.items.map(item=>lookupKey(id,item.caseId)));
        for(const item of input.items) {
          await checkAnalysisInput(state,item,entriesById,membershipsById);
          let index=lookups[lookupKey(id,item.caseId)];
          let attempts=1,previousAttempts=[];
          if(action==='retry') {
            const previous=await rowFor(batch,item.caseId);
            if(previous.state!=='failed') fail('analysis_item_not_failed','仅失败项可重试；成功结果不能重放。');
            index=previous.index;attempts=previous.attempts+1;batch.failed--;
            const {previousAttempts:history=[],...record}=previous;
            previousAttempts=[...history,record];
          } else {
            if(index!==undefined) fail('analysis_item_duplicate','此案例已登记，请读取原记录。');
            index=batch.total++;
          }
          const row={...structuredClone(item),index,state:'pending',attempts,attemptId:crypto.randomUUID(),...(previousAttempts.length?{previousAttempts}: {})};
          changes[rowKey(id,index)]=row;changes[lookupKey(id,item.caseId)]=index;
          itemResult=brief(row);
        }
      } else if(action==='seal') batch.sealed=true;
      else if(action==='cancel') {batch.canceled=true;batch.epoch++;}
      else if(action==='resume') {
        if(!batch.canceled) fail('invalid_input','批次未取消，无需恢复。');
        batch.canceled=false; // epoch was advanced at cancellation; old results stay invalid.
      }
    } else {
      const submissions=name==='submit_analysis_results'?input.items:[input];
      if(new Set(submissions.map(item=>item.caseId)).size!==submissions.length) fail('invalid_input','同页提交的案例不能重复。');
      for(const item of submissions) if((item.result===undefined)===(item.error===undefined)) fail('invalid_input','每项必须提供result或error其中一项。');
      if(batch.canceled) fail('analysis_batch_canceled','批次已取消，迟到结果没有写入。');
      if(input.epoch!==batch.epoch) fail('analysis_epoch_changed','批次已取消或恢复过，请重新核对待处理项，旧结果不能写入。');
      const rows=[];
      for(const item of submissions) {
        const row=await rowFor(batch,item.caseId);
        if(row.state!=='pending'||row.attemptId!==item.attemptId) fail('analysis_attempt_stale','此项已经处理或重试，旧结果不能再次写入。');
        rows.push(row);
      }
      // Validate every attempt before planning; one fresh state and one commit per page.
      let state=submissions.some(item=>item.result)?await loadState():null;
      const entriesById=state?new Map(state.entries.map(entry=>[entry.id,entry])):null;
      const membershipsById=state?caseOrganizationIndex(state,submissions.map(item=>item.caseId)):null;
      itemResults=[];
      for(const [index,item] of submissions.entries()) {
        const row=rows[index];
        row.output={...(item.model?{model:item.model}:{}),...(item.result?{result:item.result}:{error:item.error}),receivedAt:new Date().toISOString()};
        if(item.error) {row.state='failed';row.error={code:'external_analysis_failed',message:item.error};batch.failed++;}
        else {
          let plan;
          try {plan=await planExternalAnalysisResult(state,row,item.result,{readBlob,entriesById,membershipsById});}
          catch(error) {
            row.state='failed';row.error={code:error.code||'analysis_result_invalid',message:error.message};batch.failed++;
          }
          if(plan) {Object.assign(changes,plan.update);state={...state,...plan.update};row.state='saved';row.savedRevision=plan.revision;batch.saved++;}
        }
        changes[rowKey(id,row.index)]=row;
        itemResults.push(brief(row));
      }
      if(name==='submit_analysis_result') {itemResult=itemResults[0];itemResults=undefined;}
    }
    batch.revision++;batch.updatedAt=new Date().toISOString();
    const result={ok:true,requestId:input.requestId,batchId:id,...summary(batch),...(itemResult?{item:itemResult}: {}),...(itemResults?{items:itemResults}: {})};
    // Re-check identity immediately before the metadata/row/library commit.
    await own(batch);
    await commit({...changes,[metaKey(id)]:batch,[receiptKey]:{fingerprint,result}});
    return result;
  })};
}
