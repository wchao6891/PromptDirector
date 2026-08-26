# PromptDirector｜视觉创作灵感库

提示词导演，你的视觉创作私人灵感库。

PromptDirector 是一个免费、开源、本地优先的 Chrome 扩展。它把网页文字、图片、视频和文档保存为可检索的创作资料，在下一次图片、视频、广告或分镜创作时快速找回和复用。

## 能做什么

- 高亮网页文字、框选画面或选择页面媒体，将提示词与视觉素材一起保存；
- 在图片优先的资料墙中搜索、筛选、标记和管理案例；
- 保存本地图片、视频、PDF、Markdown、TXT、HTML、视频时间点笔记和快速笔记；
- 用可嵌套的项目树整理案例，并支持组合案例、批量加入或移出项目以及子树分享；
- 浏览经过审核的精选案例，并把需要的内容保存进自己的本地资料库；
- 把案例提炼成可复用的创作 Skill，在创作台组合案例、Skill 和临时附件；
- 生成可编辑的图片或视频提示词，也可以连接自己的服务直接生成媒体；
- 使用可选的文字分析或画面分析，让资料更容易检索；
- 创建可换电脑恢复的完整资料夹备份（包含回收站，并在备份时复制可读取的本机链接原件），或通过加密同步文件夹在自己的设备间恢复资料。

## 隐私与数据

资料、媒体、标签和设置默认保存在当前浏览器。不会创建账号、投放广告或收集使用统计。

文字分析、提示词创作和画面分析均由用户主动开启并使用自己的服务密钥。发送范围会在界面中说明；未选择的资料、整库内容和密钥不会随请求发送。详见[隐私政策](store/PRIVACY_POLICY.md)。

## 安装

普通用户请直接从 [Chrome Web Store 安装 PromptDirector](https://chromewebstore.google.com/detail/iahakaahijddcjjldidbclicedibgpjm)，由商店完成安装与后续自动更新。

需要检查源码或参与开发时，可从 [GitHub Releases](https://github.com/wchao6891/PromptDirector/releases) 下载名称带 `FIXED-ID-DEV` 的最新 ZIP 并解压。在 Chrome 或 Edge 的扩展管理页开启“开发者模式”，选择“加载已解压的扩展程序”，然后选择解压后的目录。这个包保留 Chrome Web Store 分配的固定扩展身份，适合本地开发验证。

不带 `FIXED-ID-DEV` 的同版本 ZIP 仅供维护者上传 Chrome Web Store，清单中按商店要求移除了 `key`，不要把它作为本地解压安装包。升级前请先在“更多 → 备份与同步”创建并验证完整资料夹备份；如曾使用其他扩展 ID，请按[扩展身份迁移说明](docs/EXTENSION_ID_MIGRATION.md)恢复资料。

## 从源码构建

需要 Node.js 20 或更高版本。

```sh
npm install
npm run verify
```

`npm run verify` 是唯一正式发布门槛：先完成源码、资源与单元测试，再跑完整浏览器 E2E，全部通过后才生成商店包；任一阶段失败都不会进入打包。只需快速检查源码时可运行 `npm run verify:source`。`npm run package` 生成保留固定身份的本地安装包；`npm run package:release` 生成移除 `key` 的 Chrome Web Store 上传包。两者包含相同的运行代码，只有安装身份用途不同。正式身份缺失时命令会明确失败，避免用户资料被错误扩展 ID 隔离。

当前浏览器兼容边界和已确认但延期的增强记录在 [已知限制](docs/KNOWN_LIMITATIONS.md)。

## 参与与许可

欢迎其他开发者共同维护 PromptDirector，包括修复问题、补充测试与文档、改善交互和完善跨浏览器体验。提交前请运行 `npm run verify`。

提交 issue 或代码时请说明用户可观察到的行为、复现方式和验证结果。请不要在 issue、日志、测试样本或提交中包含 API Key、私人来源、未授权素材或用户资料。

本项目采用 [Apache License 2.0](LICENSE)。第三方组件说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
