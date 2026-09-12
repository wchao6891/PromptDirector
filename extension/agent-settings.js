import { currentLocale } from './i18n.js';
import { agentConnectionRequest } from './agent-onboarding.js';

const button = document.getElementById('toggle-agent-connection');
const status = document.getElementById('agent-connection-status');
const feedback = document.getElementById('agent-connection-feedback');
const help = document.getElementById('agent-connection-help');
const copy = (zh, en) => currentLocale() === 'en' ? en : zh;
let connection = {};
async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'GET_AGENT_CONNECTION' });
  if (!result?.ok) throw new Error(result?.message || copy('无法读取连接状态', 'Cannot read connection status'));
  connection = result.connection;
  status.textContent = connection.status === 'connected' ? copy('连接器就绪', 'Connector ready')
    : connection.status === 'connecting' ? copy('连接中…', 'Connecting…')
      : connection.status === 'error' ? copy('连接异常', 'Connection error') : copy('未连接', 'Disconnected');
  button.textContent = connection.enabled ? copy('断开', 'Disconnect') : copy('启用', 'Enable');
  const connected = connection.status === 'connected';
  help.hidden = connected;
  feedback.textContent = connected ? '' : connection.error || '';
}
document.getElementById('copy-agent-connection').addEventListener('click', async () => {
  try {
    const result = await chrome.runtime.sendMessage({ type: 'PREPARE_AGENT_CONNECTION' });
    if (!result?.ok) throw new Error(result?.message || copy('无法准备连接', 'Cannot prepare connection'));
    await navigator.clipboard.writeText(agentConnectionRequest(result.connection.instanceId, currentLocale(), chrome.runtime.getManifest().homepage_url));
    feedback.textContent = copy('已复制。粘贴给你的 Agent，让它安装并连接；需要时在这里点击启用完成授权。', 'Copied. Paste into your Agent to install and connect. Enable here when browser permission is needed.');
  } catch (error) { feedback.textContent = error.message; }
});
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    if (!connection.enabled) {
      // Request directly in the user's click handler, before awaiting anything.
      const granted = await chrome.permissions.request({ permissions: ['nativeMessaging'], origins: ['<all_urls>'] });
      if (!granted) throw new Error(copy('尚未授权，Agent 连接未启用。', 'Permission was not granted. Agent connection remains disabled.'));
    }
    const result = await chrome.runtime.sendMessage({ type: 'SET_AGENT_CONNECTION', enabled: !connection.enabled });
    if (!result?.ok) throw new Error(result?.message || copy('无法更新连接', 'Cannot update connection'));
    await refresh();
  } catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; }
});
const observer = new MutationObserver(() => {
  if (dialog?.open) void refresh().catch(error => { feedback.textContent = error.message; });
});
const dialog = button.closest('dialog');
if (dialog) observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'session' && changes.agentConnectionStatus) || (area === 'local' && changes.agentConnection)) void refresh().catch(() => {});
});
window.addEventListener('focus', () => void refresh().catch(() => {}));
void refresh().catch(error => { feedback.textContent = error.message; });
