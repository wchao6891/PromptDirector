import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../node_modules/@noble/hashes/", import.meta.url);
const target = new URL("../vendor/noble-hashes/", import.meta.url);
const check = process.argv.includes("--check");
const files = ["sha2.js", "_md.js", "_u64.js", "utils.js", "LICENSE"];
if (!check) await mkdir(target, { recursive: true });
for (const name of files) {
  const bytes = await readFile(new URL(name, source));
  const path = new URL(name, target);
  if (check) {
    if (!bytes.equals(await readFile(path))) throw new Error(`哈希运行时与锁定依赖不一致：${fileURLToPath(path)}`);
  } else await writeFile(path, bytes);
}
process.stdout.write(check ? "哈希运行时与锁定依赖一致\n" : "已同步流式哈希运行时\n");
