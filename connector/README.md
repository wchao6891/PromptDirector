# PromptDirector Agent 连接器

提供搜索、读取、保存、编辑及案例整理工具，支持本机 Windows、macOS 和 Linux Google Chrome。连接器和扩展需要同时安装，Chrome 需要保持运行。

## 当前参考与引用

在案例库使用多选选择参考，选择自动保存；外部Agent直接调用 `read_workspace_content(part=selection)` 读取完整参考，首次第一页可省略版本，续页携带返回的 `revision`。只需概览时使用 `read_workspace_context`。无需进入创作台、导出或发送参考；已有创作台可通过显式页面上下文接续。内部模型API不是外部调用前置。

`resolve_reference` 接受名称链接中的 `#pd-reference=…` 片段，或 `promptdirector://reference?v=1&library=…&case=…&asset=…`，校验身份后再调用现有原文、结构和媒体接口，无需访问链接网页。引用身份不包含密钥；错误库或错误媒体归属明确失败。此接口可用不等于各宿主拖拽已通过，跨应用接收按实际验收记录判断。`show_case` 打开独立详情页面；返回opening后需读页面核对显示结果。

卡片拖出使用案例名称链接，指向整个案例；详情图片及本地视频使用原件名称链接，指向具体素材。有本地原件的图片、视频、文档及其他附件同时携带原件文件拖出数据；视频取原视频，文档取原文档，不把预览封面作为原件。宿主须保留链接或纯文字中的引用才能精确定位；只收到名称时，同名搜索不能证明拖拽身份已传递。插件页面无有效资料库身份时拒绝拖出，普通阅读仍可继续。

富文本名称使用案例来源网页链接，定位身份仅在片段中；无有效网页来源时使用扩展配置的项目主页。点击链接打开来源或项目主页，Agent读取须调用MCP。富文本提供名称链接和不显示的原件载体；有原件时纯文字、URI及DownloadURL沿用原件文件通道，没有原件才使用名称Markdown链接。已授权HTTP(S)网页的接收脚本会在真实拖放时将本插件原件转为完整File，交给网站原有上传入口；不申请新权限、不压缩原件。更新扩展后需刷新接收网页，网站仍须支持File拖放。只接收纯文字且不保留富文本的Agent不能保证获得案例引用。桌面、网页画布和Agent须分别实际接收验收。管理选择/排序状态沿用已有手势，退出后所有案例卡片恢复拖出。

整组创作参考可用 `read_workspace_content(part=selection, expectedRevision=...)` 分页读取，避免每条独立往返；`status.workspaceContentParts` 用于探测后台支持。`selectedCaseCount` 表示选中的案例数，`total` 表示逐素材展开后的参考数。已进入管理的多个案例库页面会同步选中状态，普通浏览和其他任务选择不被切换。失效案例或文档通过 `issues` 及 `completeness=partial` 声明，其余参考仍可读取；`availableCaseCount` 表示可用案例数，读取不会清空失效选择。清单包含来源、组合成员编号及原词字符数；完整案例结构仍按需通过 `read_case_details` 获取。

## 工具

| 工具后缀 | 功能 |
|---|---|
| `status` | 配对资料库的实时连接状态和能力 |
| `read_workspace_context` | 当前已选参考的顺序、版本、素材清单；也可显式读取页面现场 |
| `read_workspace_content` | 同一版本下完整读取整组或单份创作参考，长内容分页 |
| `resolve_reference` | 校验PD资料库、案例及素材身份，取得读取入口 |
| `show_case` | 打开案例详情，随后读取页面核对是否实际显示 |
| `search_cases` | 文字/标签、项目、素材类型及有无原词组合筛选，同义查询、时间排序、分页或仅计数 |
| `read_case` | 分页读取正文、文档提取文字、原始提示词、分析文字、时间笔记和媒体提示词关系 |
| `read_media` | 下载选定原件至本机文件，验证完整字节和 SHA-256 |
| `list_skills` | 按名称和说明检索 Skill 摘要，支持带版本的分页 |
| `read_skill` | 分页读取当前或指定保留版本的正文、完整参考及文件清单 |
| `read_skill_file` | 按清单读取当前生成文件或原始包文件，支持文字与二进制分块 |
| `download_skill_file` | 将指定 Skill 文件完整保存到 Agent 本机，核对摘要；不执行脚本 |
| `capture_url` | 插件打开独立 Chrome 标签并调用现有采集流程 |
| `list_analysis_batches` | 按要求关键字或状态找回当前资料库的外部分析批次 |
| `submit_analysis_results` | 一页结果共用一次保存，逐项保留成功与失败 |
| `manage_analysis_batch` | 分批登记分析输入，封口、取消、恢复接收及失败项重试；不调用模型 |
| `read_analysis_batch` | 分页读取进度、输入、完整结果与失败记录，断线后继续核对 |
| `submit_analysis_result` | 按固定案例版本和原件摘要写回 AI 标签、提示词与时间笔记 |
| `save_skill` | 新建 Skill 或按已读版本更新正文/完整本机文件包，重复请求返回原回执 |
| `restore_skill` | 将保留的正文与已记录文件恢复为新版本；未知旧文件不以当前文件代替 |
| `save_material` | 正文、附件和创作结果入库，保留精确来源与前一成果版本 |
| `read_projects` | 分页读取项目树、完整要求与项目版本 |
| `create_project` | 建立项目或子项目，保存要求，重复请求不重复建立 |
| `update_project` | 按已读版本修改项目名称和要求，不覆盖新编辑 |
| `get_task` | 查询持久任务回执，区分处理中、成功、部分成功、失败和中断 |
| `read_case_details` | 分页读取案例完整来源、媒体元数据、正文结构、标注及项目关系，返回修改版本 |
| `edit_case` | 按字段编辑标题、正文段落、来源、标签、逐媒体提示词和时间笔记 |
| `organize_case` | 选定媒体拆为新案例、转移到另一案例、移动或独立复制到已有项目 |

完整名称有 `promptdirector_` 前缀。创作由 Agent 完成，这些工具不额外调用模型。目前不包含删除、批量管理或全库自动分析。工具是否可用以当前连接器的工具列表及插件 `status` 回执为准；新增编辑能力需要同时更新两端。

外部批量分析：分析由宿主完成，插件接收结果。先读案例版本、实际需要的原件；用 `manage_analysis_batch(action:"create")` 登记 `instruction` 与 `items:[{caseId,expectedRevision,assets:[]}]`，返回的 `batchId` 就是创建请求编号。文字分析 `assets=[]`；视觉分析逐项提供 `{assetId,sha256,coverage}`，摘要来自 `read_media`，coverage 如实写全片、抽帧或具体范围。大清单可用 `add` 分批登记，结束用 `seal`；同一批次每个案例登记一次，多个素材放该案例的 assets。

`read_analysis_batch` 给出每项 `attemptId`、输入版本和批次 `epoch`。宿主完成一项后用 `submit_analysis_result` 提交 `result` 或 `error`，二者互斥。result 当前接收 `tags:[{g,t?}]`、`mediaPrompts:[{assetId,text}]`、`timeNotes:[{assetId,startMs,endMs?,text}]`。标签 g 从 `part:"taxonomy"` 读取，异常、重复、过长或超限标签整项拒绝，不静默删减。图片提示词和时间笔记必须在登记素材内；标签追加且保留人工关系，提示词只写 AI 来源，时间笔记只新增。已有不同 AI 提示词或人工修改的逆推结果需单独核对后走 `edit_case`，不会被批量替换。完整自由格式分析报告用 `save_material` 保存并关联来源，本接口不接受任意底层字段。

结果提交返回的是单项最终回执；`ok:true` 表示已记录回执，必须检查 `item.state` 是否 `saved`。失败项携带具体原因，`partial` 不能报告全批成功。案例、关系、原件发生变化时整项失败，不写旧结果。元数据、案例修改和回执一次提交；相同请求同参数重试不会重复添加标签或笔记。

取消用 `manage_analysis_batch(action:"cancel",epoch:...)`，普通进度变化不会阻止取消。成功项保留，后续旧 epoch 结果拒绝。它只停止插件接收，宿主必须自行停止模型或脚本请求。`resume` 只恢复接收，不自动分析；重新核对当前 epoch 后处理未完成项，不能把旧结果换个编号直接提交。失败项用 `retry` 并提供重新核对的单项输入，取得新 attemptId 后重做；旧尝试及失败结果仍可读。除了 create/cancel，管理操作需带最新 expectedRevision。所有写操作都有唯一 requestId。

忘记批次编号或重连后，先 `list_analysis_batches` 按 `query`（要求或编号）/`status` 找回，再 `read_analysis_batch` 核对。列表只取任务摘要，不载入案例和结果正文；`instructionExcerpt` 沿用搜索摘要的240字符长度，`instructionTruncated` 表示需从批次读取完整要求。列表按最近更新排序，每页24项；后续携带 `revision` 为 `expectedRevision` 并保持筛选，变化后重读第一页。仅列当前资料库的外部批次，不包括内部模型任务。续查无需 `get_task`。items 为紧凑分页，结果可用 `part:"result",caseId:...` 按 nextOffset 读取完整 JSON，后续页携带 expectedRevision；taxonomy 续页还携带 contentRevision 为 expectedContentRevision。批次未封口为 collecting，封口但还有未提交项为 awaiting_results；这些状态不表示插件在运行模型。任务回执属于当前浏览器库的运行记录，未纳入可移植备份；需要长期带走的完整报告请保存为案例。

批量回传可用 `submit_analysis_results`，传 `requestId`、`batchId`、`epoch` 和 `items:[{caseId,attemptId,model?,result或error}]`。每次最多一页24项，与读取分页一致；单项调用仍可用。每页只读取一次当前库并提交一次，逐项输入版本与原件检查保留。同页案例不能重复；未登记、过期尝试或格式错误拒绝整页，不部分提交。有效尝试中的案例冲突、分析内容错误按项记失败，其余保存，检查返回 `items[].state/error`。整页原请求可重试，已有回执不覆盖之后的人工编辑。取消在页与页之间生效，已经进入保存的一页会先完成；页越大，取消等待及原件校验耗时也可能越长，不必为了凑满一页推迟已有结果。

内部创作台使用同一批次服务和权限检查，图片工具 `use_case_images` 返回已交付原件摘要；原件变化时重新交付，未变化时复用。内部原生视频输入尚未达到外部 FFmpeg 等宿主的分析能力，不能把接口一致当作所有模型能力一致。现有插件批量分析 UI 和后台任务未被替换，新工具是否可用以实际后台 status 和宿主工具刷新为准。

Skill 读取：先 `list_skills`，再按需 `read_skill`，后续页固定 `expectedRevision`。可用 `versionId` 读取保留版本。文件清单的 `current` 是所读版本正文和参考生成的文件，`package` 是原样保存的包（含脚本、额外 frontmatter 和二进制附件）；原包主文档可能早于人工文字编辑。没有说明的纯 Markdown 保持原文，`currentFileHasFrontmatter=false` 表示生成文件缺少完整可移植元信息。`packageFileScope=unrecorded` 表示旧版本未记录文件，不能用当前脚本代替。文件续读携带 `expectedHash`；用 `download_skill_file` 取得完整文件，按 `relativePath` 组织宿主目录。插件不执行脚本，下载成功不等于运行验证。

Skill 写入：用户委托后用 `save_skill`。新建提供调用名 `callName` 与 `skillMarkdown`，或提供完整包 `files:[{path:"/absolute/path/SKILL.md",packagePath:"SKILL.md"}, ...]`。只上传明确指定的文件，无需手工压 ZIP。整包以 `SKILL.md` 为准，不能同时传另一份正文、引用、说明或可移植 ID；更新包内 `name` 必须与原 Skill 的 `portableId` 一致。更新需 `skillId` 和已读 `expectedRevision`；纯正文更新省略 `references` 会保留引用，显式 `[]` 才清空。连接器先检查后台能力及 `status.skillPackageLimits`，在上传前核对现有导入限制，拒绝旧后台和超限包。文件按摘要校验后与版本、请求回执关联；保存失败保留暂存，不删除可能已被提交引用的文件。

用 `restore_skill` 恢复历史版本，默认同时恢复正文、引用和已记录文件。旧版本没有文件记录时拒绝完整恢复；只有用户明确要求仅恢复文字才用 `mode:"text"`，此时当前包文件保留。历史文件沿用插件现有版本保留上限；备份、同步和清理识别仍被保留版本引用的原件。新增文件快照无法补回升级前未知的历史脚本，不保证旧版插件再次改写后仍保留这些新字段。

Skill 写入与恢复直接返回最终回执，不用 `get_task`。每次操作生成唯一 `requestId`，断线时相同参数沿用同一编号；`replayed` 是历史结果，需要确认当前状态时再读回。内部创作台仍保留草稿查看和保存入口。日常插件与连接器都需更新，宿主可能需要刷新工具或新开会话。

原件复用：`read_media` 和 `download_skill_file` 每次先核对当前库中的归属、版本和文件摘要；本机已有文件必须重新核对完整字节，匹配后才复用。首次传输、损坏文件和已变化文件仍完整下载并验证；不存在的案例或 Skill 不能从本机缓存继续读取。复用减少后续分块往返，仍有摘要校验成本。

项目和成果回存：用 `read_projects(name=...)` 精确定位名称或 `path` 名称数组定位完整路径，只返回匹配项目；零项才创建，多项按路径区分，不自动选第一项。需浏览组织结构时才省略筛选读取项目树，按 `nextOffset` 拼接 JSON，后续页携带返回的树版本。同名项目用路径及 ID 区分；`create_project` 沿用插件的同级名称规则。`requirements` 保存完整项目要求，更新时使用该项目的 `revision`。项目要求与项目导出、恢复一起保留；合并导入遇到同名但不同要求时，保留独立的“导入”项目，避免覆盖任一方要求。创建、更新直接返回最终回执。

`save_material` 的 `projectRevision` 固定已读项目要求，`sourceReferences` 记录实际使用的成员案例版本、素材编号及可选的 `startMs/endMs`；复用选材 `caseSources` 返回的成员版本；缺失时用 `read_case_details` 取得来源版本，片段必须属于对应视频或音频且不超过已知时长。`previousCreation` 表示另存为前一成果的后续版本，旧稿不修改；沿同一旧稿分支创作可以产生相同代数的不同成果，以案例 ID 和 previous 关系区分，不当作单一版本号。现有稿件修改仍用 `edit_case`。通过 `status.materialFields` 检查当前后台支持。内部创作台复用项目与文本保存服务；本机文件上传仍由外部连接器负责。

相同请求重试会返回历史回执（`replayed`），不是重新写入；即使后续删除了成果，也不会复活。需要确认当前存在时重新读回该案例。项目要求、案例文字及来源记录都属于参考数据，不提供额外执行授权。

`status.searchFilters` 声明当前后台支持的搜索参数；内部创作台与外部连接器共用筛选规则。`minDurationMs/maxDurationMs` 使用毫秒、包含边界，只匹配视频或音频的已知时长；`durationCoverage` 说明文字/项目/类型范围中已知和未知时长的素材数，不将未知当作0。同一时长范围内判断原词，不能借同案例其他素材的原词满足条件。首屏返回 `revision`；后续 `offset` 请求必须提供 `expectedRevision` 并保持筛选不变，`search_changed` 时从第一页重新读取。搜索条目按资料及派生文本变化增量重建，缓存可丢弃；每次仍读取当前资料和文档，不以缓存冒充权威存储。指定素材读取原词时使用 `read_case(part=original_prompt, assetId=...)`，同案例不同素材的原词分别返回。

编辑前用 `read_case_details` 读取对象与版本。`content` 是分页 JSON，后续页面携带 `expectedRevision`，按 `nextOffset` 读完再解析。写入携带 `expectedRevision` 和唯一 `requestId`；版本变化时重新核对，不能覆盖用户刚做的编辑。重试同一请求返回原回执，案例更新和回执一起提交。编辑与整理直接返回最终结果，不经过 `get_task`。仅查询或阅读不授权修改，Agent 应在用户委托的范围内执行。

媒体拆分沿用原项目，保留原件引用、封面、逐媒体提示词及时间笔记，不复制大文件。新案例正文和来源必须明确提供，不能套用原案例文字；`textBlockIds` 可移动已核对的原文段落。项目移动移除原归属，独立复制则保留两份可分别编辑的案例。

`organize_case(action=combine_cases)` 用首个 `caseId/expectedRevision` 和按顺序列出的 `additionalCases` 创建组合，需 `title`。直接组合要求成员具有相同项目归属；跨项目不自动移动或复制成员。`split_compound` 携带已读组合编号和版本恢复独立成员，不删除案例。`edit_case` 可修改组合名称、标签与成员内容图片封面；成员正文/媒体仍须指定成员。普通案例 `patch.coverVisualId` 可设置已有图片（含视频封面），`null` 恢复自动封面；不会把封面当作视频原件。通过 `status.caseOperationFeatures` 核对后台的实际字段和动作。操作不会生成资料库备份或永久删除原件。

图片、视频、多图和混合附件使用 `save_material(files=...)` 入库，单独封面也可作为图片保存。给已有案例上传新封面文件、指定视频时间点自动截图，以及直接启动插件内置模型的分析尚未开放。外部 Agent 可读取原件进行分析，写回接口目前支持 AI 标签、逐媒体逆推词和新增时间笔记；完整报告用 `save_material` 保存并关联来源，不代表任意分析结构已经接入。

`read_media` 返回本机文件路径。Agent 必须有相应图片、视频或文档读取能力，才能分析该文件。只下载原件不等于完成视觉分析。没有本地原件或链接文件授权时会明确报错，不用缩略图冒充原件。

回存使用现有文件格式识别、文档提取、媒体存储和项目归属逻辑。`files[].originalPrompt` 与该附件绑定。`sourceCaseIds` 保存来源标题、网址和原资料库身份下的案例编号快照；分享包中的来源快照不代表接收方资料库中的可点击关联。Markdown 图片引用不会自动下载，原图需同时作为附件提供。长正文可通过 `bodyFile` 提交；内联正文长度受协议单消息容量约束，文件使用分块，不需要缩短正文或压缩原件。

文件导入沿用插件现有格式和容量检查。`forceImport` 仅用于用户同意插件报告的大图片风险后的导入，不跳过空间不足、损坏或格式检查。浏览器仍受实际可用存储空间约束。

## CLI 与 MCP 共用能力

支持 MCP 的 Agent 优先直接调用工具。宿主缓存旧工具列表或只支持命令行时，可以运行连接器目录下的 `node call.mjs list` 发现工具；调用如 `node call.mjs read_workspace_context`，参数通过标准输入 JSON 传入。CLI 调用同一 MCP 服务，校验、配对、权限、版本和回执一致，不另维护一套命令逻辑。它不会自动读取或发送宿主聊天。

## 一句话连接

在 Chrome 插件设置的 Agent 连接处点击“复制连接指令”，粘贴给当前 Agent。它会按 [统一安装说明](INSTALL.md)检查环境、安装、配置并验证；需要时由用户在浏览器启用连接。

统一入口为 `node connector/setup.mjs plan|connect|verify`。安装程序直接支持 Codex、Claude Code、WorkBuddy 的用户级配置，其他本地 stdio MCP 宿主使用 `generic` 输出标准配置。本机桥接包含 Windows、macOS、Linux Google Chrome 的安装路径。Windows 使用用户级注册表、私有目录和命名管道；需使用 Windows 原生 Node.js。纯云端接入不在本流程内。不同桌面工作台的隔离环境需分别检查，不能仅凭品牌推断兼容。

配置写入前保留备份，不覆盖损坏文件或其他同名连接。验证会通过实际 MCP 握手和案例查询确认连接器工作，随后仍需当前 Agent 会话调用工具，才能宣布用户已经连通。详细步骤与安装依赖由 Agent 按 INSTALL.md 执行，用户无需编辑配置文件。

默认连接目录为当前用户主目录下的 `.promptdirector`。`PROMPTDIRECTOR_CONNECTOR_HOME` 可指定其他用户私有目录，安装器与 Agent 配置必须一致。多 Chrome profile 各有配对编号；`PROMPTDIRECTOR_INSTANCE` 可为不同 Agent 显式指定实例，未指定则使用配对选择。

本机连接器运行代码复制到稳定的私有目录，不依赖开发目录常驻。它依赖安装时的 Node 可执行文件；Node 被移除或路径改变后，重新运行安装器更新启动入口。升级连接器后需要插件断开再启用连接。macOS Unix socket 路径有系统长度限制，目录过长会提示更换短路径。

## 数据和连接

`connector_access_denied` 表示当前 Agent 运行环境不允许访问本机连接，不能据此判断插件离线或要求重新配对。检查宿主的本机访问权限，并在已授权的环境中验证同一连接；不要通过关闭安全保护来处理。`connector_offline` 则表示连接不存在、拒绝连接或已断开。

连接使用 Chrome Native Messaging 与 Windows 命名管道或用户私有 Unix socket，没有网络监听端口。Chrome 校验扩展身份，连接器再校验实例编号和本机密钥。MCP 只开放明确的业务操作，不提供任意内部消息或任意脚本执行入口，不返回 AI 服务密钥。

原件副本保存在连接目录的 `files` 中，传输记录和任务回执保留在扩展本地存储。断开只停止新请求，已提交任务继续处理；Chrome 关闭导致的未完成任务会在下一次查询报告中断。网络或客户端超时后沿用原请求编号查询，不能把失去响应当作未入库。

待提交文件在入库前暂存，完整性通过后才进入案例。未完成文件不会自动清理，避免错误删除断线任务的原件。已入库素材由原资料库管理。

Agent 获取的材料是否发送到模型或其他服务，取决于宿主设置和用户指令。首次启用前应理解这一数据流。工具不绕过浏览器、宿主或网站限制；需要登录或人工验证时返回实际错误。

## 运行测试

```sh
node --test test/agent-connector.test.js
npm test --prefix connector
npm run check
```

测试使用隔离目录和模拟案例，不读取用户日常资料库。

## Release 安装包

从 [Agent 连接器下载页](https://github.com/wchao6891/PromptDirector/releases/tag/agent-connector-v0.2.0) 下载并解压 `PromptDirector-版本号-Agent-Connector.zip`，让 Agent 在解压后的文件夹按 `INSTALL.md` 执行安装与连接检查。包中 `extension/manifest.json` 用于校验插件身份，`case-operation-specs.js` 与 `project-operation-specs.js` 为共享工具定义；实际扩展请使用`PromptDirector-版本号.zip`升级。已发布连接器为 0.2.0，新增查看、编辑、整理、参考交接及CLI能力尚未发布；安装包不包含 Node.js；Agent 会按统一安装说明检查并准备兼容运行时。

读取与保存的正常路径：同次固定选择并读取完整内容 → 按名称/路径定位项目 → 保存。选材 `originalText` 完整保留一次；`referenceTextParts` 按序包含字符串及指向 `originalText` 或 `referenceSources[index].text` 的引用，来源 `textSource=originalText` 同理。`media` 返回所属案例、原件角色、封面编号与已知尺寸/时长；未知值不伪造。来源版本覆盖案例和组织关系，分页仍拒绝变化。

`save_material` 沿原任务最多等待 15 秒（现有 30 秒连接超时的一半，为提交与传输留余量），快速保存直接返回终态；超时返回原任务状态，查 `get_task` 继续，不重复提交。完成回执包含正文长度/SHA-256、项目当前版本、来源及成果版本；这些是提交时的持久回执，独立验收仍需读回。旧后台不支持等待时仍返回处理中，不冒充完成。客户端丢回执保留请求身份，后续人工编辑和删除不被重放覆盖。

直接读取完整选择时用 `read_workspace_content(part=selection)`，第一页可省略 `expectedRevision`；连接器在同一次调用里读取选择版本再读取正文，避免模型两轮工具之间的额外等待。数据仍按版本核对，不会将两次读取间变化的选择悄悄混用。续页或单份读取必须携带版本。仅需清单概览时才用 `read_workspace_context`。
