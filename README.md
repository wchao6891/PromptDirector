<p align="center"><img src="docs/assets/github-banner.svg" alt="PromptDirector — Capture, collect, organize" width="100%"></p>

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

<h1 align="center">Turn great references into your next creation.</h1>

<p align="center"><strong>One-click capture. A visual prompt library. Ready for your Agent.</strong><br>Collect from Jimeng, Higgsfield, X, HeyBox, WeChat articles, Feishu docs and more.<br>Keep the image, the prompt and the context — then put them to work in your next project.</p>

<p align="center"><a href="https://github.com/wchao6891/PromptDirector/releases/latest"><strong>Download the latest release</strong></a> · <a href="https://wchao6891.github.io/PromptDirector-Curated/">Explore curated cases</a> · <a href="#install-and-update">Installation guide</a></p>

<p align="center">Free & open source · Local first · No account required · Local MCP Agent access</p>

## Found a great reference? Start capturing in one click.

**Keep the work and the creative clues behind it.** PromptDirector is a Chrome extension for visual creators. Collect images, videos, text, prompts and sources into a library you can browse visually, organize by project and bring into your next creative conversation.

**Open a work, post or article → Capture → Preview and select → Save cases.**

| Where inspiration lives | What you can bring with you |
| --- | --- |
| **Jimeng · Higgsfield · LiblibAI · Krea · LibTV** | Work images, videos and publicly available prompts or creative details. Keep the visual and its context together. |
| **HeyBox / 小黑盒 · WeChat articles** | Save a whole article or split clearly structured multi-case posts into selectable image-and-prompt groups. Keep a single HeyBox image gallery with its prompt from the post body. |
| **Feishu documents** | Capture document bodies, long documents and images within tables, preserving cell placement and merged cells. |
| **X / Twitter · Xiaohongshu · Weibo · Reddit** | Collect the current post's text and accessible media, including prompts shared by the author. |
| **Pinterest · Behance · ArtStation · Huaban · ZCOOL** | Bring visual work into one place to browse, search and organize. |
| **More webpages and local files** | General webpage capture, text and image selection, screenshots and local imports help gather scattered materials. |

### One article. A collection of individual references.

For articles with clear case headings or numbering, preview the detected groups under **Cases in article**, select the cases you want and save them individually. Review each image-and-prompt group before saving, or keep the whole article for context.

### Keep the context that makes a reference useful.

Multi-image works stay grouped, articles retain media order and Feishu tables retain their layout. Media, text, original prompts, sources and later analysis have their own place, ready to revisit or use with a model.

Capture, browsing and organization require no AI service. Pages must be accessible and original prompts must be public; login state, lazy loading and site changes can affect results. Preview before saving. Videos are saved locally when a complete file is accessible; supported standalone players and HLS streams can play in the library. See the [capture guide](docs/CAPTURE_SUPPORT.md).

## Your eye chooses. Your Agent takes it further.

**Connect your library to Codex, Claude Code or WorkBuddy.** Search references, read prompts, retrieve originals, capture URLs and save creative materials back to the library through your Agent conversation.

1. Select **Copy connection request** in the extension's **Settings → Agent connection**.
2. Paste it into an Agent with local MCP support so it can install, configure and verify the connector.
3. Enable the connection in Chrome when prompted, then start using your library.

Try requests like:

> “Find character-poster references in my library and list a few options for me to choose.”
>
> “Read the selected cases' original images and prompts, then use them to draft this campaign's visual direction.”
>
> “Save the approved prompt and generated images back to PromptDirector.”

**Google Chrome on Windows, macOS and Linux.** Configuration entry points are provided for Codex, Claude Code and WorkBuddy; other local MCP clients can use the generic configuration. The Agent installs a separate local connector, and the first connection requires browser authorization. Cloud-only workspaces cannot use this local flow. Creative and generation capabilities depend on your Agent and its tools. [Agent setup guide →](connector/INSTALL.md)

## Build a library that grows with your creative practice

| What your next project needs | What your library provides |
| --- | --- |
| **A reference you can recognize at a glance** | An image-first case wall, text search and tag filters. Browse the work and choose for yourself. |
| **A focused collection for each project** | Nested projects, related cases and batch management to keep a creative task's materials together. |
| **Experience you can reuse** | The Composer reads selected cases and drafts editable prompts, reusable Skills and tag suggestions for your review. |
| **Room for more than images** | Local images, videos, PDFs, Markdown, TXT, HTML and timestamped video notes. |
| **A collection you can share and preserve** | Export cases or project subtrees, create full folder backups, recover on another computer and use encrypted folder sync. |

AI analysis is optional and uses your own service. Selected references help communicate the visual direction you want; only selected or explicitly requested original images are sent to a model. You can also use PromptDirector entirely as a visual reference library.

## Start with curated references

See the image, read the prompt and save what fits your project. Here are a few examples from the current public collection.

<table>
<tr>
<td width="33%"><a href="https://wchao6891.github.io/PromptDirector-Curated/"><img src="https://wchao6891.github.io/PromptDirector-Curated/previews/featured-cases-vol-1/media/133a11be119a75a17b40-fe515974461558ef.webp" alt="Celestial ensemble: composition and staging reference"></a></td>
<td width="33%"><a href="https://wchao6891.github.io/PromptDirector-Curated/"><img src="https://wchao6891.github.io/PromptDirector-Curated/previews/featured-cases-vol-1/media/a2b45b757798adb2685d-8dea3cc7d3e303fd.webp" alt="War-tent confrontation: character blocking and lighting reference"></a></td>
<td width="33%"><a href="https://wchao6891.github.io/PromptDirector-Curated/"><img src="https://wchao6891.github.io/PromptDirector-Curated/previews/featured-cases-vol-1/media/6652ed14274cd7be008f-73367e80019b085c.webp" alt="Foxfire paper shadows: material and style reference"></a></td>
</tr>
<tr><td>Celestial ensemble</td><td>War-tent confrontation</td><td>Foxfire paper shadows</td></tr>
</table>

[Browse the curated library →](https://wchao6891.github.io/PromptDirector-Curated/)

These are curated content previews, not demonstrations of platform capture. Refer to each case's source and rights information before reusing its media.

## Your library stays yours

Cases, media, tags and settings are stored in your current browser by default. No account, ads or usage analytics. AI features are opt-in and use your own service keys; the interface explains what will be sent. Read the [privacy policy](store/PRIVACY_POLICY.md).

## Install and update

**For a local installation, download the `FIXED-ID-DEV` ZIP and load its extracted folder in Chrome or Edge.**

<details>
<summary>Full installation and in-place update instructions</summary>

1. Open the [latest GitHub release](https://github.com/wchao6891/PromptDirector/releases/latest) and download the ZIP with `FIXED-ID-DEV` in its name.
2. Extract the extension files into a permanent folder named `PromptDirector`, without a version number. `manifest.json` must be at the folder's top level.
3. Open Chrome or Edge's extension management page, enable **Developer mode**, select **Load unpacked**, and choose that folder.

The `FIXED-ID-DEV` package keeps the extension's fixed identity. The ZIP without `FIXED-ID-DEV` is for Chrome Web Store submission and omits the manifest key; use the fixed-ID package for local installation. If you previously used a different extension ID, follow the [identity migration guide](docs/EXTENSION_ID_MIGRATION.md).

**Updating an existing local installation:** In Settings, check for updates and select the local upgrade action. On first use, choose and authorize the folder Chrome currently loads. Keep that existing location, even if its name contains an old version. After updating, restart the extension, verify the version in Settings and run the temporary-file cleanup action if shown. Cases and media continue to use the same browser library.

For older versions without the updater, overwrite the program files in the original installation folder with the latest `FIXED-ID-DEV` package, then reload the extension. Keep the existing extension and identity. A routine update does not require uninstalling, exporting or reimporting cases. Source checkouts update through Git.

You can also install through the [Chrome Web Store](https://chromewebstore.google.com/detail/iahakaahijddcjjldidbclicedibgpjm), which manages subsequent updates.

</details>



## Contribute and license

Contributions to capture adaptations, interactions, tests and documentation are welcome. When [reporting an issue](https://github.com/wchao6891/PromptDirector/issues), describe the page type, observable behavior and reproduction steps. Remove API keys, private data and unauthorized media from examples. Run `npm run verify` before submitting code.

See the [development guide](docs/DEVELOPMENT.md) to build and test contributions.

Code is licensed under [Apache License 2.0](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependencies. The code license does not grant rights to third-party case media.
