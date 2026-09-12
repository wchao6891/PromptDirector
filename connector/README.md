# PromptDirector Agent 连接器

提供查、取、存、回存七个 MCP 工具，支持本机 Windows、macOS 和 Linux Google Chrome。连接器和扩展需要同时安装，Chrome 需要保持运行。

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

文件导入沿用插件现有格式和容量检查。`forceImport` 仅用于用户同意插件报告的大图片风险后的导入，不跳过空间不足、损坏或格式检查。浏览器仍受实际可用存储空间约束。

## 一句话连接

在 Chrome 插件设置的 Agent 连接处点击“复制连接指令”，粘贴给当前 Agent。它会按 [统一安装说明](INSTALL.md)检查环境、安装、配置并验证；需要时由用户在浏览器启用连接。

统一入口为 `node connector/setup.mjs plan|connect|verify`。安装程序直接支持 Codex、Claude Code、WorkBuddy 的用户级配置，其他本地 stdio MCP 宿主使用 `generic` 输出标准配置。本机桥接包含 Windows、macOS、Linux Google Chrome 的安装路径。Windows 使用用户级注册表、私有目录和命名管道；需使用 Windows 原生 Node.js。纯云端接入不在本流程内。不同桌面工作台的隔离环境需分别检查，不能仅凭品牌推断兼容。

配置写入前保留备份，不覆盖损坏文件或其他同名连接。验证会通过实际 MCP 握手和案例查询确认连接器工作，随后仍需当前 Agent 会话调用工具，才能宣布用户已经连通。详细步骤与安装依赖由 Agent 按 INSTALL.md 执行，用户无需编辑配置文件。

默认连接目录为当前用户主目录下的 `.promptdirector`。`PROMPTDIRECTOR_CONNECTOR_HOME` 可指定其他用户私有目录，安装器与 Agent 配置必须一致。多 Chrome profile 各有配对编号；`PROMPTDIRECTOR_INSTANCE` 可为不同 Agent 显式指定实例，未指定则使用配对选择。

本机连接器运行代码复制到稳定的私有目录，不依赖开发目录常驻。它依赖安装时的 Node 可执行文件；Node 被移除或路径改变后，重新运行安装器更新启动入口。升级连接器后需要插件断开再启用连接。macOS Unix socket 路径有系统长度限制，目录过长会提示更换短路径。

## 数据和连接

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

下载并解压 `PromptDirector-版本号-Agent-Connector.zip`，让 Agent 在解压后的文件夹按 `INSTALL.md` 执行安装与连接检查。包中 `extension/manifest.json` 仅用于校验插件身份；实际扩展请使用同版本 `FIXED-ID-DEV` 包升级。连接器当前为 0.2.0，对应 PromptDirector 1.21.1；安装包不包含 Node.js；Agent 会按统一安装说明检查并准备兼容运行时。
