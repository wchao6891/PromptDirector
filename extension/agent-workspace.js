import { agentError, requireInteger } from "./agent-protocol.js";

export function createAgentWorkspace({ chromeApi, readCase, readSelection }) {
  const libraryUrl = chromeApi.runtime.getURL("library.html");
  const composerUrl = chromeApi.runtime.getURL("composer.html");
  async function contexts() {
    const values = await chromeApi.runtime.getContexts({ contextTypes: ["TAB"] });
    return values.filter(item => [libraryUrl, composerUrl].includes(item.documentUrl?.split(/[?#]/u)[0]))
      .map(item => ({ tabId: item.tabId, surface: item.documentUrl.split(/[?#]/u)[0] === libraryUrl ? "library" : "composer" }));
  }
  return {
    async read(input = {}) {
      if (input.tabId === undefined && input.source !== "page") return readSelection(input);
      if (input.tabId !== undefined) requireInteger(input.tabId);
      const available = await contexts();
      if (!available.length) return { state: "no_workspace", contexts: [], message: "请打开案例库或创作台，再读取当前选择。" };
      if (input.tabId === undefined && available.length > 1) {
        return { state: "choose_workspace", contexts: available, message: "多个工作页面已打开，请明确要接续的页面；不要合并各页选择。" };
      }
      const context = input.tabId === undefined ? available[0] : available.find(item => item.tabId === input.tabId);
      if (!context) throw agentError("workspace_closed", "该工作页面已关闭，请重新发现工作现场。");
      let response;
      try { response = await chromeApi.runtime.sendMessage({ type: "AGENT_READ_WORKSPACE", tabId: context.tabId, input }); }
      catch { throw agentError("workspace_unavailable", "工作页面尚未就绪，请稍后重读；旧页面需刷新后接续。"); }
      if (!response) throw agentError("workspace_unavailable", "工作页面尚未就绪，请刷新该页面后重读。");
      if (!response.ok) throw agentError(response.code, response.message);
      return { state: "ready", tabId: context.tabId, ...response.result };
    },
    async show({ caseId }) {
      // Check existence through the same case service used by the MCP reader.
      await readCase({ caseId });
      const openUrl = `${libraryUrl}?case=${encodeURIComponent(caseId)}`;
      const tab = await chromeApi.tabs.create({ url: openUrl, active: true });
      await chromeApi.windows.update(tab.windowId, { focused: true });
      return { state: "opening", caseId, tabId: tab.id, openUrl, displayVerified: false,
        next: "用 read_workspace_context 读取此 tabId，viewedCaseId 相符才表示详情已显示。新页面不改变原页面的选择或未保存编辑。" };
    }
  };
}
