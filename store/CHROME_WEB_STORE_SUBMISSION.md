# Chrome Web Store submission worksheet

This file is the source-of-truth worksheet for the current PromptDirector manifest. Do not submit a package if `npm run check:store` or the full browser suite is red.

## Stable Web Store identity

- Chrome Web Store item public key: stored in the source `manifest.json` for local identity verification only; `package:release` removes `key` from the upload manifest.
- Expected extension ID: `iahakaahijddcjjldidbclicedibgpjm`.
- Current release candidate: `dist/PromptDirector-1.19.5.zip`.
- Candidate size: `8,959,149` bytes.
- Candidate SHA-256: `7ea497929cdbac7f1704951fb0cbabe5b92c2464f6fae8f31b69887af456d1cd`.
- Generate a candidate only with `npm run package:release`; the command verifies the source public key against the expected identity, then removes `key` from the Web Store upload manifest.

## Store listing

- Chinese copy: `store/LISTING_ZH_CN.md`
- English copy: `store/LISTING_EN.md`
- Public privacy policy URL: `https://wchao6891.github.io/PromptDirector-Curated/privacy.html`
- Homepage URL: `https://wchao6891.github.io/PromptDirector-Curated/`
- Support URL: `https://wchao6891.github.io/PromptDirector-Curated/support.html`
- 128x128 icon: `assets/icons/icon-128.png`
- 440x280 small promo tile: `store/small-promo-440x280.png`
- Screenshots, in order:
  1. `store/screenshots/01-library-1280x800.png`
  2. `store/screenshots/02-skills-1280x800.png`
  3. `store/screenshots/03-composer-1280x800.png`

## Single purpose

Help visual creators capture web visuals with their prompts, media, and notes as a searchable, reusable local creative archive.

Chinese Dashboard value:

> 帮助视觉创作者在用户主动操作下，将网页画面、提示词、媒体和笔记保存为可检索、可复用的本地创作资料，并以这些资料创建创作 Skill 和提示词。

## Permission justifications

- `activeTab`: read only the page on which the user explicitly starts capture, visual selection, or a screenshot action.
- `alarms`: schedule, poll, pause, and resume local background jobs without tracking browsing.
- `contextMenus`: expose the user-triggered right-click capture command.
- `downloads`: save backups, share packages, or media files requested by the user.
- `offscreen`: process screenshots, media, documents, and ZIP archives locally in a short-lived background document.
- `sidePanel`: provide the capture and creation workspace in Chrome's side panel.
- `scripting`: inject bounded capture or selection code only after the user starts that operation.
- `storage`: store the user's local cases, projects, settings, and task state.
- `unlimitedStorage`: retain the images, videos, and documents the user explicitly saves to the local archive.
- `https://wchao6891.github.io/*`: read the official PromptDirector curated catalog, metrics, covers, and previews.
- `https://github.com/*`: read a curated GitHub Release selected by the user and open public feedback or submission pages.
- `https://objects.githubusercontent.com/*`: follow GitHub's Release download path for selected curated content.
- `https://release-assets.githubusercontent.com/*`: download selected curated Release archives and media after integrity checks.
- Optional `<all_urls>`: request only the exact site or AI-service origin needed after the user starts or configures that feature; it is not granted at installation.
- Optional `clipboardRead`: read clipboard content only when the user triggers the relevant action.
- Optional `declarativeNetRequestWithHostAccess`: create bounded media-read rules only on origins the user already granted.

## Chinese permission justifications

- Host permissions: 固定的 GitHub Pages 与 GitHub 域名仅用于读取官方精选目录、封面、审核记录及用户选择下载的精选 Release 包。其他网站和 AI 服务使用可选 `<all_urls>`，只在用户主动采集或配置服务时请求具体来源；不在安装时获得全网访问，也不后台浏览网页。
- `activeTab`: 用户点击扩展、右键菜单、选图或截图后，临时读取当前标签页中的用户可见内容并完成该次采集。不会被动访问其他标签页或后台记录浏览。
- `alarms`: 用于安排、轮询、暂停和恢复用户已启动的本地后台任务，使服务工作器休眠后仍可继续；不用于追踪浏览活动。
- `clipboardRead`: 仅当用户点击从剪贴板提取文字或图片的明确动作时，请求可选权限并读取本次剪贴板内容；不在后台持续读取。
- `contextMenus`: 在网页右键菜单提供用户主动触发的收藏入口，将选中文字或当前页面内容送入本地采集流程。
- `declarativeNetRequestWithHostAccess`: 仅在用户已授予具体站点访问权限、且保存已确认媒体需要调整该次资源请求时，创建范围受限的临时规则；不拦截或修改无关网站流量。
- `downloads`: 将用户明确要求的资料备份、分享包或媒体文件保存到本机下载目录；不会自动下载未知文件。
- `offscreen`: 在短期离屏文档中完成需要 DOM 或 Canvas 的本地处理，例如截图裁剪、缩略图、媒体或文档解析和 ZIP 处理；不显示广告、不追踪用户。
- `scripting`: 仅在用户主动启动网页采集、智能选图或截图时，向当前页面注入随扩展打包的采集或选择脚本；不执行远程代码，不对未授权页面持续注入。
- `sidePanel`: 在 Chrome 侧边栏提供采集、整理和创作工作区，使用户在当前网页旁预览并确认要保存的内容。
- `storage`: 在浏览器扩展本地存储中保存用户的案例、项目、标签、设置、任务状态和用户配置的 AI 服务信息；默认不上传开发者服务器。
- `unlimitedStorage`: 用户可能主动保存大量图片、视频和文档，标准配额不足以可靠保留完整本地创作资料库；权限只用于用户选择保存的本地内容。

## Privacy practices

- Remote code: **No, the extension does not use remote code.** Remote JSON, media, curated archives, and AI responses are treated as data and are never executed as extension code.
- User data: disclose website content and resources, saved source URLs/browsing activity, user-provided prompts/notes/media, and locally stored AI-service authentication information. These categories are handled even when they remain on-device.
- Data transfer: user-selected content is sent only to the AI service or compatible endpoint selected and authorized by the user. Curated catalog and Release requests contain no private library data.
- Limited Use: certify all applicable statements. There is no sale of user data, personalized advertising, analytics collection, or developer-operated content server.

Chinese remote-code declaration:

> 不使用远程代码。所有可执行 JavaScript、CSS、PDF 与文档解析器和 ZIP 逻辑均随扩展包提供。远程 JSON、媒体、精选包和 AI 响应只作为经过校验的数据处理，绝不作为代码执行。

Data types handled, including local-only handling:

- Authentication information: user-configured AI API keys and sending authorization.
- Web browsing activity: source URLs and origins involved in a user-triggered capture.
- Website content and resources: user-selected text, images, videos, documents, and screenshots.
- User-generated content: prompts, notes, cases, projects, tags, Skills, and creative requests.

Do not select personally identifiable information, health information, financial or payment information, location, personal communications, or generic user activity; PromptDirector does not intentionally handle these as product data.

## Final local gate

Run, in order:

```text
npm run verify
npm run test:e2e
npm run package:release
```

Then load the exact release candidate in a clean Chrome profile and visibly verify capture, library search/read-back, Skill creation, Composer, backup/restore, and extension identity before submitting for review.
