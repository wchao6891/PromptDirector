<p align="center"><img src="docs/assets/github-banner.svg" alt="PromptDirector — Capture, collect, organize" width="100%"></p>

<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

<h1 align="center">好画面，连同提示词一起收藏。</h1>

<p align="center">从 Higgsfield、即梦、X 等平台收集创作参考，建立自己的视觉灵感库。<br>图片、视频、提示词与来源放在一起，下一次创作时找得到、用得上。</p>

<p align="center"><a href="https://github.com/wchao6891/PromptDirector/releases/latest"><strong>下载 GitHub 最新版</strong></a> · <a href="https://wchao6891.github.io/PromptDirector-Curated/">浏览精选案例</a> · <a href="#安装与更新">安装说明</a></p>

<p align="center">免费开源 · 本地优先 · 无需账号 · AI 分析可选</p>

## 集各家所长，存进自己的库

刷到喜欢的作品，不必只留一个链接。PromptDirector 是一个 Chrome 扩展，为创作网站和社交平台做专门采集适配，把页面提供的素材、文字与来源整理成一个案例。

| 在哪里发现灵感 | 可以怎样收藏 |
| --- | --- |
| **Higgsfield** | 收集作品图片、视频与创作说明，把喜欢的镜头和视觉表达留下来。 |
| **即梦 Jimeng** | 收集作品媒体，以及页面提供的原始提示词、模型和作者信息。 |
| **X / Twitter** | 从帖子中提取正文和图片、视频线索，把作者分享的提示词与作品一起保存。 |
| **更多创作与设计网站** | 已为 LiblibAI、LibTV、Krea、Pinterest、Behance 等站点加入适配；其他页面也可选择文字、图片或截图采集。 |

**打开作品或帖子 → 一键发起采集 → 预览、调整 → 保存入库。**

采集以页面实际提供、当前可访问的内容为准。原始提示词需要作者公开；作品说明与 AI 分析会作为不同来源的内容保留。登录状态、页面变化或媒体访问限制可能影响采集结果。

采集不调用 AI。视频优先保存本地，可用的独立播放器与 HLS 流可在库内播放。播放与访问边界详见[采集说明](docs/CAPTURE_SUPPORT.md)。

## 收藏之后，继续用起来

| 你想做的事 | PromptDirector 如何帮你 |
| --- | --- |
| **看图找灵感** | 用图片优先的资料墙浏览案例，搜索文字、筛选标签，找回记不清名字的参考。 |
| **按项目整理** | 把案例放进可嵌套的项目树，组合相关案例，批量管理同一创作任务的资料。 |
| **看懂为什么好** | 按需连接自己的 AI 服务，分析文字、画面或视频，为参考补充理解与检索线索。 |
| **把资料放在一起** | 收录本地图片、视频、PDF、Markdown、TXT、HTML，以及视频时间点笔记。 |
| **分享与长期保存** | 把选定案例或项目子树打成分享包；完整资料夹备份支持换电脑恢复，加密文件夹同步可在自己的设备间恢复资料。 |

进一步创作时，还可以把案例提炼为 Skill，在创作台组合参考并生成可编辑提示词。采集、整理和浏览资料无需配置 AI 服务。

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

**首次安装：下载 `FIXED-ID-DEV` ZIP，解压后在 Chrome / Edge 的扩展管理页加载。**

<details>
<summary>展开完整安装与原位更新步骤</summary>


从 [GitHub 最新发布页](https://github.com/wchao6891/PromptDirector/releases/latest) 下载名称带 `FIXED-ID-DEV` 的 ZIP。首次安装时，将包内程序文件解压到固定的 `PromptDirector` 文件夹（不带版本号），确保 `manifest.json` 位于该文件夹第一层。在 Chrome 或 Edge 的扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”，然后选择解压后的目录。这个包保留 Chrome Web Store 分配的固定扩展身份，适合本地开发验证。

不带 `FIXED-ID-DEV` 的同版本 ZIP 仅供维护者上传 Chrome Web Store，清单中按商店要求移除了 `key`，不要把它作为本地解压安装包。同一扩展身份下的常规更新不需要导出或重新导入案例；如曾使用其他扩展 ID，请按[扩展身份迁移说明](docs/EXTENSION_ID_MIGRATION.md)恢复资料。

### 已安装？在原位置更新

已具备本地升级功能的版本：在“设置”检查更新，点击“升级本地版”，首次选择 Chrome 当前加载的安装文件夹并授权，之后复用这个安装位置；授权失效时再授权。已有文件夹即使带旧版本号也可继续使用，无需重命名、移动或重新安装。程序更新后重启插件，重新打开设置核对版本；如出现“清理升级临时文件”，点击完成清理。案例和媒体继续使用当前浏览器中的原资料库。

旧版本首次接入：下载新版 `FIXED-ID-DEV` ZIP，将包内程序文件覆盖到 Chrome 当前加载的原目录，再到扩展管理页点击重新加载。保持原插件与固定身份，无需卸载，也无需备份再导入案例。源码工作目录通过 Git 更新。


也可通过 [Chrome Web Store](https://chromewebstore.google.com/detail/iahakaahijddcjjldidbclicedibgpjm) 安装，由商店管理后续更新。

</details>



## 参与与许可

欢迎提交问题、改善交互、完善采集适配、补充测试与文档。[反馈问题](https://github.com/wchao6891/PromptDirector/issues)时，请说明页面类型、用户可见的问题和复现步骤；提供示例前移除 API Key、私人资料和未获授权的素材。提交代码前请运行 `npm run verify`。

参与开发请阅读[开发指南](docs/DEVELOPMENT.md)和[界面规范](docs/DESIGN.md)。

代码采用 [Apache License 2.0](LICENSE)。第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。代码许可不授予第三方案例素材的使用权。
