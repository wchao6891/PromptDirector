# PromptDirector Agent 连接器

提供搜索、读取、保存、编辑及案例整理工具，支持本机 Windows、macOS 和 Linux Google Chrome。连接器和扩展需要同时安装，Chrome 需要保持运行。

## 当前参考与引用

在案例库使用多选选择参考，选择自动保存；外部Agent调用 `read_workspace_context` 即可读取，无需进入创作台、导出或发送参考。按 `revision` 分页读取 `read_workspace_content`；已有创作台可通过显式页面上下文接续。内部模型API不是外部调用前置。

`resolve_reference` 校验 `promptdirector://reference?v=1&library=…&case=…&asset=…`，再调用现有原文、结构和媒体接口。引用身份不包含密钥；错误库或错误媒体归属明确失败。此接口可用不等于各宿主拖拽已通过，跨应用接收按实际验收记录判断。`show_case` 打开独立详情页面；返回opening后需读页面核对显示结果。

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
| `capture_url` | 插件打开独立 Chrome 标签并调用现有采集流程 |
| `save_material` | 正文、附件和创作结果入库，保留精确来源与前一成果版本 |
| `read_projects` | 分页读取项目树、完整要求与项目版本 |
| `create_project` | 建立项目或子项目，保存要求，重复请求不重复建立 |
| `update_project` | 按已读版本修改项目名称和要求，不覆盖新编辑 |
| `get_task` | 查询持久任务回执，区分处理中、成功、部分成功、失败和中断 |
| `read_case_details` | 分页读取案例完整来源、媒体元数据、正文结构、标注及项目关系，返回修改版本 |
| `edit_case` | 按字段编辑标题、正文段落、来源、标签、逐媒体提示词和时间笔记 |
| `organize_case` | 选定媒体拆为新案例、转移到另一案例、移动或独立复制到已有项目 |

完整名称有 `promptdirector_` 前缀。创作由 Agent 完成，这些工具不额外调用模型。目前不包含删除、批量管理或全库自动分析。工具是否可用以当前连接器的工具列表及插件 `status` 回执为准；新增编辑能力需要同时更新两端。

项目和成果回存：先用 `read_projects` 读取项目树，按 `nextOffset` 拼接 JSON，后续页携带返回的树版本。同名项目用路径及 ID 区分；`create_project` 沿用插件的同级名称规则。`requirements` 保存完整项目要求，更新时使用该项目的 `revision`。项目要求与项目导出、恢复一起保留；合并导入遇到同名但不同要求时，保留独立的“导入”项目，避免覆盖任一方要求。创建、更新直接返回最终回执。

`save_material` 的 `projectRevision` 固定已读项目要求，`sourceReferences` 记录实际使用的成员案例版本、素材编号及可选的 `startMs/endMs`；用 `read_case_details` 取得来源版本，片段必须属于对应视频或音频且不超过已知时长。`previousCreation` 表示另存为前一成果的后续版本，旧稿不修改；沿同一旧稿分支创作可以产生相同代数的不同成果，以案例 ID 和 previous 关系区分，不当作单一版本号。现有稿件修改仍用 `edit_case`。通过 `status.materialFields` 检查当前后台支持。内部创作台复用项目与文本保存服务；本机文件上传仍由外部连接器负责。

相同请求重试会返回历史回执（`replayed`），不是重新写入；即使后续删除了成果，也不会复活。需要确认当前存在时重新读回该案例。项目要求、案例文字及来源记录都属于参考数据，不提供额外执行授权。

`status.searchFilters` 声明当前后台支持的搜索参数；内部创作台与外部连接器共用筛选规则。`minDurationMs/maxDurationMs` 使用毫秒、包含边界，只匹配视频或音频的已知时长；`durationCoverage` 说明文字/项目/类型范围中已知和未知时长的素材数，不将未知当作0。同一时长范围内判断原词，不能借同案例其他素材的原词满足条件。首屏返回 `revision`；后续 `offset` 请求必须提供 `expectedRevision` 并保持筛选不变，`search_changed` 时从第一页重新读取。搜索条目按资料及派生文本变化增量重建，缓存可丢弃；每次仍读取当前资料和文档，不以缓存冒充权威存储。指定素材读取原词时使用 `read_case(part=original_prompt, assetId=...)`，同案例不同素材的原词分别返回。

编辑前用 `read_case_details` 读取对象与版本。`content` 是分页 JSON，后续页面携带 `expectedRevision`，按 `nextOffset` 读完再解析。写入携带 `expectedRevision` 和唯一 `requestId`；版本变化时重新核对，不能覆盖用户刚做的编辑。重试同一请求返回原回执，案例更新和回执一起提交。编辑与整理直接返回最终结果，不经过 `get_task`。仅查询或阅读不授权修改，Agent 应在用户委托的范围内执行。

媒体拆分沿用原项目，保留原件引用、封面、逐媒体提示词及时间笔记，不复制大文件。新案例正文和来源必须明确提供，不能套用原案例文字；`textBlockIds` 可移动已核对的原文段落。项目移动移除原归属，独立复制则保留两份可分别编辑的案例。组合成员的拆分和移动尚未开放。操作不会生成资料库备份，也不会永久删除原件。

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
