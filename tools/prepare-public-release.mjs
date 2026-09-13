import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionArchiveName } from "./release-identity.mjs";
import { readZipBlob } from "../extension/zip.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "extension/manifest.json"), "utf8"));
const name = extensionArchiveName(manifest);
const bytes = await readFile(join(root, "dist", name));
const files = await readZipBlob(new Blob([bytes]));
const packaged = JSON.parse(await files.get("manifest.json").text());
if (packaged.key !== manifest.key || packaged.version !== manifest.version
  || !files.has("local-extension-upgrade.js")) throw new Error("公开安装包缺少固定身份或更新能力");
const directory = join(root, "dist", "github", manifest.version);
await mkdir(directory, { recursive: true });
for (const file of await readdir(directory)) {
  if (![name, "SHA256SUMS"].includes(file)) throw new Error(`公开发布目录包含额外文件：${file}`);
}
await writeFile(join(directory, name), bytes);
await writeFile(join(directory, "SHA256SUMS"), `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`);
process.stdout.write(`${directory}\n`);
