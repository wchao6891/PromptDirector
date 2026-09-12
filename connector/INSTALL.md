# 连接 PromptDirector：给当前 Agent 的安装说明

用户已经安装 Chrome 扩展，希望你完成连接器安装、宿主配置与配对。按用户这次请求执行，不要求用户自己输入命令或编辑配置。这里的安装说明不扩大用户授权；浏览器及宿主要求的许可由用户确认。

## 先确定执行位置

确认终端是否在用户运行 Chrome 的电脑上。Claude Code、Codex 本机执行以及允许本机命令的桌面 Agent 可走本流程。容器、远程开发机、Cowork 隔离执行环境或云端工作台不能因为有终端就视为用户本机。本机桥接包含 Windows、macOS 和 Linux Google Chrome 安装路径。Windows 使用当前用户的注册表和私有目录，无需管理员安装；必须使用 Windows 原生 Node.js，不能把 WSL 当作 Windows 本机。纯云端接入不在本流程内，不在错误机器上安装。

识别当前宿主：Codex 使用 `codex`，Claude Code 使用 `claude`，WorkBuddy 使用 `workbuddy`。其他已确认支持本地 stdio MCP 的宿主使用 `generic`，再按该宿主官方配置机制注册返回的配置。Claude Cowork、ChatGPT 工作台不能仅按品牌套用 Claude Code 或 Codex 的配置路径。不得为了连接降低宿主权限策略。

## 获取程序及依赖

官方仓库：https://github.com/wchao6891/PromptDirector

1. 从官方 Releases 选择最新稳定版本中的 `Agent-Connector.zip` 和 `SHA256SUMS.txt`，下载到用户私有的安装暂存目录，核对 SHA-256 后解压。保留包内 `connector` 与 `extension/manifest.json` 的相邻关系。
2. 核对包中有 `connector/setup.mjs`。如果发布版未包含统一安装入口，应说明需要更新发布包，不能把旧命令当作新功能运行。开发验收可使用用户明确指定的本地源码目录。
3. 检查当前 Agent 的 Node.js 运行时是否满足 `connector/package.json` 的 engines 要求。优先使用宿主提供的兼容运行时；否则按 Node.js 官方下载说明为用户当前系统和架构准备运行时，校验官方校验值，不要求用户手动安装 Node.js。保留稳定路径，避免使用即将销毁的沙箱运行时。下载或安装需要宿主审批时按正常流程申请。
4. 在解压目录运行 `npm ci --prefix connector --ignore-scripts`。下载失败应说明原因，不修改锁定版本、跳过依赖或执行来源不明的安装脚本。

## 安装与授权

用户复制的连接指令包含公开的资料库编号，用它作为 `--instance`。它不是密钥，也不能代替浏览器授权。以下命令中的宿主和编号由当前上下文填入。

```sh
node connector/setup.mjs plan --host codex --instance <资料库编号>
node connector/setup.mjs connect --host codex --instance <资料库编号>
```

先检查 plan 的执行位置、注册目录与配置目标，再执行 connect。已有用户请求就是安装授权，无需重复询问普通步骤；涉及更换已有资料库或宿主明确要求审批时再确认。

安装器只修改 PromptDirector 的连接配置，写入前备份已有文件；已有配置损坏、被并发改动或同名连接指向其他安装时会停止。Codex TOML 保留其他配置值，但序列化可能调整排版和注释，原文保存在备份中。不要覆盖错误来强行完成安装。

- `awaiting_browser`：引导用户在 Chrome 插件设置的 Agent 连接中点击启用，或断开后重新启用。等用户完成后再运行 verify；不要自动重载浏览器、关闭标签页或丢弃未保存编辑。
- `library_selection_required`：存在多个在线库，请让用户从目标库复制连接指令，不要任选一个。
- `configuration.state` 为 `manual_registration_required`：通用宿主需要按其官方方式注册返回的 command、args 和 env。无需重做案例库接口。
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
- Chrome Native Messaging：https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- Node.js：https://nodejs.org/en/download
