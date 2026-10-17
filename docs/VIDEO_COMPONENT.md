# Video component / 视频组件

## 使用

先照常打开网页并在采集侧栏保存。能直接保存的视频无需安装组件。

当侧栏提示需要视频组件时：

1. 点击“安装视频组件”，允许浏览器所需权限。插件自动选择 Windows 或 macOS 安装包。
2. 下载结束后点击“打开安装包”，按系统提示完成安装。
3. 返回插件，刚才的采集自动继续。关闭侧栏后重新打开也能接续。

不需要安装开发工具、填写路径或连接 Agent。“取消保存”只取消这次保存，待保存内容继续保留；之后安装组件也不会自动提交已取消的任务。

Windows 安装包支持 Windows 10/11 x64；macOS 通用安装包支持 macOS 11 或更新系统的 Apple 芯片与 Intel 机型。Windows 的组件可以在系统“已安装的应用”中卸载，不删除浏览器资料库。

没有联网、安装被系统阻止或安装包尚未发布时，侧栏显示具体状态，待保存内容保持；不会改为保存在线播放。“仅保存在线播放”由用户在设置中主动开启，默认关闭。

## Use

Save from the capture sidebar as usual. Videos with a directly available original need no component. If prompted, select **Install video component**, approve the browser permissions, then **Open installer** and follow the system prompts. Saving resumes automatically after installation, including after reopening the sidebar. No developer tools, paths or Agent pairing are required. Cancelling a save preserves the capture and prevents automatic submission after installation.

Windows: Windows 10/11 x64. macOS: 11 or newer, Apple silicon and Intel in one universal installer. The online-only preference remains off unless explicitly enabled.

## Build and distribution

The installers contain Node.js, the official standalone yt-dlp executable (including its YouTube JavaScript components), and FFmpeg/FFprobe compiled from the pinned FFmpeg source with OS networking libraries. They do not rely on system PATH or install a package manager. Runtime tools are local subprocesses, not remotely loaded extension code.

Run `npm run package:video-component` on macOS or Windows. On macOS, `node tools/video-component/build.mjs --target=win` also supports a cross build using MinGW-w64 and NSIS. On Windows, supply `VIDEO_MSYS_BASH` and optionally `VIDEO_MSYS_PREFIX` for the MSYS2 build environment, plus `VIDEO_MAKENSIS` if NSIS is not on PATH. Dependency downloads are pinned by URL and SHA-256 in `tools/video-component/dependencies.json`; each offline installer includes the FFmpeg source, build recipe and third-party notices.

The independent native host is `com.promptdirector.video`. It exposes video operations only and does not alter the Agent connector or pairing.

Output files have stable names in `dist/video-component/`; the extension uses the versioned release tag in `extension/video-component-config.js`. Version, tag and native protocol must be updated together when distributing an incompatible component.

For macOS distribution, set `VIDEO_MAC_APPLICATION_IDENTITY`, `VIDEO_MAC_INSTALLER_IDENTITY` and `VIDEO_MAC_NOTARY_PROFILE` to identities and a notary profile already configured in the build keychain. For Windows, sign on Windows using `VIDEO_WINDOWS_CERTIFICATE_SHA1`, `VIDEO_WINDOWS_TIMESTAMP_URL` and optionally `VIDEO_SIGNTOOL`. Passwords and private signing material are never command-line arguments in the build scripts.

`node tools/video-component/verify-release.mjs` refuses unsigned or unnotarized build reports. The installer CI builds and checks installation, the native protocol and Windows uninstallation on disposable runners; it does not publish. A local unsigned build is for development, not a completed beginner distribution. Publish both signed assets to the configured tag only after platform installation checks. Until that release exists, the extension reports that the installer is unpublished and preserves the capture.

References: [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging), [opening downloaded installers](https://developer.chrome.com/docs/extensions/reference/api/downloads#method-open), [yt-dlp standalone releases](https://github.com/yt-dlp/yt-dlp#release-files), [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), [NSIS](https://nsis.sourceforge.io/Docs/Chapter3.html).
