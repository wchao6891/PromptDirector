import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { installationPlan, install } from './install.mjs';
import { hostConfiguration, configurationPlan, writeConfiguration } from './host-config.mjs';
import { discoverLibraries } from './discovery.mjs';
import { connectorRoot, instancePaths } from './paths.mjs';
import { windowsRuntimeEnvironment } from './windows.mjs';
import { isMain } from './is-main.mjs';

export function mcpConfiguration(root, instanceId) {
  if (instanceId) instancePaths(root, instanceId);
  return { command: process.execPath, args: [join(root, 'runtime/mcp.mjs')],
    env: { ...(process.platform === 'win32' ? windowsRuntimeEnvironment() : {}), PROMPTDIRECTOR_CONNECTOR_HOME: root, ...(instanceId ? { PROMPTDIRECTOR_INSTANCE: instanceId } : {}) } };
}
export async function setupPlan({ host, root = connectorRoot(), instanceId, home = homedir(), env = process.env, nativeDirectory, extensionId } = {}) {
  const installation = await installationPlan({ root, nativeDirectory, extensionId });
  const mcp = mcpConfiguration(installation.root, instanceId);
  const configuration = await configurationPlan(hostConfiguration(host, { home, env }), mcp);
  return { installation, configuration, instanceId, mcp };
}
function value(result) {
  const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('');
  if (result.isError) throw new Error(text || 'MCP 调用失败');
  return JSON.parse(text);
}
export async function verifyConnection({ root = connectorRoot(), instanceId, probe = discoverLibraries, onProgress = stage => { if (process.env.PROMPTDIRECTOR_DEBUG) console.error(`[PromptDirector verify] ${stage}`); } } = {}) {
  onProgress('library-discovery');
  const libraries = await probe({ root, instanceId });
  if (!libraries.length) return { state: 'awaiting_browser', connected: false,
    next: '在已安装 PromptDirector 的 Chrome 中打开设置 → Agent 连接 → 启用。若已启用请断开再启用；浏览器要求重新加载时先保存未完成编辑，然后重试 verify。' };
  if (libraries.length > 1) return { state: 'library_selection_required', connected: false, libraries,
    next: '请从目标案例库复制连接指令，使用其中的 instance 参数；不要猜测用户要连接哪个资料库。' };
  const selected = libraries[0].instanceId;
  const mcp = mcpConfiguration(root, selected);
  const client = new Client({ name: 'promptdirector-setup-check', version: '1' });
  try {
    onProgress('mcp-start');
    await client.connect(new StdioClientTransport(mcp));
    onProgress('mcp-tools');
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name);
    for (const required of ['promptdirector_status', 'promptdirector_search_cases', 'promptdirector_read_case', 'promptdirector_read_media']) {
      if (!names.includes(required)) throw new Error(`MCP 缺少所需能力：${required}`);
    }
    onProgress('library-status');
    const status = value(await client.callTool({ name: 'promptdirector_status', arguments: {} }));
    if (status.instanceId !== selected || !status.enabled || status.status !== 'connected') throw new Error('MCP 返回的资料库与目标不一致或尚未连接。');
    onProgress('library-search');
    const result = value(await client.callTool({ name: 'promptdirector_search_cases', arguments: { query: '', limit: 3 } }));
    if (!Array.isArray(result.cases) || !Number.isInteger(result.total)) throw new Error('案例搜索未返回有效结果。');
    return { state: 'connector_verified', connected: true, instanceId: selected, mcp,
      extensionVersion: status.extensionVersion, caseCount: result.total, sampleCases: result.cases,
      hostSessionVerified: false,
      next: '连接器已实际查询案例库。还需在当前 Agent 会话发现 promptdirector 工具并调用 status/search_cases；如需重载请使用宿主正常入口。只有当前会话实际调用成功后才报告已连接；需要展示案例时按返回的媒体编号读取原件。' };
  } finally { onProgress('mcp-close'); await client.close(); onProgress('mcp-closed'); }
}
export async function connect(options, { installRuntime = install, verify = verifyConnection } = {}) {
  const plan = await setupPlan(options);
  await installRuntime(plan.installation);
  const configured = plan.instanceId ? await writeConfiguration(plan.configuration)
    : { changed: false, state: 'awaiting_pairing' };
  const checked = await verify({ root: plan.installation.root, instanceId: plan.instanceId });
  // Bind a discovered single library explicitly so another Chrome profile cannot
  // later redirect this host through the global selected.json preference.
  let finalConfiguration = configured;
  if (!plan.instanceId && checked.connected) {
    finalConfiguration = await writeConfiguration(await configurationPlan(
      hostConfiguration(options.host, { home: options.home, env: options.env }), checked.mcp));
  }
  return { ...checked, configuration: finalConfiguration, mcp: checked.mcp || (plan.instanceId ? plan.mcp : undefined),
    skill: join(plan.installation.runtime, 'SKILL.md') };
}
function optionsFrom(args) {
  const options = {};
  const keys = { '--host': 'host', '--instance': 'instanceId', '--root': 'root' };
  for (let index = 0; index < args.length; index += 2) {
    const key = keys[args[index]];
    if (!key || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('用法：node connector/setup.mjs plan|connect|verify --host codex|claude|workbuddy|generic [--instance 编号] [--root 私有目录]');
    options[key] = args[index + 1];
  }
  return options;
}
if (isMain(import.meta.url)) {
  try {
    const [command = 'plan', ...args] = process.argv.slice(2);
    const options = optionsFrom(args);
    let result;
    if (command === 'plan') {
      const plan = await setupPlan(options);
      result = { installation: plan.installation, configuration: { path: plan.configuration.path, changed: plan.configuration.changed, host: plan.configuration.host }, mcp: plan.instanceId ? plan.mcp : undefined };
    } else if (command === 'connect') result = await connect(options);
    else if (command === 'verify') result = await verifyConnection(options);
    else throw new Error('未知命令，请使用 plan、connect 或 verify。');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    // Configuration files can contain credentials. Never echo their contents.
    console.error(JSON.stringify({ state: 'failed', connected: false, message: error.message })); process.exitCode = 1;
  }
}
