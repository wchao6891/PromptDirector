import net from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { connectorRoot, instancePaths, readJson, ensurePrivateRoot } from "./paths.mjs";
import { encodeFrame, frameDecoder } from "./framing.mjs";

export const CONNECTOR_TIMEOUT_MS = 30000;

export async function callExtension(operation, input = {}, { root = connectorRoot(), timeoutMs = CONNECTOR_TIMEOUT_MS, instanceId, expectedHostSession, onHostSession } = {}) {
  const id = randomUUID();
  const request = encodeFrame({ type: 'request', id, operation, input });
  await ensurePrivateRoot(root);
  let instance;
  try { instance = instanceId || process.env.PROMPTDIRECTOR_INSTANCE || (await readJson(join(root, "selected.json"))).instanceId; }
  catch { throw new Error("尚未配对资料库，请在插件启用 Agent 连接后运行连接器配对。"); }
  const paths = instancePaths(root, instance);
  let record;
  try { record = await readJson(paths.record); }
  catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('未找到该资料库的配对记录，请在插件启用 Agent 连接后重新运行连接器配对。'), { code: 'ENOENT' });
    throw Object.assign(new Error('资料库配对记录无法读取，请检查本机连接器记录。'), { code: 'invalid_pairing_record' });
  }
  return new Promise((resolve, reject) => {
    const socket = net.connect(paths.socket);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(Object.assign(new Error("插件响应超时；写入任务请按原请求编号查询，不要重新提交不同编号。"), { code: "connector_timeout" })), timeoutMs);
    const decode = frameDecoder(message => {
      if (message.type === "ready") {
        if (message.instanceId !== instance || message.protocolVersion !== 1) return finish(new Error("连接的资料库或协议不匹配。"));
        // The request is not sent, so the caller can re-check capabilities against the reloaded extension.
        if (expectedHostSession && message.hostSessionId !== expectedHostSession) {
          return finish(Object.assign(new Error("插件已重新加载，需要重新核对能力。"), { code: "connector_session_changed" }));
        }
        onHostSession?.(message.hostSessionId);
        socket.write(request);
      } else if (message.id === id) {
        finish(message.error ? Object.assign(new Error(message.error.message), { code: message.error.code }) : null, message.result);
      }
    });
    socket.once("connect", () => socket.write(encodeFrame({ type: "authenticate", secret: record.secret })));
    socket.on("data", data => { try { decode(data); } catch (error) { finish(error); } });
    socket.on("error", error => {
      const denied = ["EPERM", "EACCES"].includes(error.code);
      finish(Object.assign(new Error(denied
        ? "当前运行环境没有权限访问本机连接。请检查 Agent 的本机访问权限；这不代表插件已离线。"
        : "未连接到指定资料库，请确认 Chrome 已运行且插件的 Agent 连接已启用。"),
      { code: denied ? "connector_access_denied" : "connector_offline" }));
    });
    socket.on("close", () => finish(Object.assign(new Error("插件连接已断开；重新连接后可用原请求编号查询写入结果。"), { code: "connector_offline" })));
  });
}
