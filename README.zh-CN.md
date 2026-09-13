<p align="center"><img src="docs/assets/github-banner.svg" alt="PromptDirector — Capture, collect, organize" width="100%"></p>

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

<h1 align="center">把好案例，变成你的创作底气。</h1>

<p align="center"><strong>多网站一键采集 · 图文提示词成套收藏 · Agent 随时调用</strong><br>从即梦、Higgsfield、X，到小黑盒、微信公众号、飞书文档。<br>把你看中的画面、提示词和经验存进自己的案例库，让下一次创作从好参考开始。</p>

<p align="center"><a href="https://github.com/wchao6891/PromptDirector/releases/latest"><strong>下载 GitHub 最新版</strong></a> · <a href="https://wchao6891.github.io/PromptDirector-Curated/">浏览精选案例</a> · <a href="#安装与更新">安装说明</a></p>

<p align="center">免费开源 · 本地优先 · 无需账号 · 支持本机 MCP Agent</p>

## 刷到好案例，一键开始收藏

**好画面值得留下，做出它的提示词也一样。** PromptDirector 是为视觉创作者打造的 Chrome 扩展：把网页中的图片、视频、文字、提示词和来源一起整理入库。收藏时保留创作线索，需要时看图选择参考，让积累真正进入下一次创作。

**打开作品、帖子或文章 → 一键采集 → 预览勾选 → 保存案例。**

| 灵感来自哪里 | 值得带走什么 |
| --- | --- |
| **即梦 · Higgsfield · LiblibAI · Krea · LibTV** | 作品图片、视频，以及页面公开的提示词和创作信息。把喜欢的画面与创作线索放在一起。 |
| **小黑盒 · 微信公众号** | 收藏整篇图文，也可将结构清晰的多案例文章拆开，勾选其中的图片与对应提示词，分别保存。小黑盒单案例图片墙可与正文提示词成组收藏。 |
| **飞书文档** | 保存正文、长文档和表格内图文，保留单元格位置与合并关系，让案例回到对应的位置。 |
| **X / Twitter · 小红书 · 微博 · Reddit** | 收集当前帖子正文和可获取的媒体，把作者分享的提示词与作品一起留下。 |
| **Pinterest · Behance · ArtStation · 花瓣 · 站酷** | 收集作品页面的视觉参考，集中浏览、搜索和整理。 |
| **更多网页与本地资料** | 通用网页采集，加上选区、选图、截图和本地文件导入，把分散的资料汇到一个库里。 |

### 一篇文章，收藏成一组能单独使用的案例

遇到十几个案例放在一起的教程或分享帖，可以在「文章内案例」中预览分组，只勾选想要的案例，分别入库；也可以保留整篇文章。支持明确案例标题或编号的图文结构，拆分后仍可核对每组图片和提示词。

### 好参考，连同上下文一起留下

多图作品保留成组关系，文章保留图文顺序，飞书表格保留布局。图片、正文、原始提示词、来源与后续分析各有位置，方便回看，也方便交给模型使用。

采集、浏览和整理无需 AI 服务。页面需要可访问，原始提示词需要作者公开；登录、懒加载和网站变化可能影响结果，保存前可预览核对。视频在可取得完整文件时保存本地，支持的独立播放器与 HLS 流可在库内播放。详见[网页与媒体采集说明](docs/CAPTURE_SUPPORT.md)。

## 你的眼光选参考，你的 Agent 接着创作

**把案例库交给 Codex、Claude Code、WorkBuddy 使用。** 找参考、读提示词、取原件、采集网址、回存创作材料，在 Agent 对话里串起来。你在案例墙里挑中的画面，也能成为下一次对话中明确可用的创作依据。

1. 在插件「设置 → Agent 连接」点击 **复制连接指令**。
2. 粘贴给支持本机 MCP 的 Agent，让它安装连接器、配置并验证。
3. 按提示在插件里启用授权，开始调用案例库。

连接之后，可以这样下需求：

> “从我的案例库找几组国风人物海报参考，列出来让我选。”
>
> “读取我选中的案例原图和提示词，参考它们写这次活动的视觉方案。”
>
> “把这次确认的提示词和生成图片存回 PromptDirector。”

**Google Chrome + Windows / macOS / Linux。** Codex、Claude Code、WorkBuddy 提供配置入口，其他本机 MCP 客户端可使用通用配置。连接器是由 Agent 安装的独立本机组件，首次连接需要浏览器授权；纯云端工作台不适用此流程。具体创作和生成能力取决于所用 Agent 及其工具。[查看 Agent 安装说明 →](connector/INSTALL.md)

## 越收藏，越有自己的创作资料库

| 你在创作中需要的 | 这里已经准备好 |
| --- | --- |
| **看一眼，就知道想用哪张** | 图片优先的案例墙，配合文字搜索与标签筛选，让人直接看图做判断。 |
| **一个项目，一套参考** | 可嵌套项目树、案例组合和批量管理，把同一任务的灵感放在一起。 |
| **把经验用在下一次** | 创作台可读取选定案例，生成可编辑提示词、提炼可复用 Skill 和标签建议，由你审阅保存。 |
| **图片之外，也装得下资料** | 本地图片、视频、音频、DOCX、PDF、Markdown、TXT、HTML、RTF，以及视频时间点笔记。DOCX 可读取正文、表格和内嵌图片；其他 Office 文档与创作源文件保留原件供下载。 |
| **分享给别人，也留给未来的自己** | 导出案例或项目子树分享包，完整资料夹备份、换电脑恢复和加密文件夹同步。 |

AI 分析按需开启，使用你自己的服务；选中的参考可以帮助模型理解这次想要的画面。原图只在你选中或明确指定时发送给模型。你也可以只把它当作一套好用的视觉案例库，随时查、随时看。

## 从精选案例开始

先看画面，再读提示词，把适合自己项目的案例保存进本地库。下面是当前公开精选库中的部分案例。

<table>
<tr>
<td width="33%"><a href="https://wchao6891.github.io/PromptDirector-Curated/"><img src="https://wchao6891.github.io/PromptDirector-Curated/previews/featured-cases-vol-1/media/133a11be119a75a17b40-fe515974461558ef.webp" alt="天宫仙班压阵：群像与场面调度参考"></a></td>
<td width="33%"><a href="https://wchao6891.github.io/PromptDirector-Curated/"><img src="https://wchao6891.github.io/PromptDirector-Curated/previews/featured-cases-vol-1/media/a2b45b757798adb2685d-8dea3cc7d3e303fd.webp" alt="军帐权谋对峙：人物关系与光影参考"></a></td>
<td width="33%"><a href="https://wchao6891.github.io/PromptDirector-Curated/"><img src="https://wchao6891.github.io/PromptDirector-Curated/previews/featured-cases-vol-1/media/6652ed14274cd7be008f-73367e80019b085c.webp" alt="狐火纸影：材质与风格参考"></a></td>
</tr>
<tr><td>天宫仙班压阵</td><td>军帐权谋对峙</td><td>狐火纸影</td></tr>
</table>

[打开精选案例库 →](https://wchao6891.github.io/PromptDirector-Curated/)

以上为精选内容预览，非平台采集演示；素材使用范围以各案例的来源和授权说明为准。

## 你的资料，由你保管

资料、媒体、标签和设置默认保存在当前浏览器，不需要账号，没有广告，不收集使用统计。AI 功能由你主动开启，使用你自己的服务密钥；发送范围会在界面中说明。详见[隐私政策](store/PRIVACY_POLICY.md)。

## 安装与更新

**首次安装：下载 `PromptDirector-版本号.zip`，解压后在 Chrome / Edge 的扩展管理页加载。**

<details>
<summary>展开完整安装与原位更新步骤</summary>


从 [GitHub 最新发布页](https://github.com/wchao6891/PromptDirector/releases/latest) 下载 `PromptDirector-版本号.zip`。首次安装时，将包内程序文件解压到固定的 `PromptDirector` 文件夹（不带版本号），确保 `manifest.json` 位于该文件夹第一层。在 Chrome 或 Edge 的扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”，然后选择解压后的目录。

### 已安装？在原位置更新

在“设置”检查更新，点击“升级本地版”，首次选择 Chrome 当前加载的安装文件夹并授权，之后复用这个安装位置；授权失效时再授权。已有文件夹即使带旧版本号也可继续使用，无需重命名、移动或重新安装。插件自动下载、验证并写入新版程序，然后自动重启，重新打开设置核对版本；如出现“清理升级临时文件”，点击完成清理。案例和媒体继续使用当前浏览器中的原资料库。

也可通过 [Chrome Web Store](https://chromewebstore.google.com/detail/iahakaahijddcjjldidbclicedibgpjm) 安装，由商店管理后续更新。

</details>



## 参与与许可

欢迎提交问题、改善交互、完善采集适配、补充测试与文档。[反馈问题](https://github.com/wchao6891/PromptDirector/issues)时，请说明页面类型、用户可见的问题和复现步骤；提供示例前移除 API Key、私人资料和未获授权的素材。提交代码前请运行 `npm run verify`。

构建与测试说明见[开发指南](docs/DEVELOPMENT.md)。

代码采用 [Apache License 2.0](LICENSE)。第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。代码许可不授予第三方案例素材的使用权。
