# PromptDirector Agent 连接器

首版提供查、取、存、回存七个 MCP 工具，支持本机 macOS Chrome。连接器和扩展必须同时安装，Chrome 需要保持运行。这里的代码和自动测试不代表已在日常安装版或微信会话中通过验收。

## 工具

| 工具后缀 | 功能 |
|---|---|
| `status` | 配对资料库的实时连接状态和能力 |
| `search_cases` | 搜索当前文字、标签和项目，分页返回候选 |
| `read_case` | 分页读取正文、文档提取文字、原始提示词、分析文字、时间笔记和媒体提示词关系 |
| `read_media` | 下载选定原件至本机文件，验证完整字节和 SHA-256 |
| `capture_url` | 插件打开独立 Chrome 标签并调用现有采集流程 |
| `save_material` | 正文、附件和创作结果入库，保存附件提示词及来源案例快照 |
| `get_task` | 查询持久任务回执，区分处理中、成功、部分成功、失败和中断 |

完整名称有 `promptdirector_` 前缀。创作由 Agent 完成，本工具负责取材与回存；不额外调用模型，也不包含删除、批量管理或全库自动分析。

`read_media` 返回本机文件路径。Agent 必须有相应图片、视频或文档读取能力，才能分析该文件。只下载原件不等于完成视觉分析。没有本地原件或链接文件授权时会明确报错，不用缩略图冒充原件。

回存使用现有文件格式识别、文档提取、媒体存储和项目归属逻辑。`files[].originalPrompt` 与该附件绑定。`sourceCaseIds` 保存来源标题、网址和原资料库身份下的案例编号快照；分享包中的来源快照不代表接收方资料库中的可点击关联。Markdown 图片引用不会自动下载，原图需同时作为附件提供。长正文可通过 `bodyFile` 提交；内联正文长度受协议单消息容量约束，文件使用分块，不需要缩短正文或压缩原件。

文件导入沿用插件现有格式和容量检查。`forceImport` 仅用于用户同意插件报告的大图片风险后的导入，不跳过空间不足、损坏或格式检查。浏览器仍受实际可用存储空间约束；尚未完成 GB 级安装版性能验收。

## 首次安装

在项目根目录运行以下检查和准备步骤。安装会写入当前用户的本机连接器目录及 Chrome Native Messaging 注册目录，不修改案例数据。

```sh
npm ci --prefix connector --ignore-scripts
node connector/install.mjs plan
node connector/install.mjs install
```

1. 使用包含本功能的 PromptDirector 扩展。既有用户应沿用原扩展身份升级，保留案例库。
2. 打开设置 → 界面与资料库 → Agent 连接，点击启用，授予本机通信和网页采集权限。
3. 使用页面显示的配对编号运行 `node connector/install.mjs pair <配对编号>`。输出包含 MCP 的 command、args 和 env，里面没有连接密钥。
4. 将输出配置注册到支持 stdio MCP 的 Agent。OpenClaw 使用出站 `mcp add` / `mcp set`；先检查同名配置，避免重复注册。`SKILL.md` 提供工具使用与任务续查规则。
5. 用 OpenClaw 的 `mcp doctor promptdirector --probe` 检查握手及工具发现，再在实际目标 Agent 会话确认工具可用。CLI 的 `mcp reload` 不能代替 Gateway 的配置生效验收。

默认连接目录为当前用户主目录下的 `.promptdirector`。`PROMPTDIRECTOR_CONNECTOR_HOME` 可指定其他用户私有目录，安装器与 Agent 配置必须一致。多 Chrome profile 各有配对编号；`PROMPTDIRECTOR_INSTANCE` 可为不同 Agent 显式指定实例，未指定则使用配对选择。

本机连接器运行代码复制到稳定的私有目录，不依赖开发目录常驻。它依赖安装时的 Node 可执行文件；Node 被移除或路径改变后，重新运行安装器更新启动入口。升级连接器后需要插件断开再启用连接。macOS Unix socket 路径有系统长度限制，目录过长会提示更换短路径。

## 数据和连接

连接使用 Chrome Native Messaging 与用户私有 Unix socket，没有网络监听端口。Chrome 校验扩展身份，连接器再校验实例编号和本机密钥。MCP 只开放明确的业务操作，不提供任意内部消息或任意脚本执行入口，不返回 AI 服务密钥。

原件副本保存在连接目录的 `files` 中，传输记录和任务回执保留在扩展本地存储。断开只停止新请求，已提交任务继续处理；Chrome 关闭导致的未完成任务会在下一次查询报告中断。网络或客户端超时后沿用原请求编号查询，不能把失去响应当作未入库。

待提交文件在入库前暂存，完整性通过后才进入案例。未完成文件不会自动清理，避免错误删除断线任务的原件；当前可由内部传输操作明确丢弃未提交记录，图形化清理属于后续扩展。已入库素材由原资料库管理。

Agent 获取的材料是否发送到模型或其他服务，取决于宿主设置和用户指令。首次启用前应理解这一数据流。工具不绕过浏览器、宿主或网站限制；需要登录或人工验证时返回实际错误。

## 验证与扩展

```sh
node --test test/agent-connector.test.js
npm test --prefix connector
npm run check
```

连接器测试使用真实 SDK stdio 握手与真实本机 socket，插件端是明确标注的测试替身。它不能替代真实 Chrome、网站采集和微信最终回复验收。

依赖方向为：MCP 工具 → 本机通信 → 扩展业务操作 → 现有资料库。新增业务能力应实现独立模块，再注册明确的工具参数、返回值、权限与测试；不将界面按钮逐个映射为工具，不预先开放尚未实现的能力。协议版本在连接时校验，未知操作会拒绝。后续管理、分类、分析、批量和 Skill 可按真实需求扩展这一层。

## Release 安装包

下载并解压 `PromptDirector-版本号-Agent-Connector.zip`，在解压后的文件夹打开终端，执行本文的 `npm ci --prefix connector --ignore-scripts` 及安装命令。包中 `extension/manifest.json` 仅用于校验插件身份；实际扩展请使用同版本 `FIXED-ID-DEV` 包升级。连接器当前为 0.1.0，随 PromptDirector 1.21.0 提供；不包含 Node.js，需要预先安装 Node.js 22.13 或更新版本。
