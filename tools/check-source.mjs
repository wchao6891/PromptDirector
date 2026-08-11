import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceDirectories = [projectRoot, join(projectRoot, "tools")];
const sourceFiles = [];

for (const directory of sourceDirectories) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !new Set([".js", ".mjs"]).has(extname(entry.name))) continue;
    sourceFiles.push(join(directory, entry.name));
  }
}

sourceFiles.sort();
for (const file of sourceFiles) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

process.stdout.write(`${sourceFiles.length} 个公开源码文件语法检查通过\n`);
