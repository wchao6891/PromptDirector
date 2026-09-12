import { AGENT_HOST, AGENT_PROTOCOL_VERSION, AGENT_SETTINGS_KEY } from "./agent-protocol.js";

export function createAgentConnection({ chromeApi, execute }) {
  let port = null;
  let status = "disconnected";
  let error = "";
  let starting = null;
  let generation = 0;
  let preparing = null;
  const alarm = "agent-connection-retry";
  const publish = () => { void chromeApi.storage.session?.set({ agentConnectionStatus: { status, error } }).catch(() => {}); };
  const getSettings = async () => (await chromeApi.storage.local.get(AGENT_SETTINGS_KEY))[AGENT_SETTINGS_KEY] || {};
  const snapshot = async () => {
    const settings = await getSettings();
    return { enabled: settings.enabled === true, instanceId: settings.instanceId || "", status, error, protocolVersion: AGENT_PROTOCOL_VERSION };
  };

  async function prepare() {
    preparing ??= (async () => {
      const settings = await getSettings();
      if (!settings.instanceId) await chromeApi.storage.local.set({ [AGENT_SETTINGS_KEY]: {
        ...settings, enabled: settings.enabled === true, instanceId: crypto.randomUUID()
      } });
      return snapshot();
    })().finally(() => { preparing = null; });
    return preparing;
  }

  async function connect() {
    if (port) return;
    const epoch = generation;
    const settings = await getSettings();
    if (epoch !== generation || !settings.enabled) return;
    if (!await chromeApi.permissions.contains({ permissions: ["nativeMessaging"] })) {
      status = "error"; error = "请在设置中启用 Agent 连接，完成本机通信授权。"; return;
    }
    if (epoch !== generation || !(await getSettings()).enabled) return;
    // Optional permission can be granted while the existing MV3 worker still
    // lacks its native binding. Preserve consent and identity; never restart an
    // extension automatically because it may contain unsaved user work.
    if (typeof chromeApi.runtime.connectNative !== "function") {
      status = "error";
      error = "本机通信已授权，但当前插件后台尚未加载该接口。请先保存正在编辑的内容，再到 Chrome 扩展管理页重新加载 PromptDirector；无需重复授权或重新生成配对编号。";
      publish();
      return;
    }
    status = "connecting"; error = ""; publish();
    const current = chromeApi.runtime.connectNative(AGENT_HOST);
    port = current;
    current.onMessage.addListener(async message => {
      if (port !== current) return;
      if (message?.type === "ready") { status = "connected"; error = ""; publish(); return; }
      if (message?.type !== "request" || typeof message.id !== "string") return;
      let response;
      try {
        if (!(await getSettings()).enabled || port !== current) throw new Error("Agent 连接已关闭");
        response = { id: message.id, result: await execute(message.operation, message.input || {}) };
      } catch (failure) { response = { id: message.id, error: { code: failure.code || "operation_failed", message: failure.message } }; }
      if (port === current) {
        try { current.postMessage({ type: "response", ...response }); } catch { /* Disconnect is reported by onDisconnect. */ }
      }
    });
    current.onDisconnect.addListener(() => {
      const reason = chromeApi.runtime.lastError?.message;
      if (port !== current) return;
      port = null; status = "error";
      error = reason || "本机连接器已断开，请检查连接器安装及配对。";
      publish();
      // Chrome alarm minimum supported by this extension's Chrome >=134.
      void getSettings().then(settings => settings.enabled && chromeApi.alarms.create(alarm, { delayInMinutes: 0.5 }));
    });
    current.postMessage({ type: "hello", protocolVersion: AGENT_PROTOCOL_VERSION,
      instanceId: settings.instanceId, extensionId: chromeApi.runtime.id });
  }
  async function start() {
    starting ??= connect().catch(failure => { status = "error"; error = failure.message; publish(); }).finally(() => { starting = null; });
    await starting;
    return snapshot();
  }
  chromeApi.alarms.onAlarm.addListener(event => { if (event.name === alarm) void start(); });
  chromeApi.runtime.onStartup.addListener(() => void start());
  chromeApi.permissions.onRemoved.addListener(() => void stopIfPermissionRemoved());
  async function stopIfPermissionRemoved() {
    if (!await chromeApi.permissions.contains({ permissions: ["nativeMessaging"] })) await setEnabled(false);
  }
  async function setEnabled(enabled) {
    generation++;
    await prepare();
    const settings = await getSettings();
    await chromeApi.storage.local.set({ [AGENT_SETTINGS_KEY]: {
      enabled: enabled === true, instanceId: settings.instanceId || crypto.randomUUID()
    } });
    if (!enabled) {
      const current = port; port = null; current?.disconnect();
      status = "disconnected"; error = ""; publish();
      await chromeApi.alarms.clear(alarm);
    } else await start();
    return snapshot();
  }
  return { start, snapshot, setEnabled, prepare };
}
