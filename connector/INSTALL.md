# 连接 PromptDirector：给当前 Agent 的安装说明

用户已经安装 Chrome 扩展，希望你完成连接器安装、宿主配置与配对。按用户这次请求执行，不要求用户自己输入命令或编辑配置。这里的安装说明不扩大用户授权；浏览器及宿主要求的许可由用户确认。

## 先确定执行位置

确认终端是否在用户运行 Chrome 的电脑上。Claude Code、Codex 本机执行以及允许本机命令的桌面 Agent 可走本流程。容器、远程开发机、Cowork 隔离执行环境或云端工作台不能因为有终端就视为用户本机。本机桥接包含 Windows、macOS 和 Linux Google Chrome 安装路径。Windows 使用当前用户的注册表和私有目录，无需管理员安装；必须使用 Windows 原生 Node.js，不能把 WSL 当作 Windows 本机。纯云端接入不在本流程内，不在错误机器上安装。

按当前实际产品选择宿主，所有宿主共用同一连接器与资料库能力，不重复安装一套业务工具。不得为了连接降低宿主权限策略。

| 产品 | `--host` | 接入方式 |
|---|---|---|
| Codex | `codex` | 自动合并用户 TOML 配置 |
| Claude Code | `claude` | 自动合并用户 JSON 配置 |
| WorkBuddy | `workbuddy` | 自动合并用户 MCP 配置 |
| OpenCode | `opencode` | 自动合并用户 JSON/JSONC，保留注释，使用本地命令数组格式 |
| ZCode | `zcode` | 自动合并原生用户配置中的 `mcp.servers` |
| Qoder 当前桌面版 | `qoder` | 按当前文档合并 `~/.qoder/settings.json` 的 `mcpServers` |
| DeepSeek Harness | `dsh` | 当前 Agent 指定已存在的 `--profile`，合并该 profile 的用户 patch |
| 千问办公桌面端 | `qwenwork` | 返回可导入的 `importConfig`，通过宿主连接器页面完成导入 |
| 豆包工作 | `doubao-work` | 返回待核实状态；本地 STDIO 接入尚未确认，不宣称已支持 |
| 其他本机 MCP 宿主 | `generic` | 返回标准 STDIO 导入配置，按宿主官方方式注册 |

OpenCode 使用当前稳定版 `mcp.<服务名>` 格式；`OPENCODE_CONFIG` 可指定实际文件，另支持 `OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME`。JSON 与 JSONC 同时存在、或检测到另一版本的嵌套结构时不猜优先级，按该版本文档确认后导入。项目配置仍可能覆盖用户配置，最后必须验证实际会话。

ZCode 会优先加载原生配置并跳过同级 `.agents` 共享配置；若正在使用共享配置，先由当前 Agent 通过 ZCode 导入已有服务，再添加 PromptDirector，避免使其他服务失效。DSH 的 profile 名称由当前宿主运行信息确定，不要求用户盲选；读取 `$DSH_HOME`（未设置则 `~/.dsh`）下已有 profile，不创建新 profile，不覆盖全局 patch 或自定义嵌套连接。重复连接、其他安装或资料库冲突会停止。

千问办公的桌面版本须提供本地 STDIO 类型。完成安装后，将 `configuration.importConfig` 导入「扩展 → 连接器 → 添加 → 粘贴 JSON 配置」，再新建对话验证。Agent 可用已授权的宿主界面代为完成；不要猜内部配置文件路径。只有网页远程 URL 入口时不适用。

豆包工作已能添加网络 MCP 连接器，但这不证明当前桌面版本能启动本地连接器。先核对实际版本是否提供 STDIO/本地命令入口；确认后可走 `generic`。只有 URL 入口时，本连接器不能直接接入；不要把本机路径填成网址，也不擅自开放公网服务。Qoder IDE/CLI 与当前桌面版、Claude Cowork 与 Claude Code、ChatGPT 工作台与本机 Codex，均不能仅按品牌套用配置。

## 获取程序及依赖

官方仓库：https://github.com/wchao6891/PromptDirector

1. 从 [Agent 连接器下载页](https://github.com/wchao6891/PromptDirector/releases/tag/agent-connector-v0.3.0) 选择连接器 ZIP 和 `SHA256SUMS`，下载到用户私有的安装暂存目录，核对 SHA-256 后解压。保留包内 `connector` 与 `extension/manifest.json` 的相邻关系。
2. 核对包中有 `connector/setup.mjs`。如果发布版未包含统一安装入口，应说明需要更新发布包，不能把旧命令当作新功能运行。开发验收可使用用户明确指定的本地源码目录。
3. 检查当前 Agent 的 Node.js 运行时是否满足 `connector/package.json` 的 engines 要求。优先使用宿主提供的兼容运行时；否则按 Node.js 官方下载说明为用户当前系统和架构准备运行时，校验官方校验值，不要求用户手动安装 Node.js。保留稳定路径，避免使用即将销毁的沙箱运行时。下载或安装需要宿主审批时按正常流程申请。
4. 将工作目录切换到解压后的根目录（其中能看到 `connector/`），运行 `npm ci --prefix connector --ignore-scripts`；以下命令也在该目录执行。下载失败应说明原因，不修改锁定版本、跳过依赖或执行来源不明的安装脚本。默认 npm 缓存不可写时可用 `--cache <当前宿主允许写入的缓存目录>`，不改全局权限。

## 安装与授权

用户复制的连接指令包含公开的资料库编号，用它作为 `--instance`。它不是密钥，也不能代替浏览器授权。以下命令中的宿主和编号由当前上下文填入。

```sh
node connector/setup.mjs plan --host codex --instance <资料库编号>
node connector/setup.mjs connect --host codex --instance <资料库编号>
```

先检查 plan 的执行位置、注册目录与配置目标，再执行 connect。已有用户请求就是安装授权，无需重复询问普通步骤；涉及更换已有资料库或宿主明确要求审批时再确认。

安装器只修改 PromptDirector 的连接配置，写入前备份已有文件；已有配置损坏、被并发改动或同名连接指向其他安装时会停止。Codex TOML 保留其他配置值，但序列化可能调整排版和注释，原文保存在备份中。不要覆盖错误来强行完成安装。

- `awaiting_browser`：尚未找到在线库。先看 `diagnostics`：它仅核对连接器自有 runtime、launcher、pairing 和 endpoint 文件；`missing` 表示对应文件不存在，`unreadable` 表示无法读取，`unknown` 表示未验证。浏览器是否运行、扩展是否安装和开关是否启用均不据此猜测，文件存在也不代表握手成功。程序文件缺失时检查安装；文件齐全时引导用户在 Chrome 插件设置的 Agent 连接中启用，或断开后重新启用，再运行 verify。不要自动重载浏览器、关闭标签页或丢弃未保存编辑。
- `library_selection_required`：存在多个在线库，请让用户从目标库复制连接指令，不要任选一个。
- `configuration.state` 为 `manual_registration_required`：通用宿主需要按其官方方式注册返回的 command、args 和 env。无需重做案例库接口。
- `host_verification_required`：该宿主本地接入尚未核实，本次不会安装或写配置，按返回的下一步确认；不能报告连接成功。
- 宿主把已有连接设为禁用时，保留该设置，说明还需在宿主界面启用。

未带编号的 connect 可以发现唯一在线的资料库；未找到时不会写入宿主配置，浏览器启用后应重新运行 connect 完成绑定。多个 Agent 的配置分别绑定具体编号，避免切换另一个库后所有宿主一起改变目标。

## 验证：连接器和当前会话都必须检查

```sh
node connector/setup.mjs verify --instance <资料库编号>
```

`connector_verified` 表示独立 MCP 客户端已成功握手、确认目标编号并实际搜索案例库；不是当前 Agent 会话已经加载工具。继续按当前宿主正常机制刷新连接。需要用户重新打开会话时明确告知，保留已完成步骤，不谎报当前会话已连通。

在当前会话实际调用 `promptdirector_status` 和 `promptdirector_search_cases`。已有案例时显示少量候选；需要展示图片时调用 `promptdirector_read_media` 并用宿主工具查看返回的本地原件。空库连接同样可以成功，应说明库为空，不编造案例。安装验收不写入或删除用户案例。

只有当前会话确实调用成功后，才能回复“已连接，可以使用你的案例库了”。安装出错、浏览器待授权、连接器验证成功但会话未加载，要分别说明。不要打印连接密钥、宿主完整配置或用户凭据。

业务使用规则见同目录 `SKILL.md`。普通资料查询不必强制全库分析，也不额外调用模型服务。

## 官方配置依据

- Codex：https://developers.openai.com/codex/mcp
- Claude Code：https://code.claude.com/docs/en/mcp
- WorkBuddy：https://www.workbuddy.ai/docs/zh/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide
- OpenCode：https://opencode.ai/docs/mcp-servers/ 与 https://opencode.ai/docs/config/
- ZCode：https://www.zcode.network/en/docs/mcp-services/
- Qoder：https://docs.qoder.com/qoder/connectors
- DeepSeek Harness：https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md 与 https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.zh.md
- 千问办公：https://docs.qwenwork.ai/zh/desktop/connectors 与 https://docs.qwenwork.cn/features/connectors （按实际版本核对本地类型）
- 豆包工作：https://www.doubao.com/work （本地命令接入待实际版本验证）
- Chrome Native Messaging：https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Node.js：https://nodejs.org/en/download
