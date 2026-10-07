import { AGENT_INSTRUCTIONS, TOOL_TITLES } from './agent-guidance.mjs';
import { WORKSPACE_OPERATION_SPECS } from '../extension/workspace-operation-specs.js';
import {ANALYSIS_BATCH_SPECS} from '../extension/analysis-batch-specs.js';
import { AGENT_CASE_ACTION_SPECS } from '../extension/agent-case-action-specs.js';
import { WORKSPACE_SCREENSHOT_SPEC } from '../extension/workspace-screenshot-specs.js';
import { SKILL_OPERATION_SPECS, SKILL_FILE_PROPERTIES, SKILL_WRITE_SPECS, validateSkillWriteShape } from '../extension/skill-operation-specs.js';
import { PROJECT_OPERATION_SPECS, MATERIAL_PROPERTIES } from "../extension/project-operation-specs.js";
import packageInfo from './package.json' with { type: 'json' };
import { isMain } from "./is-main.mjs";
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { callExtension, CONNECTOR_TIMEOUT_MS } from './bridge-client.mjs';
import { receiveMedia, receiveWorkspaceScreenshot, stageFiles } from './transfers.mjs';
import { CASE_OPERATION_SPECS, CASE_SEARCH_PROPERTIES } from '../extension/case-operation-specs.js';
import { CASE_QUERY_PROPERTIES, CASE_QUERY_DESCRIPTION } from '../extension/case-query-specs.js';

const requestId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const project = z.string().optional();
const TIMING = process.env.PROMPTDIRECTOR_TIMING === '1';
const CONNECTION_ERROR_CODES = new Set(['connector_offline', 'connector_timeout', 'connector_access_denied']);

export function createServer(callBridge = callExtension) {
  // Status is reused only while the same native-host session answers: capability checks then cost no extra
  // round trip, and a reloaded extension is detected at the handshake before any request is sent.
  let cached = null;
  const call = async (operation, input) => {
    let hostSession;
    const started = TIMING ? performance.now() : 0;
    const result = await callBridge(operation, input, {
      ...(cached ? { expectedHostSession: cached.hostSession } : {}),
      onHostSession: value => { hostSession = value; }
    }).catch(error => {
      if (error?.code === 'connector_session_changed' || CONNECTION_ERROR_CODES.has(error?.code)) cached = null;
      throw error;
    }).finally(() => {
      // Developer timing goes to stderr so the MCP stdout protocol stays untouched; no arguments are logged.
      if (TIMING) process.stderr.write(`${JSON.stringify({ timing: 'bridge', operation, ms: Math.round(performance.now() - started) })}\n`);
    });
    if (operation === 'status') cached = hostSession ? { status: result, hostSession } : null;
    return result;
  };
  const requireStatus = async (satisfied) => cached && satisfied(cached.status) ? cached.status : call('status');
  const server = new McpServer({ name: 'promptdirector', version: packageInfo.version }, {
    instructions: AGENT_INSTRUCTIONS
  });
  function tool(name, description, inputSchema, readonly, handler, destructive = false) {
    server.registerTool(`promptdirector_${name}`, { title: TOOL_TITLES[name], description, inputSchema,
      annotations: { readOnlyHint: readonly, destructiveHint: destructive, idempotentHint: name !== 'show_case', openWorldHint: name === 'capture_url' } },
    async input => {
      try {
        const result = await handler(input).catch(error => {
          if (error?.code !== 'connector_session_changed') throw error;
          return handler(input);
        });
        if (name === 'capture_workspace' && result.image) {
          const { image, ...metadata } = result;
          return { content: [{ type: 'text', text: JSON.stringify(metadata), annotations: { audience: ['assistant'] } },
            { type: 'image', ...image }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result), annotations: { audience: ['assistant'] } }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code || 'operation_failed', message: error.message }) }] }; }
    });
  }
  for (const spec of WORKSPACE_OPERATION_SPECS) {
    const parameters = spec.name === 'control_workspace' ? { ...spec.parameters, properties: { ...spec.parameters.properties,
      file: { type: 'object', properties: { path: { type: 'string', minLength: 1 }, mimeType: { type: 'string' } }, required: ['path'], additionalProperties: false } } } : spec.name === 'read_review_media' ? { ...spec.parameters, properties: { tabId: spec.parameters.properties.tabId, temporaryId: spec.parameters.properties.temporaryId } } : spec.parameters;
    tool(spec.name, spec.description + (spec.name === 'control_workspace' ? ' open_temporary可用file传入明确指定的本机图片/视频路径，不先保存案例；上传后仍校验页面版本，过期不会抢回现场。临时上传沿既有临时文件生命周期整理。' : spec.name === 'read_review_media' ? ' MCP连接器自动读完原件并返回可供模型读取的本机文件路径。' : ''), z.fromJSONSchema(parameters), spec.name !== 'control_workspace', async input => {
      if (spec.name === 'read_review_media') return receiveMedia({ ...input, caseId: `temporary:${input.tabId}`, assetId: input.temporaryId },
        (_operation, chunk) => call('read_review_media', { tabId: input.tabId, temporaryId: input.temporaryId, offset: chunk.offset || 0, ...(input.length ? { length: input.length } : {}) }));
      if (input.file) {
        if (input.action !== 'open_temporary' || input.transferId) throw new Error('file仅用于open_temporary，不能同时传transferId');
        const current = await call('read_live_workspace', { tabId: input.tabId, requestId: input.requestId });
        if (current.controlRevision !== input.expectedRevision && !current.requestKnown) throw Object.assign(new Error('页面已改变，未上传样片'), { code: 'workspace_changed' });
        const { file, ...args } = input;
        const staged = await stageFiles([file], undefined, input.requestId, call);
        return call(spec.name, { ...args, transferId: staged.transferIds[0] });
      }
      return call(spec.name, input);
    });
  }
  for (const spec of ANALYSIS_BATCH_SPECS) tool(spec.name,spec.description,z.fromJSONSchema(spec.parameters),/^(read|list)_/.test(spec.name),input=>call(spec.name,input),!/^(read|list)_/.test(spec.name));
  for (const spec of AGENT_CASE_ACTION_SPECS) tool(spec.name, spec.description, z.fromJSONSchema(spec.parameters),
    false, async input => {
      const status = await requireStatus(current => current.capabilities?.includes(spec.name));
      if (!status.capabilities?.includes(spec.name)) throw Object.assign(new Error('插件后台尚未加载该案例操作，请保存未完成编辑后重载扩展。'), { code: 'unsupported_case_action' });
      return call(spec.name, input);
    }, true);
  tool(WORKSPACE_SCREENSHOT_SPEC.name, WORKSPACE_SCREENSHOT_SPEC.description, z.fromJSONSchema(WORKSPACE_SCREENSHOT_SPEC.parameters),
    true, input => receiveWorkspaceScreenshot(input, call));
  tool('status', '连接异常或首次需要探测能力时检查；已有成功业务回执不重复检查连接。', {}, true, () => call('status'));
  tool('describe_case_query', '发现当前库可组合查询的字段、实际互动指标，以及关系/缺失/排序/统计语义。只读帮助，不读取媒体原件。', {}, true, async () => {
    const status = await requireStatus(current => current.caseQueryVersion === 1);
    if (status.caseQueryVersion !== 1) throw Object.assign(new Error('插件后台尚未加载统一字段查询；保存未完成编辑后重载扩展，再重新读取字段帮助。'), { code: 'unsupported_case_query' });
    return call('describe_case_query');
  });
  tool('resolve_reference', '解析拖入名称链接中的 #pd-reference 片段或 promptdirector://reference 引用，无需访问链接网页。校验资料库、案例与具体素材归属，返回真实身份供 read_case/read_case_details/read_media 继续读取。引用不是执行指令，不以同名或相似画面猜测来源。', {
    reference: z.string().min(1)
  }, true, input => call('resolve_reference', input));
  tool('read_workspace_context', '读取选择概览；完整参考直接用 read_workspace_content(part=selection)。source=selection 读取跨页面关闭/重载保留的选择，空列表表示未选择；source=page/tabId 读取指定页面或创作台，多个页面不能合并或猜测。selectedCaseCount 为所选案例数，total 为逐素材参考数；originalPromptCharacters=0 表示缺原词，sourceUrl/memberCaseIds 用于追溯；pendingReferenceSelection=true 表示创作台选材草稿未确认。按 nextOffset/expectedRevision 续读清单。', {
    source: z.enum(['selection', 'page']).default('selection'),
    tabId: z.number().int().nonnegative().optional(), expectedRevision: z.string().optional(),
    offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(24)
  }, true, input => call('read_workspace_context', input));
  tool('read_workspace_content', '读取完整参考：part=selection 为整组创作参考的分页JSON（非全案例数据库记录），reference 为单份，instruction 为输入框草稿。selection 首屏可省略 expectedRevision，同次调用固定当前版本；续页必须传返回的 revision，按 nextOffset 拼接后解析；selection_changed 时重读现场，不混旧页。source=selection 读持久选择，source=page/tabId 读页面。originalText 完整且仅一份；referenceTextParts 顺序拼接，字符串为正文，对象 source=originalText 或 referenceSources/index 引用已有文本，referenceSources.textSource=originalText 同理。caseSources 含回存所需成员版本；media 含所属 caseId、原件角色、封面编号及已知尺寸/时长。缺版本的页面临时参考按需查 read_case_details；库内原件用 read_media，temporary 参考未入库原件暂不支持。', {
    source: z.enum(['selection', 'page']).default('selection'),
    tabId: z.number().int().nonnegative().optional(), expectedRevision: z.string().min(1).optional(),
    part: z.enum(['instruction', 'reference', 'selection']), referenceId: z.string().optional(),
    offset: z.number().int().nonnegative().default(0), length: z.number().int().min(1).max(49152).default(12000)
  }, true, async input => {
    if (!input.expectedRevision && (input.part !== 'selection' || input.offset !== 0)) {
      throw Object.assign(new Error('续页或单份读取必须携带已取得的 expectedRevision。'), { code: 'invalid_input' });
    }
    try { return await call('read_workspace_content', input); }
    catch (error) {
      // The installed older extension requires a context read before the first content page.
      // Keep that exact compatibility route; never reinterpret other invalid input or conflicts.
      if (input.expectedRevision || error?.code !== 'invalid_input' || error.message !== '读取参考必须携带当前选择的版本。') throw error;
      const context = await call('read_workspace_context', { source: input.source, ...(input.tabId !== undefined ? { tabId: input.tabId } : {}) });
      if (!context.revision) return context;
      return call('read_workspace_content', { ...input, expectedRevision: context.revision });
    }
  });
  tool('show_case', '在插件新页面打开指定案例详情，保留原页面选择和未保存编辑。返回 opening 只表示页面已打开，随后用 read_workspace_context(tabId) 核对 viewedCaseId，才可报告详情已显示。', {
    caseId: z.string().min(1)
  }, false, input => call('show_case', input));
  for (const spec of [...CASE_OPERATION_SPECS, ...PROJECT_OPERATION_SPECS, ...SKILL_OPERATION_SPECS]) {
    const readonly = spec.name.startsWith('read_') || spec.name === 'list_skills';
    tool(spec.name, spec.description, z.fromJSONSchema(spec.parameters), readonly, async input => {
      if (spec.name === 'edit_case') {
        const status = await requireStatus(current => current.sourceProtectionVersion === 1);
        if (status.sourceProtectionVersion !== 1) throw Object.assign(new Error('插件后台尚未加载原始资料保护；保存未完成编辑后重载扩展，再执行修改。'), { code: 'unsupported_source_protection' });
      }
      return call(spec.name, input);
    }, ['edit_case', 'organize_case', 'update_project'].includes(spec.name));
  }
  const saveSkill = SKILL_WRITE_SPECS.find(spec => spec.name === 'save_skill');
  tool('save_skill', saveSkill.description + ' files使用明确指定的本机path和包内packagePath，不扫描目录；不需要手工压ZIP。完整正文或引用已在文件时优先files，不在参数中重抄或自行压缩；内联受含JSON信封的单次本机消息边界约束，包的maxTextBytes是本次解析预算，均不等于资料容量。', z.fromJSONSchema({
    ...saveSkill.parameters, properties: { ...saveSkill.parameters.properties, files: { type: 'array', minItems: 1,
      items: { type: 'object', properties: { path: {type:'string',minLength:1}, packagePath: {type:'string',minLength:1}, mimeType: {type:'string'} }, required: ['path','packagePath'], additionalProperties:false } } }
  }), false, async input => {
    const { files, ...metadata } = input;
    validateSkillWriteShape({ ...metadata, ...(files ? { files: files.map(file => ({ path: file.packagePath })) } : {}) });
    const status = await requireStatus(current => current.capabilities?.includes('save_skill') && (!files || current.skillPackageLimits));
    if (!status.capabilities?.includes('save_skill')) throw new Error('插件后台尚不支持Skill写入，请更新并重载插件后重试；未上传文件。');
    if (!files) return call('save_skill',metadata);
    if (!status.skillPackageLimits) throw new Error('插件未声明Skill包限制，未开始上传；请核对插件与连接器版本。');
    const staged = await stageFiles(files, undefined, input.requestId, call, {purpose:'skill-file',limits:status.skillPackageLimits});
    return call('save_skill',{...metadata, files:files.map((file,index)=>({path:file.packagePath,transferId:staged.transferIds[index]}))});
  }, true);
  const restoreSkill = SKILL_WRITE_SPECS.find(spec => spec.name === 'restore_skill');
  tool(restoreSkill.name, restoreSkill.description, z.fromJSONSchema(restoreSkill.parameters), false, input => call(restoreSkill.name,input), true);
  tool('search_cases', CASE_QUERY_DESCRIPTION + ' 搜索当前资料库文字与标签，可组合project、mediaKind和hasOriginalPrompt；媒体筛选忽略封面，原词筛选不将AI逆推当原词。query支持type/source/tag/color/date/note/has过滤，alternatives并集支持同义表达；sort支持时间排序；sort=engagement需provider和engagementMetric（如likes），按已保存指标降序，未知排末；看engagementCoverage和sources的观测时间，不冒称实时热度。authorHandle精确匹配保存作者，正文提及不算。countOnly仅计数，项目树按需read_projects。项目含子项目。minDurationMs/maxDurationMs按毫秒筛选视频或音频；缺时长不当作0，查看durationCoverage。继续翻页必须携带首屏revision作为expectedRevision，筛选不变；search_changed时从第一页重新读，不能混用新旧页。摘要不能替代原文或视觉识别；仅标题没命中不能断言画面里没有。', z.fromJSONSchema({
    type: 'object', properties: { ...CASE_SEARCH_PROPERTIES,
      offset: { type: 'integer', minimum: 0, default: 0 }, limit: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
    additionalProperties: false
  }), true, async input => {
    const requested = ['provider', 'authorHandle', 'engagementMetric', 'hasPrompt', ...Object.keys(CASE_QUERY_PROPERTIES)].filter(key => input[key] !== undefined);
    if (requested.length || input.sort === 'engagement') {
      const supports = current => (!Object.keys(CASE_QUERY_PROPERTIES).some(key => input[key] !== undefined) || current.caseQueryVersion === 1)
        && requested.every(key => current.searchFilters?.includes(key))
        && (input.sort !== 'engagement' || current.searchFilters?.includes('engagementMetric'));
      const status = await requireStatus(supports);
      if (Object.keys(CASE_QUERY_PROPERTIES).some(key => input[key] !== undefined) && status.caseQueryVersion !== 1) {
        throw Object.assign(new Error('插件后台尚未加载统一字段查询；保存未完成编辑后重载扩展。不能把忽略字段条件的旧结果当作查询成功。'), { code: 'unsupported_case_query' });
      }
      if (requested.some(key => !status.searchFilters?.includes(key)) || input.sort === 'engagement' && !status.searchFilters?.includes('engagementMetric')) {
        throw Object.assign(new Error('插件后台尚未加载所需搜索筛选；请保存未完成编辑后重载扩展，不能将旧搜索结果当作精确筛选。'), { code: 'unsupported_search_filters' });
      }
    }
    return call('search', input);
  });
  tool('read_case', '读取完整正文或原词，响应仅含文字、身份与续读信息；媒体/来源结构按需read_case_details。续页携带revision作为expectedRevision并保持part/assetId；case_text_changed时从第一页重读，不拼接旧页。此revision只固定文字，编辑版本另读read_case_details。body是正文，original_prompt按来源证据组织原词，二者可能相同也可能不同；指定assetId只读该素材原词。media_prompts返回分页JSON。generation_info需指定原始图片assetId。媒体原件另用read_media。', {
    caseId: z.string(), part: z.enum(['body', 'original_prompt', 'ai_prompt', 'time_notes', 'document', 'media_prompts', 'generation_info']).default('body'), assetId: z.string().optional(),
    expectedRevision: z.string().min(1).optional(), offset: z.number().int().nonnegative().default(0), length: z.number().int().min(1).max(49152).default(12000)
  }, true, async input => {
    if (input.offset > 0 && !input.expectedRevision) throw Object.assign(new Error('续读文字需要首屏的revision，请从第一页重新读取。'), { code: 'case_revision_required' });
    const page = await call('read_case', input);
    if (!page.revision) throw Object.assign(new Error('插件后台尚未加载文字续读保护；请保存未完成编辑后重载扩展。'), { code: 'unsupported_case_text_revision' });
    if (input.expectedRevision && input.expectedRevision !== page.revision) throw Object.assign(new Error('案例文字已变化，请从第一页重新读取，不能拼接旧页。'), { code: 'case_text_changed' });
    return page;
  });
  tool('read_media', '将选定案例的一份媒体原件完整读取到 Agent 本机文件并验证 SHA-256。需用宿主图片、视频或文件工具查看；成功下载不等于已经分析。', {
    caseId: z.string(), assetId: z.string()
  }, true, input => receiveMedia(input, call));
  tool('download_skill_file', '把read_skill(files)列出的文件完整保存到Agent本机并校验SHA-256，返回path和relativePath。对脚本、图片和长参考可用宿主工具读取；保持source区分当前文字和原始包。不会执行脚本或安装依赖。', z.fromJSONSchema({
    type: 'object', properties: SKILL_FILE_PROPERTIES, required: ['skillId', 'expectedRevision', 'source', 'path'], additionalProperties: false
  }), true, async input => {
    const file = await receiveMedia(input, (_operation, args) => call('read_skill_file', { ...args, encoding: 'binary' }));
    return { ...file, skillId: input.skillId, revision: input.expectedRevision, source: input.source, relativePath: input.path };
  });
  tool('capture_url', '交给 PromptDirector 自己采集网页，在 Chrome 打开独立标签。返回任务编号后必须查询 get_task，只有最终回执才能报告入库结果。重试沿用相同 requestId。', {
    requestId, url: z.url(), project, generationPromptChoices: z.record(z.string(), z.enum(['overwrite', 'skip'])).optional()
  }, false, input => call('capture', input));
  tool('save_material', '将正文、本机附件或创作结果保存到资料库。保留来源案例。project 用 read_projects 查到的 ID；新项目先 create_project。projectRevision 固定已读要求；sourceReferences 精确记录已读成员案例版本、素材与毫秒片段。previousCreation 仅在用户要求另存版本时指定，旧成果保留。files 必须是明确选定的绝对文件路径；不扫描目录。bodyFile 可指定正文文档，须同时列入 files。正文中的图片引用不会自动下载。连接器等待短任务并返回终态；仅 queued/running 或 waitError 才继续用原 requestId 查询 get_task。completed 时核对 results 的正文摘要、项目、来源与 revision；replayed 为历史回执，须按需读回确认当前存在。', {
    ...Object.fromEntries(Object.entries(MATERIAL_PROPERTIES).map(([key, schema]) => [key, z.fromJSONSchema(schema).optional()])),
    requestId, title: z.string().min(1), text: z.string().max(196608, '长正文请通过 bodyFile 传入，原文不需要缩短。').default(''), project,
    kind: z.enum(['collected', 'creation']).default('collected'), sourceUrl: z.url().optional(),
    sourceCaseIds: z.array(z.string()).default([]), note: z.string().default(''),
    files: z.array(z.object({ path: z.string(), mimeType: z.string(), originalPrompt: z.string().optional(), forceImport: z.boolean().default(false) })).default([]),
    bodyFile: z.string().optional(), generationPromptChoices: z.record(z.string(), z.enum(['overwrite', 'skip'])).optional()
  }, false, async input => {
    const authoredFields = ['creative', 'customLabels', 'classificationPathIds', 'sourceFacts', 'timeNotes'].filter(key => input[key] !== undefined);
    if (authoredFields.length) {
      const status = await requireStatus(current => authoredFields.every(key => current.materialFields?.includes(key)));
      if (authoredFields.some(key => !status.materialFields?.includes(key))) {
        throw Object.assign(new Error('插件后台尚不支持本次回存字段；请保存未完成编辑后重载扩展。未上传或保存资料。'), { code: 'unsupported_material_fields' });
      }
    }
    const { files, bodyFile, ...material } = input;
    const staged = await stageFiles(files, bodyFile, input.requestId, call);
    const task = await call('save_material', { ...material, ...staged });
    if (!['queued', 'running'].includes(task.state)) return task;
    // Half the existing bridge timeout leaves room for submission and transport.
    // Wait on the original persisted task; never resubmit after a lost receipt.
    try { return await call('get_task', { requestId: input.requestId, waitMs: CONNECTOR_TIMEOUT_MS / 2 }); }
    catch (error) { return { ...task, waitError: { code: error.code || 'operation_failed', message: error.message },
      next: '完成状态尚未确认；用原 requestId 查询 get_task，不要新建保存请求。' }; }
  });
  tool('get_task', '查询采集或回存的最终结果。queued/running 仅表示处理中；completed 后检查每项 saved/partial/duplicate 和 warnings。interrupted 时核对资料库，不能谎报成功。promptConflicts 需按 token 分页读取两份原始提示词，询问用户覆盖或跳过后，携带 generationPromptChoices 用新请求编号重试；不得自行决定。', {
    requestId, conflictToken: z.string().optional(), conflictPart: z.enum(['originalText', 'embeddedText']).optional(),
    offset: z.number().int().nonnegative().optional(), length: z.number().int().positive().max(49152).optional()
  }, true, input => call('get_task', input));
  return server;
}
if (isMain(import.meta.url)) {
  await createServer().connect(new StdioServerTransport());
}
