# PromptDirector 本地插件实验室

本模块把正式打包出的固定 ID 开发插件解压后，加载到 Chrome for Testing 的全新隔离资料中，再运行现有完整浏览器回归。它不会读取或修改用户日常 Chrome 资料，也不会使用真实 API Key。

## 运行

```bash
npm run test:local-extension
```

Chrome for Testing 是 Chrome 官方为自动化提供的可复现浏览器。正式品牌版 Chrome 已移除命令行侧载扩展所需的开关，因此本模块不会把无法稳定复现的用户 Chrome 环境伪装成自动化能力。

## 每次运行会证明什么

- 测试对象来自 `npm run package` 生成的 `FIXED-ID-DEV` 插件包，不直接加载源码目录。
- Manifest 公钥、扩展 ID、版本、Service Worker 和三个核心页面来自同一份运行文件。
- 测试浏览器、用户代理和每次运行的结果写入收据，可追溯当时使用的自动化运行时。
- 每条浏览器场景使用全新隔离资料，避免历史状态让结果随机通过或失败。
- 实验室模式默认阻断所有未被场景显式 mock 的外部 HTTPS 请求；漏写 mock 会直接失败，不会误连真实服务或消耗真实额度。
- 收据强制要求模型注册、文字与图片分析、创作台生成、视频生成、异步任务恢复，以及智谱 GLM 五项分析任务与创作台规划链路存在且通过；测试清单若误删关键场景，整次实验室运行会失败。
- 现有本地模型模拟服务会继续覆盖成功、失败、异步轮询和恢复，不消耗真实模型额度。
- 运行结束生成机器可读收据、完整日志和核心页面截图。

证据默认保存在：

```text
dist/local-extension-lab/runs/<运行时间>/
```

`dist/local-extension-lab/latest.json` 指向最近一次结果。整个目录属于可重建产物，不进入 Git。

## 它不能证明什么

- 用户当前安装的 Chrome 插件包和本地实验室完全相同。
- 智谱、OpenAI、Gemini 等真实账号当前可用、计费正确或模型质量达标。
- GitHub Release、Chrome Web Store 上传、审核或线上分发状态。

这些证据必须继续单独记录；本地实验室通过时只能称为“打包插件在 Chrome for Testing 自动验收通过”。
