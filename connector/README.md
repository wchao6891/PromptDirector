# PromptDirector Agent 连接器

提供搜索、读取、保存、编辑及案例整理工具，支持本机 Windows、macOS 和 Linux Google Chrome。连接器和扩展需要同时安装，Chrome 需要保持运行。

安装器提供 Codex、Claude Code、WorkBuddy、OpenCode、ZCode、Qoder 当前桌面版和 DeepSeek Harness 配置适配；千问办公桌面端提供 STDIO 配置导入。豆包工作本机接入仍待验证，不把网络连接器当成本机支持。具体版本、安装入口和验收区别见 [安装说明](INSTALL.md)。配置适配通过不等于每个宿主已完成真实会话验收。

## 当前参考与引用

在案例库使用多选选择参考，选择自动保存；外部Agent直接调用 `read_workspace_content(part=selection)` 读取完整参考，首次第一页可省略版本，续页携带返回的 `revision`。只需概览时使用 `read_workspace_context`。无需进入创作台、导出或发送参考；已有创作台可通过显式页面上下文接续。内部模型API不是外部调用前置。

`resolve_reference` 接受名称链接中的 `#pd-reference=…` 片段，或 `promptdirector://reference?v=1&library=…&case=…&asset=…`，校验身份后再调用现有原文、结构和媒体接口，无需访问链接网页。引用身份不包含密钥；错误库或错误媒体归属明确失败。此接口可用不等于各宿主拖拽已通过，跨应用接收按实际验收记录判断。`show_case` 打开独立详情页面；返回opening后需读页面核对显示结果。

卡片拖出使用案例名称链接，指向整个案例；详情图片及本地视频使用原件名称链接，指向具体素材。有本地原件的图片、视频、文档及其他附件同时携带原件文件拖出数据；视频取原视频，文档取原文档，不把预览封面作为原件。宿主须保留链接或纯文字中的引用才能精确定位；只收到名称时，同名搜索不能证明拖拽身份已传递。插件页面无有效资料库身份时拒绝拖出，普通阅读仍可继续。

富文本名称使用案例来源网页链接，定位身份仅在片段中；无有效网页来源时使用扩展配置的项目主页。点击链接打开来源或项目主页，Agent读取须调用MCP。富文本提供名称链接和不显示的原件载体；有原件时纯文字、URI及DownloadURL沿用原件文件通道，没有原件才使用名称Markdown链接。已授权HTTP(S)网页的接收脚本会在真实拖放时将本插件原件转为完整File，交给网站原有上传入口；不申请新权限、不压缩原件。更新扩展后需刷新接收网页，网站仍须支持File拖放。只接收纯文字且不保留富文本的Agent不能保证获得案例引用。桌面、网页画布和Agent须分别实际接收验收。管理选择/排序状态沿用已有手势，退出后所有案例卡片恢复拖出。

整组创作参考可用 `read_workspace_content(part=selection, expectedRevision=...)` 分页读取，避免每条独立往返；`status.workspaceContentParts` 用于探测后台支持。`selectedCaseCount` 表示选中的案例数，`total` 表示逐素材展开后的参考数。已进入管理的多个案例库页面会同步选中状态，普通浏览和其他任务选择不被切换。失效案例或文档通过 `issues` 及 `completeness=partial` 声明，其余参考仍可读取；`availableCaseCount` 表示可用案例数，读取不会清空失效选择。清单包含来源、组合成员编号及原词字符数；完整案例结构仍按需通过 `read_case_details` 获取。

## 实时协作与审片

`read_live_workspace` 读取一个案例库页面的当前现场，多个页面须按返回的 `contexts` 指定 `tabId`。快照包含搜索/筛选/排序、具体素材、文字选区、未保存编辑、创作备注草稿及已保存反馈、实际播放状态、审片区间与临时样片身份；保存资料变化以 `libraryRevision` 提示，完整资料继续通过案例读取工具取得。首次连接和重连读取快照；现场revision/controlRevision不能作为案例修改版本，案例首次读取省略expectedRevision，再用案例读取返回的revision续读/编辑；随后用 `wait_workspace_changes(tabId, afterRevision, waitMs)` 取得有序变化，最长等待15秒。`reset=true` 时从返回的新快照接续，不拼接过期事件。

`control_workspace` 在同一页面定位案例/素材、设置参考选择、播放/暂停/定位/循环、切换审片。把现场的 `controlRevision` 放入 `expectedRevision`，并提供唯一 `requestId`；变化流继续用 `revision` 接续；人工操作后过期命令拒绝，未保存编辑不能被自动丢弃。搜索候选在Agent对话展示，页面操作复用现有交互，不增加额外候选布局。开启区间循环会直接播放；open_temporary明确换片时可替换当前临时样片，close_temporary关闭。未保存案例编辑仍需处理。换动作、文件或版本必须使用新requestId，同参数重试才沿用原编号。回执区分实际执行与失败，`foreground` 表示页面是否处于前台；`state=executed` 与 `snapshot` 表示动作完成和执行后业务状态，不宣称视觉布局已验收；正常调用复用回执快照，人工继续操作后才重读。保留的请求可重放回执；自动历史过期只拒绝旧命令，不重复执行，也不限制继续审片。

详情顶部“审片”收起正文与推荐，复用当前媒体；退出恢复原布局。本地播放器支持定位和区间，来源嵌入播放器无法控制时明确说明，不能冒称帧级精确。临时样片可由Agent传入，也可从“添加 → 审阅本机样片”导入；Logo旁不常驻入口。Agent用 `control_workspace(action=open_temporary, file={path,mimeType})` 传入明确指定的文件，无需先入库；无反馈的临时上传沿既有生命周期整理；已保存反馈关联的原件与附帧保留，不能按闲置传输丢弃。用现场 `temporary.id` 调用 `read_review_media`，连接器完整读取、核对 SHA-256 并返回本机文件路径。换样片或关闭后旧身份失效。当前原件读取入口由现场mediaRead给出；temporary=null时应使用read_media读取库内案例，不能猜临时编号。点击临时审片的“保存入库”图标，将当前原件、已保存反馈及附帧一起保存到当前项目；Agent在用户委托保存时也可用control_workspace(action=save_temporary,temporaryId=当前临时编号)。保存沿同一原件/版本/回执服务，成功后显示已保存，重复点击/重试不会新增副本。

当前实时协作覆盖案例库页面；创作台完整参考继续沿已有 `read_workspace_content(source=page)`。接口提供快照和等待变化，未声明 MCP 资源订阅或任意宿主空闲时自动唤起模型。`status.workspaceSyncVersion=6` 表示后台已加载；保存未完成编辑后重载扩展并刷新页面，宿主再刷新工具。

视频详情与临时审片共用一条播放时间线，入点、出点与选中区间直接显示在这条线上；审片时不切换案例。创作备注、独立截图、清除入出点与入点/出点/循环在同一行。备注默认当前播放时间，完整区间可用区间图标明确选用；清除入出点同时关闭循环。备注窗口可拖动，默认避开上下工具栏；保存旁的刷新时间按钮重取实际播放位置，保留已写内容并退出区间记录。截图点击即独立保存，无需备注，临时截图可通过查看截图图标打开浮层删除，不另占底部一行；本机样片支持一次选择多张图片/多个视频，整组保存为一个混合案例，各项反馈和截图分别关联。打开备注后输入反馈并保存；Enter默认保存，Shift+Enter换行。已有creative字段内容保留可读，独立五字段编辑面板已移除；媒体切换固定居中，与其他动作在同一行，窄屏动作区横向滚动，不自动加行；审片隐藏缩略图，普通详情保留。暂停/定格无中央播放遮挡。侧栏详情为信息面板，隐藏媒体与相似推荐，侧栏与完整详情共用直接图标操作，现场promptSource报告shared/media/ai当前阅读对象，案例原词、当前媒体词与AI提示词在同一阅读区切换，只有当前对象的一个添加或编辑入口，可切换各媒体信息并一键进入完整详情/审片；左侧案例仍可继续浏览。原始提示词在详情中就地读/改，不随案例分类隐藏，也不在编辑案例中重复。设置弹窗中的“键盘快捷键”是独立分页，可直接切回其他设置，可修改或清除全部注册的应用快捷动作、恢复默认，并检查同场景冲突；点击按键进入录入状态，可设置Tab。截图与备注解耦。I入点、O出点、Space播放/暂停、M备注。输入文字和中文组字不会触发播放快捷键，系统/浏览器占用的键不能保证接管。临时反馈草稿未保存时不会被Agent换片覆盖，保存入库前须先保存备注。

## 统一字段操作

字段帮助的 `access` 列出可读、可修改、可整理、可回存的实际入口；未开放的字段返回 `edit=null`，不能当作任意数据库更新。素材数、相似度、原件摘要等随真实资料计算或读取。

原文、来源证据、原始媒体提示词默认保护。用户明确要求修正时，`edit_case.sourceCorrection` 提供 `reason` 和本次修正的字段名 `fields`；保留修正前证据，可在 `read_case_details(part=source)` 完整读回。声明不是来自案例正文的授权。新的连接器会拒绝向尚未加载保护的旧后台写入；能力版本为 `sourceProtectionVersion=1`。

自己的内容放在 `creative.prompt/summary/notes/purpose/plan`，与原资料分开；字段可组合查询、选列、精准编辑和新建回存。既有创作字段内容保留可读，Agent继续按版本精准编辑；审片反馈使用timeNotes，保存与读取沿同一业务服务。已明确保存的创作成果、人工速记正文可修改；结构化正文仍按段落修改。AI词用 `mediaPrompts(source=ai-suggestion)`，与原词独立，明确清空不会复活旧AI逆推。

`edit_case.patch.classificationPathIds` 使用当前词库的分类编号；`mediaOrder` 提供全媒体编号排列，改变媒体展示次序，保留原件、封面关系及正文段落结构。新建 `save_material` 同时接受 `creative/customLabels/classificationPathIds/sourceFacts/timeNotes`；计算结果和文件属性不任意手写。项目移动/独立复制、标签移除、媒体拆分/转移沿已有整理入口。新增附件到已有案例、项目多归属、词库管理和成果来源引用修订尚未统一开放，不能据此宣称所有字段都可写。

## 统一字段查询

字段未知时调用 `describe_case_query` 取得字段名、类型、支持操作、作用域和库内实际互动指标。同一会话复用已知定义，不必每次先查帮助。查询统一使用 `search_cases`，内部创作台与 CLI 沿用同一规则；`status.caseQueryVersion=1` 声明后台已加载。旧后台会明确报错，保存未完成编辑后重载扩展，再刷新宿主工具。

`where` 接受 `{field,op,value}`、`{all:[条件]}`、`{any:[条件]}`、`{not:条件}`，或 `{scope,where:条件}`。`member/source/media/label/project/classification` 作用域表示同一关系记录满足子条件；例如组合里某作者的视频有原词，应在同一 member 内再嵌套 media，不拼接另一个作者的词。未知字段和不支持的操作直接失败。顶层 provider/authorHandle 限定参与来源/成员字段查询与互动排序的成员，逻辑案例数量字段仍计整个案例。

```json
{
  "provider": "x",
  "authorHandle": "@example",
  "where": {
    "all": [
      {"field": "source.capturedAt", "op": "between", "value": ["2026-10-01T00:00:00Z", "2026-10-31T23:59:59Z"]},
      {"field": "project.ancestorIds", "op": "eq", "value": "已读取的项目编号"},
      {"field": "prompt.original", "op": "exists", "value": true},
      {"field": "mediaCount", "op": "gte", "value": 3}
    ]
  },
  "orderBy": [{"field": "source.engagement.bookmarks", "direction": "desc", "reduce": "max"}],
  "select": ["title", "source.url", "mediaCount"]
}
```

作者、项目、日期、数量和互动指标由任务与字段发现结果传入，示例不是产品默认规则。`select` 只返回指定字段及 caseId，多值字段返回数组，完整文字不截成摘要；大文字单条超过消息预算时明确报错，改用 `read_case` 同文版本分页。默认仍是简短候选，未查看图片不声称识别画面。

`orderBy` 在全部匹配后排序，支持多个字段，缺失永远排末，caseId打破平局；多值字段必须指定 min/max，互动排序及数值统计须顶层 provider 限定平台，不自动相加多个帖子。条件里的0是已知值，缺失用 exists=false；ne不把缺失当作不等于0。

`groupBy` 返回 groups/groupTotal；同一来源、素材、标签、项目或分类的多个字段按同一关系记录分组，每组同一案例只计一次，同域统计也只使用该组的关系记录。`aggregates` 支持 count（不传field）、known/missing、数值 sum/avg/min/max；缺失不补0，数值统计同时给 known/missing。统计针对全匹配集，与本页数量无关；分组排序用 orderBy 的分组字段、group.count 或 aggregate.统计名称（单值不使用reduce），不能与案例select/旧sort混用；组与案例都用 offset/limit/revision 续读，后续页须携带 expectedRevision 并保持查询参数。

`similarTo:{"caseId":"已知参考编号"}` 默认按完整提示词比较。指定 `mediaKind:"video"` 时只比较视频提示词，含图片和视频的参考也能找到纯视频案例；不指定类型时沿参考的媒体域比较。逐素材优先原词，缺失时用已保存的 AI 词并标明来源。默认候选的 `excerpt` 返回提示词预览，`similarity.promptEvidence` 标明来源和完整字符数，覆盖信息附参考的 `referencePrompt`（sources、excerpt、excerptOnly、characters）；摘要沿用现有候选的240字符预览预算，排名仍使用全文，需全文时正常读取。省略 select 可保留媒体、来源、摘要与匹配依据。

分数衡量库内文字重合，不是画面相似概率，也不理解用户本次最在意的创作维度。比如同一部片的两种转场可能因片名和班底文字相同而高分；候选的具体技法与任务不符时不能仅凭分数推荐。Agent先理解用户目标，用已有参考和候选摘要判断相同点/关键差异。明确的内容限制可将 `query`/`alternatives` 或 `where` 与 `similarTo` 合并在一次搜索中；例如找同类无缝转场可结合 `query:"seamless transition"`，需要更广探索时不强制标签全部一致。无需添加固定多轮视觉检查；现有文字不足才补读。

Agent 根据任务需要与候选质量选择 limit、判断是否继续；证据足够即交付，不固定调用次数或要求读完分页。只对缺提示词的候选按需补查，`hasPrompt:false` 可限定补查范围（含原词或已存AI词即为true，受mediaKind/来源/时长条件约束）；提示词足够时不默认读封面和视频，用户要求视觉核验除外。0分表示没有已知词语重合，不能为凑数当作相似。当前是本地词语相似度，不保证跨语言语义匹配；必要的关键词变体可一次放入 alternatives。

显式 `method:"local"` 保留插件既有探索规则；palette/tags 与 local 仍在相同完整媒体域中比较，插件内推荐算法不变。返回理由、fallback、分项数值及 similarityCoverage，缺失为null，0为已知不相似；覆盖数量是当前库比较域，其他查询条件还会进一步筛选。未读取原件不代表视觉识别。颜色精确值使用 palette.colors，色彩相似使用 palette 方法。

## 工具

| 工具后缀 | 功能 |
|---|---|
| `status` | 配对资料库的实时连接状态和能力 |
| `read_workspace_context` | 当前已选参考的顺序、版本、素材清单；也可显式读取页面现场 |
| `read_workspace_content` | 同一版本下完整读取整组或单份创作参考，长内容分页 |
| `resolve_reference` | 校验PD资料库、案例及素材身份，取得读取入口 |
| `read_live_workspace` | 读取当前案例库业务现场与版本 |
| `wait_workspace_changes` | 等待并读取有序变化，过期明确重置 |
| `control_workspace` | 在同一页面可见定位、选择和审片控制 |
| `read_review_media` | 读取未入库临时样片原件并核对摘要 |
| `show_case` | 打开案例详情，随后读取页面核对是否实际显示 |
| `describe_case_query` | 发现共享查询字段、库内实际互动指标，以及类型、关系与缺失语义 |
| `search_cases` | 全文或字段组合条件、选列、多字段排序、分组统计、指定参考相似检索和稳定分页 |
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
| `submit_analysis_result` | 按固定案例版本和原件摘要写回标签、提示词、时间笔记及完整图/视频/多图分析 |
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

完整名称有 `promptdirector_` 前缀。创作由 Agent 完成，这些工具不额外调用模型。目前不包含删除或全库自动分析。工具是否可用以当前连接器的工具列表及插件 `status` 回执为准；新增编辑能力需要同时更新两端。

原件下载根据 Chrome 原生消息的传输方向和当前工作内存分块，保留完整文件和摘要校验。回存相同的本机图片、视频或音频时，扩展可复用经实际字节校验的库内原件，避免重复上传和存储；有变化的文件仍走正常上传。同次附件即使内容相同，也保留不同逐文件提示词所需的身份。更新后须重载扩展并重新连接 Agent 的 MCP 服务，已启动的服务仍可能使用旧代码。

外部批量分析：分析由宿主完成，插件接收结果。先读案例版本、实际需要的原件；用 `manage_analysis_batch(action:"create")` 登记 `instruction` 与 `items:[{caseId,expectedRevision,assets:[]}]`，返回的 `batchId` 就是创建请求编号。文字分析 `assets=[]`；视觉分析逐项提供 `{assetId,sha256,coverage}`，摘要来自 `read_media`，coverage 如实写全片、抽帧或具体范围。大清单可用 `add` 分批登记，结束用 `seal`；同一批次每个案例登记一次，多个素材放该案例的 assets。

`read_analysis_batch` 给出每项 `attemptId`、输入版本和批次 `epoch`。宿主完成一项后用 `submit_analysis_result` 提交 `result` 或 `error`，二者互斥。result 接收 `tags:[{g,t?}]`、`mediaPrompts:[{assetId,text}]`、`timeNotes:[{assetId,startMs,endMs?,text}]`，以及以下与插件共用的完整结果：

- `imageAnalyses:[{assetId,reconstructionPrompt,tags}]`：逐图逆推和1–6条标签，不伪造描述、坐标或十维结构。
- `videoAnalyses:[{assetId,reconstructionPrompt,tags,uncertainties,analysisScope}]`：完整视频逆推、4–8条视觉标签及不确定项；`analysisScope` 为 `visual`（画面）或 `video`（音画），实际抽帧/时间范围仍以登记 `coverage` 为准。保存记录的 `finishReason=external_result` 表示宿主提交结果，并非插件发起的模型请求完成原因。
- `visualSetAnalyses:[{assetIds,imageRoles,sharedVisualSystem,differences,continuity,compositionRules,reusablePrompt}]`：多图关系与创作总结；每张图必须已有与当前原件一致的有效独立分析，`imageRoles` 恰好覆盖指定素材，可在同项先保存逐图再总结。

同一素材不能同时提交 `mediaPrompts` 和完整图/视频逆推。标签 g 从 `part:"taxonomy"` 读取，异常、重复、过长或超限标签整项拒绝，不静默删减。图片提示词和时间笔记必须在登记素材内；标签追加且保留人工关系，提示词只写 AI 来源，时间笔记只新增。已有不同 AI 提示词或人工修改的逆推结果需单独核对后走 `edit_case`，不会被批量替换。完整自由格式分析报告用 `save_material` 保存并关联来源，本接口不接受任意底层字段。

完整图片结果在 `read_case_details(part:"media")` 读取，视频和整组在 `part:"annotations"` 读取；`inputEvidence` 保留输入案例版本、原件摘要、查看范围和尝试身份。`part:"analysis_coverage"` 列逐媒体已存分析和未知范围；缺失范围为 `null`，不能推断全片。`verification:"verified_at_save"` 只说明保存时核验，`currentBytesVerified:false` 明确本次元数据读取没有重新校验原件。该清单不是全库画面搜索索引。拆分/转移整组媒体时完整报告随素材保留；只拆部分时源报告保留为失效历史，不给子集冒充完整组分析。备份/分享保留结构和来源范围，导入媒体编号冲突时同步调整分析引用。`status.analysisResultVersion=2` 和 `analysisResultFields` 声明当前后台能力；源码/runtime更新后，Chrome重载及宿主工具重新发现分别核对。

结果提交返回的是单项最终回执；`ok:true` 表示已记录回执，必须检查 `item.state` 是否 `saved`。失败项携带具体原因，`partial` 不能报告全批成功。案例、关系、原件发生变化时整项失败，不写旧结果。元数据、案例修改和回执一次提交；相同请求同参数重试不会重复添加标签或笔记。

取消用 `manage_analysis_batch(action:"cancel",epoch:...)`，普通进度变化不会阻止取消。成功项保留，后续旧 epoch 结果拒绝。它只停止插件接收，宿主必须自行停止模型或脚本请求。`resume` 只恢复接收，不自动分析；重新核对当前 epoch 后处理未完成项，不能把旧结果换个编号直接提交。失败项用 `retry` 并提供重新核对的单项输入，取得新 attemptId 后重做；旧尝试及失败结果仍可读。除了 create/cancel，管理操作需带最新 expectedRevision。所有写操作都有唯一 requestId。

忘记批次编号或重连后，先 `list_analysis_batches` 按 `query`（要求或编号）/`status` 找回，再 `read_analysis_batch` 核对。列表只取任务摘要，不载入案例和结果正文；`instructionExcerpt` 沿用搜索摘要的240字符长度，`instructionTruncated` 表示需从批次读取完整要求。列表按最近更新排序，每页24项；后续携带 `revision` 为 `expectedRevision` 并保持筛选，变化后重读第一页。仅列当前资料库的外部批次，不包括内部模型任务。续查无需 `get_task`。items 为紧凑分页，结果可用 `part:"result",caseId:...` 按 nextOffset 读取完整 JSON，后续页携带 expectedRevision；taxonomy 续页还携带 contentRevision 为 expectedContentRevision。批次未封口为 collecting，封口但还有未提交项为 awaiting_results；这些状态不表示插件在运行模型。任务回执属于当前浏览器库的运行记录，未纳入可移植备份；需要长期带走的完整报告请保存为案例。

批量回传可用 `submit_analysis_results`，传 `requestId`、`batchId`、`epoch` 和 `items:[{caseId,attemptId,model?,result或error}]`。每次最多一页24项，与读取分页一致；单项调用仍可用。每页只读取一次当前库并提交一次，逐项输入版本与原件检查保留。同页案例不能重复；未登记、过期尝试或格式错误拒绝整页，不部分提交。有效尝试中的案例冲突、分析内容错误按项记失败，其余保存，检查返回 `items[].state/error`。整页原请求可重试，已有回执不覆盖之后的人工编辑。取消在页与页之间生效，已经进入保存的一页会先完成；页越大，取消等待及原件校验耗时也可能越长，不必为了凑满一页推迟已有结果。

内部创作台使用同一批次服务和权限检查，图片工具 `use_case_images` 返回已交付原件摘要；原件变化时重新交付，未变化时复用。内部原生视频输入尚未达到外部 FFmpeg 等宿主的分析能力，不能把接口一致当作所有模型能力一致。现有插件批量分析 UI 和后台任务未被替换，新工具是否可用以实际后台 status 和宿主工具刷新为准。

Skill 读取：先 `list_skills`，再按需 `read_skill`，后续页固定 `expectedRevision`。可用 `versionId` 读取保留版本。文件清单的 `current` 是所读版本正文和参考生成的文件，`package` 是原样保存的包（含脚本、额外 frontmatter 和二进制附件）；原包主文档可能早于人工文字编辑。没有说明的纯 Markdown 保持原文，`currentFileHasFrontmatter=false` 表示生成文件缺少完整可移植元信息。`packageFileScope=unrecorded` 表示旧版本未记录文件，不能用当前脚本代替。文件续读携带 `expectedHash`；用 `download_skill_file` 取得完整文件，按 `relativePath` 组织宿主目录。插件不执行脚本，下载成功不等于运行验证。

Skill 写入：用户委托后用 `save_skill`。新建提供调用名 `callName` 与 `skillMarkdown`，或提供完整包 `files:[{path:"/absolute/path/SKILL.md",packagePath:"SKILL.md"}, ...]`。只上传明确指定的文件，无需手工压 ZIP。整包以 `SKILL.md` 为准，不能同时传另一份正文、引用、说明或可移植 ID；更新包内 `name` 必须与原 Skill 的 `portableId` 一致。更新需 `skillId` 和已读 `expectedRevision`；纯正文更新省略 `references` 会保留引用，显式 `[]` 才清空。连接器先检查后台能力及 `status.skillPackageLimits`，在上传前核对实际声明的边界，拒绝不具备完整包能力的旧后台；当前不设文件数或包大小配额。文件按摘要校验后与版本、请求回执关联；保存失败保留暂存，不删除可能已被提交引用的文件。

两种保存方式分别如下；`requestId` 每次新操作生成，更新时另加 `skillId/expectedRevision`。文件包模式不再附带内联正文或引用。

```json
{"requestId":"new-inline-request","callName":"运镜方法","skillMarkdown":"# 运镜方法\n完整正文","references":[{"path":"references/source.md","markdown":"完整来源文字","runtime":false}]}
```

```json
{"requestId":"new-package-request","files":[{"path":"/absolute/path/SKILL.md","packagePath":"SKILL.md"},{"path":"/absolute/path/source.md","packagePath":"references/source.md"},{"path":"/absolute/path/frames.py","packagePath":"scripts/frames.py"}]}
```

`runtime:true` 的引用会进入插件内应用 Skill 时的参考快照和模型上下文；`false` 仍完整保存、可按需读取。按引用是否需要常驻模型上下文选择，不因文字较长自动改写。包内引用沿用现有导入规则。

`status.skillPackageLimits` 的 `quotaPolicy` 说明产品没有固定包配额；保留的 `maxFileCount/maxFileBytes/maxArchiveBytes` 数值中的 `MAX_SAFE_INTEGER` 是安全整数表达边界，不能解释为所有调用均无限。`maxTextBytes` 是当前正文及 Markdown 引用的解析预算，连接器在上传前核对，后台仍做最终检查。文件分块长度与包总量是不同边界。内联请求的完整 UTF-8 JSON 信封受本机程序向 Chrome 方向的 1 MiB 消息上限约束；文件走分块，超过单消息时使用文件路径，不压缩或删减原文。[Chrome 原生消息协议](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-protocol)。

用 `restore_skill` 恢复历史版本，默认同时恢复正文、引用和已记录文件。旧版本没有文件记录时拒绝完整恢复；只有用户明确要求仅恢复文字才用 `mode:"text"`，此时当前包文件保留。历史文件沿用插件现有版本保留上限；备份、同步和清理识别仍被保留版本引用的原件。新增文件快照无法补回升级前未知的历史脚本，不保证旧版插件再次改写后仍保留这些新字段。

Skill 写入与恢复直接返回最终回执，不用 `get_task`。每次操作生成唯一 `requestId`，断线时相同参数沿用同一编号；`replayed` 是历史结果，需要确认当前状态时再读回。内部创作台仍保留草稿查看和保存入口。日常插件与连接器都需更新，宿主可能需要刷新工具或新开会话。

原件复用：`read_media` 和 `download_skill_file` 每次先核对当前库中的归属、版本和文件摘要；本机已有文件必须重新核对完整字节，匹配后才复用。首次传输、损坏文件和已变化文件仍完整下载并验证；不存在的案例或 Skill 不能从本机缓存继续读取。复用减少后续分块往返，仍有摘要校验成本。

项目和成果回存：用 `read_projects(name=...)` 精确定位名称或 `path` 名称数组定位完整路径，只返回匹配项目；零项才创建，多项按路径区分，不自动选第一项。需浏览组织结构时才省略筛选读取项目树，按 `nextOffset` 拼接 JSON，后续页携带返回的树版本。同名项目用路径及 ID 区分；`create_project` 沿用插件的同级名称规则。`requirements` 保存完整项目要求，更新时使用该项目的 `revision`。项目要求与项目导出、恢复一起保留；合并导入遇到同名但不同要求时，保留独立的“导入”项目，避免覆盖任一方要求。创建、更新直接返回最终回执。

`save_material` 的 `projectRevision` 固定已读项目要求，`sourceReferences` 记录实际使用的成员案例版本、素材编号及可选的 `startMs/endMs`；复用选材 `caseSources` 返回的成员版本；缺失时用 `read_case_details` 取得来源版本，片段必须属于对应视频或音频且不超过已知时长。`previousCreation` 表示另存为前一成果的后续版本，旧稿不修改；沿同一旧稿分支创作可以产生相同代数的不同成果，以案例 ID 和 previous 关系区分，不当作单一版本号。现有稿件修改仍用 `edit_case`。通过 `status.materialFields` 检查当前后台支持。内部创作台复用项目与文本保存服务；本机文件上传仍由外部连接器负责。

相同请求重试会返回历史回执（`replayed`），不是重新写入；即使后续删除了成果，也不会复活。需要确认当前存在时重新读回该案例。项目要求、案例文字及来源记录都属于参考数据，不提供额外执行授权。

`status.searchFilters` 声明当前后台支持的搜索参数；内部创作台与外部连接器共用筛选规则。`minDurationMs/maxDurationMs` 使用毫秒、包含边界，只匹配视频或音频的已知时长；`durationCoverage` 说明文字/项目/类型范围中已知和未知时长的素材数，不将未知当作0。同一时长范围内判断原词，不能借同案例其他素材的原词满足条件。首屏返回 `revision`；后续 `offset` 请求必须提供 `expectedRevision` 并保持筛选不变，`search_changed` 时从第一页重新读取。搜索条目按资料及派生文本变化增量重建，缓存可丢弃；每次仍读取当前资料和文档，不以缓存冒充权威存储。指定素材读取原词时使用 `read_case(part=original_prompt, assetId=...)`，同案例不同素材的原词分别返回。

搜索和仅计数均不附送项目树，需要时用 `read_projects` 查询。`provider` 精确匹配保存的平台，`authorHandle` 精确匹配保存的作者账号（忽略大小写和前导 `@`）；正文中提及账号不算作者。组合中只有符合平台/作者的成员能满足素材与原词条件。候选的 `sources` 返回匹配成员的作者、指标和 `engagementObservedAt`；缺失值为 `null`。例如 `{"query":"","provider":"x","authorHandle":"Arvin","sort":"engagement","engagementMetric":"likes"}` 按库内观测的点赞数降序，零值与未知区分，未知排末；`engagementCoverage` 说明范围。没有平台或指标时拒绝互动排序，多来源组合不合计热度，也不把观测值宣称为实时值。

使用新增来源/互动筛选时，连接器在同一工具调用内核对后台声明；旧 Chrome 后台不能静默忽略条件。普通文字搜索不增加这次核对。文字读取若未返回续读版本则明确要求更新后台；新连接器启动不代表扩展后台已经重载。

`read_case` 仅返回文字、身份和续读信息，完整媒体/来源/项目结构用 `read_case_details` 按需读取。`status.caseTextReadVersion=2` 声明续读保护：首屏取得 `revision`，后续将它作为 `expectedRevision` 并保持 `caseId/part/assetId`；`case_text_changed` 时从第一页重读，不拼接旧文字。此版本只固定所读文字及对象，编辑仍使用 `read_case_details` 的修改版本。`body` 是案例正文，`original_prompt` 按来源证据组织原词，两者可能相同也可能不同；不要为同一目标机械地重复读取全部部分。

编辑前用 `read_case_details` 读取对象与版本。`content` 是分页 JSON，后续页面携带 `expectedRevision`，按 `nextOffset` 读完再解析。写入携带 `expectedRevision` 和唯一 `requestId`；版本变化时重新核对，不能覆盖用户刚做的编辑。重试同一请求返回原回执，案例更新和回执一起提交。编辑与整理直接返回最终结果，不经过 `get_task`。仅查询或阅读不授权修改，Agent 应在用户委托的范围内执行。

媒体拆分沿用原项目，保留原件引用、封面、逐媒体提示词及时间笔记，不复制大文件。新案例正文和来源必须明确提供，不能套用原案例文字；`textBlockIds` 可移动已核对的原文段落。项目移动移除原归属，独立复制则保留两份可分别编辑的案例。

`organize_case(action=combine_cases)` 用首个 `caseId/expectedRevision` 和按顺序列出的 `additionalCases` 创建组合，需 `title`。直接组合要求成员具有相同项目归属；跨项目不自动移动或复制成员。`split_compound` 携带已读组合编号和版本恢复独立成员，不删除案例。`edit_case` 可修改组合名称、标签与成员内容图片封面；成员正文/媒体仍须指定成员。普通案例 `patch.coverVisualId` 可设置已有图片（含视频封面），`null` 恢复自动封面；不会把封面当作视频原件。通过 `status.caseOperationFeatures` 核对后台的实际字段和动作。操作不会生成资料库备份或永久删除原件。

图片、视频、多图和混合附件使用 `save_material(files=...)` 入库，单独封面也可作为图片保存。给已有案例上传新封面文件、指定视频时间点自动截图，以及直接启动插件内置模型的分析尚未开放。外部 Agent 读取原件后，可按上述批次接口写回完整图片、视频和多图关系分析；自由格式报告用 `save_material` 保存并关联来源。

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

本机连接器运行代码复制到稳定的私有目录，不依赖开发目录常驻。安装时优先选择已存在、可执行且解析到当前同一 Node 的启动路径（包括符号链接），避免记录已解析的版本目录；找不到时保留当前可执行路径，不换用 PATH 中的另一版本。Node 被移除、启动链接失效或路径改变后，重新运行安装器更新入口。升级连接器后需要插件断开再启用连接。macOS Unix socket 路径有系统长度限制，目录过长会提示更换短路径。`verify` 离线诊断只核对连接器自有文件，不据此推断浏览器或扩展开关状态。

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

从 [Agent 连接器下载页](https://github.com/wchao6891/PromptDirector/releases/tag/agent-connector-v0.3.0) 下载并解压 `PromptDirector-版本号-Agent-Connector.zip`，让 Agent 在解压后的文件夹按 `INSTALL.md` 执行安装与连接检查。包中 `extension/manifest.json` 用于校验插件身份，`case-operation-specs.js` 与 `project-operation-specs.js` 为共享工具定义；实际扩展请使用`PromptDirector-版本号.zip`升级。连接器 0.3.0 支持查看、编辑、整理、参考交接及CLI；安装包不包含 Node.js；Agent 会按统一安装说明检查并准备兼容运行时。

读取与保存的正常路径：同次固定选择并读取完整内容 → 按名称/路径定位项目 → 保存。选材 `originalText` 完整保留一次；`referenceTextParts` 按序包含字符串及指向 `originalText` 或 `referenceSources[index].text` 的引用，来源 `textSource=originalText` 同理。`media` 返回所属案例、原件角色、封面编号与已知尺寸/时长；未知值不伪造。来源版本覆盖案例和组织关系，分页仍拒绝变化。

`save_material` 沿原任务最多等待 15 秒（现有 30 秒连接超时的一半，为提交与传输留余量），快速保存直接返回终态；超时返回原任务状态，查 `get_task` 继续，不重复提交。完成回执包含正文长度/SHA-256、项目当前版本、来源及成果版本；这些是提交时的持久回执，独立验收仍需读回。旧后台不支持等待时仍返回处理中，不冒充完成。客户端丢回执保留请求身份，后续人工编辑和删除不被重放覆盖。

直接读取完整选择时用 `read_workspace_content(part=selection)`，第一页可省略 `expectedRevision`；连接器在同一次调用里读取选择版本再读取正文，避免模型两轮工具之间的额外等待。数据仍按版本核对，不会将两次读取间变化的选择悄悄混用。续页或单份读取必须携带版本。仅需清单概览时才用 `read_workspace_context`。

`organize_case(action=remove_tags)` 接收 `customLabels`（人工标签名称）和 `nodeIds`（分类标签编号），至少指定一项。对组合操作时包含成员，只移除所选案例的关系，保留词库、原件和分析。仍需已读取的 `expectedRevision` 与唯一 `requestId`；返回 `updatedCount` 和 `canUndoFacetUpdate`，可在插件“分类与标签 → 标签导航 → 撤回与恢复”撤回。

## 日常对话与按需读取

连接握手提供简短交付与调用指引，工具提供可读标题，成功结果数据标注为供助手使用；宿主是否折叠工具详情由宿主决定。默认不逐步播报工具、编号或内部参数；失败与必要决策仍需说明，完整提示词、原文和创作内容不缩短。用户明确要求诊断时才展开证据。

`read_case_details` 同时需要多个部分时可传 `parts:["overview","source","media"]`，返回一个共同revision和分页JSON对象。与单部分`part`互斥；续页保持parts与expectedRevision，完整拼接后再解析。服务在一次资料读取中构造所需部分，不重复读取整库或计算未请求的分析覆盖。只读一个部分时继续用part。找当前案例新截图优先更新media，按derivedFromAssetId/frameTimeMs/capturedAt定位，再read_media；不扫描本机目录。
