# 提示词导演隐私政策

生效日期：2026 年 8 月 16 日

提示词导演是一个本地优先的 Chrome 扩展，用于收藏、整理、检索、备份和分享个人创作资料。扩展不提供开发者服务器，不创建账号，不收集使用统计，不投放广告，也不出售用户数据。

## 处理的数据

只有在用户主动收藏、导入、导出、分析、生成或进行提示词创作时，扩展才会处理相关数据：

- 用户高亮、保存、确认主体区域或明确启动同一列表批量采集时涉及的网页文字、图片、视频、GIF、文档、下载资源链接和截图，以及对应的标题、作者和来源信息；
- 用户主动创建或确认的提示词、内容类型、标签、别名、色卡、创作 Skill、项目和管理设置；
- 用户主动填写或连接的 AI 服务地址、模型、API Key、发送授权和服务能力信息；
- 用户主动导入、导出或分享的资料及其本地生成的预览文件。

## 本地保存与分享

- 案例文字、媒体、来源、标签、色卡、创作 Skill、设置和 API Key 默认保存在浏览器扩展的本地存储中。
- 截图裁剪、压缩、缩略图、色卡提取、资料整理和 ZIP 分享包生成在本机完成。
- 网页采集先在当前标签页本地提出外层主体区域，并在确认后展示内部有意义的正文、媒体、下载和整组内容块。用户可以在原网页添加遗漏内容、排除错误内容、整组修正、撤销或恢复自动识别。正文在主体确认后默认纳入；正文内已定位媒体默认进入保存方案，无法确认文章位置的媒体默认不选并显示为可能遗漏媒体。底部“保存案例”按钮会显示媒体数量；“保存案例”按钮是当前媒体方案的最终授权，用户也可以选择“只保存正文”。
- 用户明确启动同一列表批量采集后，扩展可在当前标签页滚动公开列表，并沿同一来源的列表分页链接继续采集；不会自动进入作品详情页，也不会绕过登录、验证码、付费墙、访问控制或反自动化限制。完成后会返回原列表页，并以实际识别数量和停止原因结束。
- 预检会显示主体内识别到的公开媒体地址和预览，但不会在最终保存动作前把媒体写入案例或请求媒体域名权限。只有最终保存方案中的媒体会尝试读取原始文件；公开图片失败时，扩展才会让当前网页使用已有登录会话读取该图片。扩展不读取、导出、保存或传输 Cookie、Token 与登录请求头。
- PDF、Markdown、SKILL.md、TXT、HTML 和 RTF 只有属于用户最终保存方案时，才会从公开 HTTPS 地址读取，并在真实文件类型和容量限制校验通过后保存本地副本；请求不携带登录凭据。读取失败时只保留原始来源链接。压缩包、程序和未知类型文件不会自动下载，也不会作为 Skill 静默导入。
- API Key 不进入导出 ZIP、Markdown、JSON、分享包、创作草稿、诊断包或日志。
- 用户主动导出或分享时，扩展在本机生成资料夹或 ZIP 分享包；离线预览只读取包内内容和固定本地脚本，不会上传数据。用户决定分享包中包含哪些资料，并应自行判断分享对象与内容。

## 可选 AI 服务与发送范围

扩展支持用户为以下七项 AI 任务分别选择服务与模型：文字标签、Skill 提炼、创作规划、图片分析、视频分析、图片生成和视频生成。用户可使用内置服务档案，也可连接用户选择的第三方 AI 服务或自定义兼容接口。服务实际可用范围以用户配置、所选模型与服务商规则为准。

- AI 功能默认不因安装而自动执行。发送授权是所有真实外部请求的前置条件；已保存 API Key、已选模型或单次付费确认都不能替代发送授权。
- 对新增的付费媒体分析或生成，扩展还会要求单次付费确认。该确认只授权当前操作，且与发送授权相互独立；两者不能互相替代。
- 发送时，扩展只发送完成当前任务所必需、且由用户明确选择或提交的内容。根据任务，这可能包括文字提示词、用户创作要求、本次选择的参考图片或视频、画面描述、生成参数或当前会话中用户可见的消息。
- 图片创作默认可以使用用户选择的原图。若每项参考已有案例提示词或有效画面分析文字，用户可改为“全程只用案例/分析文字”；该模式不会读取、分析或发送图片，图片载荷为零。
- 扩展不会自动发送整库、全部案例、未选择案例、API Key，或为了失败恢复而静默改用另一家付费服务、重新发起付费请求。
- 图片和视频仅会在用户对相应任务明确选择或提交，并完成上述所需确认后，直接通过 HTTPS 发送给所选第三方 AI 服务或自定义兼容接口。开发者不会接收或中转这些内容。
- 第三方 AI 服务和自定义兼容接口对收到数据的处理，受用户与该服务商之间适用的隐私政策、服务条款和账户设置约束。用户应在启用前审阅这些规则。

## 数据分享与保留

提示词导演不会主动向开发者或其他第三方共享数据。只有用户主动使用已配置且已授权的 AI 服务，或主动导出、迁移和分享资料时，相关数据才会按用户的操作离开扩展的本地存储。

本地数据会保留，直到用户在案例库中修改或删除、清除扩展数据，或卸载扩展。用户可在卸载前创建本地备份，并可在 AI 服务连接设置中清除本地 API Key 和发送授权。

## Chrome Web Store Limited Use

提示词导演对用户数据的使用遵守 Chrome Web Store User Data Policy 的 Limited Use 要求：权限和用户数据只用于提供或改进本政策所述、用户可见的单一用途与功能；不会将用户数据用于个性化广告、再营销或基于兴趣的广告；不会出售用户数据；不会允许人工读取用户数据，除非用户为解决其明确提出的支持请求而对特定内容另行授权，或法律与安全义务确有要求。

## 权限用途

- `activeTab`：仅在用户主动触发的当前标签页操作中访问页面内容；用户明确启动列表批量采集时，可在同一标签页内滚动或沿列表分页继续，并在结束后返回原列表页。
- `alarms`：安排本地后台任务的延后、轮询或恢复，不用于跟踪用户。
- `contextMenus`：提供右键收藏入口。
- `downloads`：将用户请求的备份、分享包或媒体保存到本机。
- `offscreen`：在本机处理截图、媒体、文档或 ZIP 等需要后台页面完成的操作。
- `sidePanel`：在 Chrome 侧边栏显示扩展的收藏与创作界面。
- `scripting`：仅在用户主动启动采集、选图或截图工具时向当前页面注入所需脚本。
- `storage` 与 `unlimitedStorage`：保存用户主动收藏的资料、媒体、设置和本地 AI 服务配置。
- `https://wchao6891.github.io/*`：读取 PromptDirector 官方精选目录、目录指标、封面和只读预览数据。
- `https://github.com/*`：读取用户明确选择保存的官方精选 Release 包，并打开公开的问题反馈或投稿页面。
- `https://objects.githubusercontent.com/*` 与 `https://release-assets.githubusercontent.com/*`：跟随 GitHub Release 的受信下载链读取用户明确选择的精选包及其媒体；不会读取其他 GitHub 账号数据。
- 可选的 `<all_urls>`：不在安装时授予。只有用户主动使用需要相应站点权限的采集功能或保存第三方 AI 服务、自定义兼容接口时，扩展才会请求相应域名的运行时权限。
- 可选的 `clipboardRead`：只在用户明确触发需要读取剪贴板内容的功能时请求。
- 可选的 `declarativeNetRequestWithHostAccess`：只在用户已授予相应站点访问权限、且功能需要按该权限处理网络请求时使用。

## 联系方式

请通过 [PromptDirector 精选案例 GitHub Issues](https://github.com/wchao6891/PromptDirector-Curated/issues) 联系项目维护者。

---

# PromptDirector Privacy Policy

Effective date: August 16, 2026

PromptDirector is a local-first Chrome extension for collecting, organizing, searching, backing up, and sharing personal creative references. It has no developer-operated data server or user account system, does not collect analytics, does not show ads, and does not sell user data.

## Data handled

PromptDirector handles data only when the user explicitly captures, imports, exports, analyzes, generates, or composes with it. This can include selected website text and resources, source URLs and attribution, screenshots, user prompts and notes, projects, tags, Creative Skills, settings, and credentials for AI services chosen by the user.

Cases, media, tags, settings, Creative Skills, and API keys are stored in the browser's local extension storage by default. Image processing, document extraction, archive creation, and offline previews run locally. API keys are excluded from exports, shared packages, drafts, diagnostics, and logs.

## Optional external services

PromptDirector supports seven separately assigned AI tasks: text tagging, Skill extraction, creative planning, image analysis, video analysis, image generation, and video generation. No external AI request runs merely because the extension is installed. A real request requires the configured service, model, required site permission, and the user's sending consent. Paid media analysis or generation also requires a separate confirmation for the current action.

Only content selected or submitted for the current operation is sent directly over HTTPS to the AI provider or compatible endpoint chosen by the user. PromptDirector does not silently send the full library, unselected cases, API keys, or retry a paid action through another provider. In text-only creation mode, images are neither read nor transmitted. The developer does not receive or proxy AI request content; each provider handles received data under its own terms and privacy policy.

## Sharing, retention, and deletion

Data leaves local storage only when the user explicitly sends it to a configured AI service, exports or migrates it, or creates and distributes a share package. Local data remains until the user edits or deletes it, clears extension storage, or uninstalls the extension. Users can create a local backup before uninstalling and can remove locally saved API keys and consent in AI service settings.

## Chrome Web Store Limited Use

PromptDirector complies with the Limited Use requirements of the Chrome Web Store User Data Policy. Permissions and user data are used only to provide or improve the disclosed, user-facing single purpose and features. User data is not sold or used for personalized, retargeted, or interest-based advertising. Humans are not allowed to read user data unless the user separately authorizes access to specific content for a support request, or access is required for security or legal obligations.

## Permission purposes

- `activeTab`: access the current page only after a user starts capture, visual selection, or another page action.
- `alarms`: schedule or resume local background work; never for tracking.
- `contextMenus`: provide the explicit right-click capture entry.
- `downloads`: save a user-requested backup, share package, or media file.
- `offscreen`: perform local screenshot, media, document, or ZIP work that needs a background document.
- `sidePanel`: show capture and creation controls in the Chrome side panel.
- `scripting`: inject the required capture, selection, or screenshot code only after a user starts that action.
- `storage` and `unlimitedStorage`: retain the user's selected references, media, settings, and local AI configuration.
- `https://wchao6891.github.io/*`: read the official curated catalog, metrics, covers, and read-only previews.
- `https://github.com/*`: read an official curated Release package selected by the user and open public feedback or submission pages.
- `https://objects.githubusercontent.com/*` and `https://release-assets.githubusercontent.com/*`: follow GitHub's trusted Release download chain for a curated package and its media selected by the user; no other GitHub account data is read.
- Optional `<all_urls>`: not granted at installation. PromptDirector requests only the specific origin needed when the user starts a site-dependent capture or saves a third-party or compatible AI endpoint.
- Optional `clipboardRead`: requested only for a user-triggered feature that reads clipboard content.
- Optional `declarativeNetRequestWithHostAccess`: requested only when a user-granted site permission and the chosen feature require a bounded network rule.

## Contact

Contact the maintainer through [PromptDirector Curated GitHub Issues](https://github.com/wchao6891/PromptDirector-Curated/issues).
