// Shared external-result contract. Analysis runs in the host; these tools never call a model.
const id = {type:'string',minLength:1};
const request = {type:'string',pattern:'^[a-zA-Z0-9_-]{1,128}$'};
const integer = {type:'integer',minimum:0};
const object = (properties,required=[]) => ({type:'object',properties,required,additionalProperties:false});
const list = items => ({type:'array',items,minItems:1});
const inputItem = object({caseId:id,expectedRevision:id,assets:{type:'array',items:object({assetId:id,
  sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},coverage:id},['assetId','sha256','coverage'])}},['caseId','expectedRevision','assets']);
const result = object({
  tags:list(object({g:id,t:id},['g'])),
  mediaPrompts:list(object({assetId:id,text:id},['assetId','text'])),
  timeNotes:list(object({assetId:id,startMs:{type:'number',minimum:0},endMs:{type:'number',minimum:0},text:id},['assetId','startMs','text']))
});
export const ANALYSIS_RESULT_PAGE_SIZE = 24;
export const ANALYSIS_BATCH_SPECS = [
  {name:'submit_analysis_results',description:'提交一页已完成的分析结果，共用一次库读取和保存，降低大库重复写入。最多24项，与read_analysis_batch一页相同；同页caseId不能重复，每项result/error互斥。使用当前epoch和每项attemptId，案例版本、原件、人工编辑保护与单项提交相同。错误输入或过期尝试拒绝整页；有效尝试中分析内容冲突按项记失败，其余保存。必须检查返回items每项state及error。相同requestId/参数重试返回原回执，不重新计数。取消在每页之间生效，已开始提交的一页完成后才接收下一操作；不启动模型。',
    parameters:object({requestId:request,batchId:request,epoch:integer,items:{...list(object({caseId:id,attemptId:id,model:id,result,error:id},['caseId','attemptId'])),maxItems:ANALYSIS_RESULT_PAGE_SIZE}},['requestId','batchId','epoch','items'])},
  {name:'list_analysis_batches',description:'找回当前资料库的外部分析任务，不读取案例或全部分析结果。按最近更新排序，可按instruction/编号的query或status筛选；仅有外部批次，不包括内部模型任务。分页后续携带revision为expectedRevision并保持筛选不变；任务变化则从第一页重新读取。instructionExcerpt为240字符摘要，截断需read_analysis_batch读取完整要求。找到id后用read_analysis_batch核对输入、进度和结果，不自动重新分析。',
    parameters:object({query:{type:'string'},status:{enum:['collecting','awaiting_results','canceled','partial','completed']},offset:integer,expectedRevision:id})},
  {name:'manage_analysis_batch',description:'管理外部分析结果批次，不启动模型。create用requestId作为batchId并给instruction与items；add可分批登记，caseId在批次内唯一。items先read_case_details取得expectedRevision；文字分析assets=[]，视觉分析列实际读取的原件assetId、read_media的sha256及真实coverage（全片/抽帧范围等）。登记结束seal；cancel携带当前epoch停止后续写回且保留已成功项，不因普通进度变化拒绝取消；已在宿主运行的模型请求需宿主停止，resume仅恢复接收，使用取消后推进的epoch，不重跑模型。retry只重置指定失败项，传重新核对的item，新attemptId使旧结果失效。除create/cancel外的管理操作固定read_analysis_batch返回的expectedRevision，重试同requestId同参数。',
    parameters:object({requestId:request,batchId:request,expectedRevision:integer,epoch:integer,action:{enum:['create','add','seal','cancel','resume','retry']},instruction:id,items:list(inputItem)},['requestId','action'])},
  {name:'read_analysis_batch',description:'续查外部分析批次；不因断线自动分析或重试。返回真实总数/已保存/失败/待处理、epoch和revision。items分页给每项attemptId、输入版本和范围；后续页固定expectedRevision。part=result指定caseId分页读取提交结果/错误/覆盖记录；part=taxonomy读取当前标签g分类，后续页另携带contentRevision为expectedContentRevision；正文按nextOffset读全。成功回执不是当前案例仍存在的证明，可再read_case_details核对。',
    parameters:object({batchId:request,part:{enum:['items','result','taxonomy']},caseId:id,offset:integer,expectedRevision:integer,expectedContentRevision:id},['batchId'])},
  {name:'submit_analysis_result',description:'写回已登记案例的分析结果或报告单项失败。需当前epoch及该项attemptId；固定输入案例版本与原件SHA，过期/取消/文件变化不写入。result只支持追加AI标签、逐媒体AI提示词和新增视频时间笔记；不改人工原词、正文和现有笔记。视频提示词已有人工修改时拒绝覆盖。tags用taxonomy中g，t是细节，不静默截断；视觉标签绑定已登记素材。失败用error，与result互斥。支持领域内结果，不承诺任意分析JSON导入；完整报告另用save_material保存并关联来源。返回单项最终回执，不用get_task；相同requestId重试不重复写。',
    parameters:object({requestId:request,batchId:request,caseId:id,epoch:integer,attemptId:id,model:id,result,error:id},['requestId','batchId','caseId','epoch','attemptId'])}
];
