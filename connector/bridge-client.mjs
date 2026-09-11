import net from "node:net";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { connectorRoot, instancePaths, readJson, ensurePrivateRoot } from "./paths.mjs";
import { encodeFrame, frameDecoder } from "./framing.mjs";

export async function callExtension(operation, input = {}, { root = connectorRoot(), timeoutMs = 30000 } = {}) {
  await ensurePrivateRoot(root);
  let instance;
  try { instance = process.env.PROMPTDIRECTOR_INSTANCE || (await readJson(join(root, "selected.json"))).instanceId; }
  catch { throw new Error("尚未配对资料库，请在插件启用 Agent 连接后运行连接器配对。"); }
  const paths = instancePaths(root, instance);
  const record = await readJson(paths.record);
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = net.connect(paths.socket);
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("插件响应超时；写入任务请按原请求编号查询，不要重新提交不同编号。")), timeoutMs);
    const decode = frameDecoder(message => {
      if (message.type === "ready") {
        if (message.instanceId !== instance || message.protocolVersion !== 1) return finish(new Error("连接的资料库或协议不匹配。"));
        socket.write(encodeFrame({ type: "request", id, operation, input }));
      } else if (message.id === id) {
        finish(message.error ? Object.assign(new Error(message.error.message), { code: message.error.code }) : null, message.result);
      }
    });
    socket.once("connect", () => socket.write(encodeFrame({ type: "authenticate", secret: record.secret })));
    socket.on("data", data => { try { decode(data); } catch (error) { finish(error); } });
    socket.on("error", () => finish(new Error("未连接到指定资料库，请确认 Chrome 已运行且插件的 Agent 连接已启用。")));
    socket.on("close", () => finish(new Error("插件连接已断开；重新连接后可用原请求编号查询写入结果。")));
  });
}
