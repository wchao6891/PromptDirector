// Public instance identity scopes pairing; the request never contains the local
// authentication secret or grants browser access by itself.
export function agentConnectionRequest(instanceId, locale, homepage) {
  if (!/^[a-f0-9-]{36}$/u.test(instanceId || '')) throw new Error('无效的资料库编号');
  const repository = new URL(homepage);
  const guide = `${repository.href.replace(/\/$/u, '')}/blob/main/connector/INSTALL.md`;
  return locale === 'en'
    ? `Connect my installed PromptDirector case library. Follow the official setup guide: ${guide}\nLibrary instance: ${instanceId}\nIdentify your host and whether you can run on my computer, install and configure the connector while preserving other MCP settings, then verify with a real library search. Ask me to enable the connection in Chrome when necessary. Do not report success from configuration alone.`
    : `帮我连接已安装的 PromptDirector 案例库。请按官方安装说明完成：${guide}\n资料库编号：${instanceId}\n请识别当前 Agent 和本机执行环境，自动安装与配置连接器，保留其他 MCP 设置；需要浏览器授权时引导我在插件中启用。最后实际搜索一次案例库验证连接，不能只写好配置就报告成功。`;
}
