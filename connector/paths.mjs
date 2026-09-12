import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { mkdir, lstat, readFile } from "node:fs/promises";

import { privateWindowsDirectory } from "./windows.mjs";

export function connectorRoot() {
  return process.env.PROMPTDIRECTOR_CONNECTOR_HOME || join(homedir(), ".promptdirector");
}
export function instancePaths(root, instance, platform = process.platform) {
  if (!/^[a-f0-9-]{36}$/u.test(instance || "")) throw new Error("请在连接器中配对插件显示的实例编号。");
  const name = createHash("sha256").update(instance).digest("hex").slice(0, 24);
  const socket = platform === "win32"
    ? `\\\\.\\pipe\\promptdirector-${createHash("sha256").update(resolve(root).toLowerCase()).digest("hex").slice(0, 24)}-${name}`
    : join(root, `${name}.sock`);
  // macOS sockaddr_un.sun_path capacity, including terminating NUL.
  if (platform !== "win32" && Buffer.byteLength(socket) > 103) throw new Error("连接目录路径过长，请选择较短的用户私有目录。");
  return { socket, record: join(root, `${instance}.json`) };
}
export async function ensurePrivateRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (process.platform === "win32") {
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("连接目录必须是当前用户的私有目录。");
    await privateWindowsDirectory(root);
    return;
  }
  if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077)) {
    throw new Error("连接目录必须归当前用户所有，且仅当前用户可访问。");
  }
}
export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
