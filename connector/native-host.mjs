import { isMain } from "./is-main.mjs";
import net from "node:net";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, lstat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { connectorRoot, ensurePrivateRoot, instancePaths, readJson } from "./paths.mjs";
import { encodeFrame, frameDecoder, NATIVE_TO_CHROME_MAX } from "./framing.mjs";

export async function startNativeHost({ root = connectorRoot(), origin, input = process.stdin, output = process.stdout } = {}) {
  await ensurePrivateRoot(root);
  const config = await readJson(join(root, "config.json"));
  if (origin !== `chrome-extension://${config.extensionId}/`) throw new Error("Native host extension identity mismatch.");
  const sockets = new Set();
  const pending = new Map();
  let server;
  let paths;
  let initializing = false;
  let ownsSocket = false;
  let closed = false;
  const send = value => output.write(encodeFrame(value));
  async function close() {
    if (closed) return;
    closed = true;
    for (const socket of sockets) socket.destroy();
    pending.clear();
    if (server) await new Promise(resolve => server.close(resolve));
    if (ownsSocket) await unlink(paths.socket).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  async function initialize(message) {
    if (initializing || server) throw new Error("Duplicate native handshake.");
    initializing = true;
    if (message.protocolVersion !== 1 || message.extensionId !== config.extensionId) throw new Error("Connector protocol/extension mismatch.");
    paths = instancePaths(root, message.instanceId);
    let record;
    try { record = await readJson(paths.record); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (!record) {
      record = { instanceId: message.instanceId, secret: randomBytes(32).toString("hex") };
      await writeFile(paths.record, JSON.stringify(record), { mode: 0o600, flag: "wx" });
    }
    if (record.instanceId !== message.instanceId || !/^[a-f0-9]{64}$/.test(record.secret)) throw new Error("Invalid library pairing record.");
    if (closed) return;
    // Do not unlink an existing live profile endpoint. Only a verified stale
    // socket owned by this user may be removed after an ECONNREFUSED probe.
    try {
      const info = await lstat(paths.socket);
      if (!info.isSocket() || info.uid !== process.getuid()) throw new Error("Unsafe connector endpoint.");
      await new Promise((resolve, reject) => {
        const probe = net.connect(paths.socket);
        probe.once("connect", () => { probe.destroy(); reject(new Error("This library is already connected.")); });
        probe.once("error", error => error.code === "ECONNREFUSED" ? resolve() : reject(error));
      });
      await unlink(paths.socket);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (closed) return;
    server = net.createServer(socket => {
      sockets.add(socket);
      let authenticated = false;
      const decode = frameDecoder(value => {
        if (!authenticated) {
          const actual = Buffer.from(typeof value.secret === "string" ? value.secret : "");
          const expected = Buffer.from(record.secret);
          if (value.type !== "authenticate" || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            socket.destroy(); return;
          }
          authenticated = true;
          socket.write(encodeFrame({ type: "ready", instanceId: message.instanceId, protocolVersion: 1 }));
          return;
        }
        if (value.type !== "request" || typeof value.id !== "string" || typeof value.operation !== "string") throw new Error("Invalid request.");
        const id = randomUUID();
        pending.set(id, { socket, clientId: value.id });
        send({ type: "request", id, operation: value.operation, input: value.input });
      }, NATIVE_TO_CHROME_MAX);
      socket.on("data", data => { try { decode(data); } catch { socket.destroy(); } });
      socket.on("error", () => {});
      socket.on("close", () => {
        sockets.delete(socket);
        for (const [id, value] of pending) if (value.socket === socket) pending.delete(id);
      });
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(paths.socket, resolve); });
    ownsSocket = true;
    if (closed) { server.close(); await unlink(paths.socket).catch(() => {}); return; }
    await chmod(paths.socket, 0o600);
    send({ type: "ready" });
  }
  const decode = frameDecoder(message => {
    if (message?.type === "hello") {
      void initialize(message).catch(failure => { console.error(failure.message); void close().finally(() => input.destroy()); });
    } else if (message?.type === "response") {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      request.socket.write(encodeFrame({ ...message, id: request.clientId }, 64 * 1024 * 1024));
    }
  });
  input.on("data", data => { try { decode(data); } catch (error) { console.error(error.message); void close().finally(() => input.destroy()); } });
  input.on("end", () => void close());
  input.on("error", () => void close());
  return { close };
}

if (isMain(import.meta.url)) {
  startNativeHost({ origin: process.argv[2] }).then(host => {
    process.on("SIGTERM", () => void host.close().finally(() => process.exit(0)));
    process.on("SIGINT", () => void host.close().finally(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
