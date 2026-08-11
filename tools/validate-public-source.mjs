import { access, readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const privateWorkspaceDirectories = [
  ".local-imports",
  ".omx",
  ".scratch",
  "private-evals",
  "plan",
  join("docs", "adr"),
  join("docs", "lessons"),
  join("docs", "research")
];

const privateWorkspaceFiles = ["CONTEXT.md", "context.md"];

const presentPrivateDirectories = [];
for (const path of privateWorkspaceDirectories) {
  if (await exists(join(projectRoot, path))) presentPrivateDirectories.push(path);
}
if (presentPrivateDirectories.length) {
  throw new Error(`公开源码树包含内部工作目录：${presentPrivateDirectories.join(", ")}`);
}

const presentPrivateFiles = [];
for (const path of privateWorkspaceFiles) {
  if (await exists(join(projectRoot, path))) presentPrivateFiles.push(path);
}
if (presentPrivateFiles.length) {
  throw new Error(`公开源码树包含内部上下文文件：${presentPrivateFiles.join(", ")}`);
}

const markdownFiles = await collectMarkdown(projectRoot);
const localPathPattern = /\/Users\/(?!<[^>]+>)[^/\s`]+\/|\/private\/tmp\//;
const leakedPaths = [];
for (const file of markdownFiles) {
  const text = await readFile(file, "utf8");
  if (localPathPattern.test(text)) leakedPaths.push(relative(projectRoot, file));
}
if (leakedPaths.length) {
  throw new Error(`公开文档包含维护者本机路径：${leakedPaths.join(", ")}`);
}

process.stdout.write(`${markdownFiles.length} 个公开 Markdown 文件边界检查通过\n`);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdown(directory) {
  const ignored = new Set(["dist", "node_modules", "vendor"]);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectMarkdown(path));
    else if (entry.isFile() && extname(entry.name) === ".md") files.push(path);
  }
  return files;
}
