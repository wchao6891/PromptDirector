import { lstat, readFile, readlink, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const privateWorkspaceDirectories = [
  ".learnings",
  ".local-imports",
  ".omx",
  ".scratch",
  "private-evals",
  "plan",
  join("docs", "adr"),
  join("docs", "lessons"),
  join("docs", "research")
];

const privateWorkspaceFiles = ["CONTEXT.md", "context.md", "docs/DESIGN.md", "test/LOCAL_EXTENSION_LAB.md", "store/CHROME_WEB_STORE_SUBMISSION.md"];

// Use Git's publication boundary, including dotfiles and new, non-ignored files.
// An ignored local override is allowed; a force-added override is rejected.
const git = spawnSync("git", ["-C", projectRoot, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" });
const sourceFiles = git.status === 0
  ? [...new Set(git.stdout.split("\0").filter(Boolean))].map((path) => join(projectRoot, path))
  : await collectFiles(projectRoot);
const patterns = [
  ["公开文档包含维护者本机路径", /\/(?:Users|home)\/(?!<[^>]+>)[^/\s`"']+\/|\/Volumes\/(?!<[^>]+>)[^/\s`"']+\/|\/private\/tmp\/|\/(?:private\/)?var\/folders\/|\b[A-Za-z]:[\\/]+Users[\\/]+(?!<[^>]+>)[^\\/\s`"']+[\\/]+/i],
  ["公开源码包含私人工作区引用", /\b[A-Za-z0-9_.]+-Private\b|(?:\.\.\/|\.\.\\)(?:\.scratch|\.learnings)(?:[\\/]|\b)/],
  ["公开源码包含疑似凭据", /\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{50,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{40,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/]
];
const findings = [];
let textFileCount = 0;
for (const file of sourceFiles) {
  const path = relative(projectRoot, file).replaceAll("\\", "/");
  if (privateWorkspaceDirectories.some((directory) => path.startsWith(`${directory.replaceAll("\\", "/")}/`))) {
    findings.push(`公开源码树包含内部工作目录：${path}`);
  }
  if (privateWorkspaceFiles.includes(path)) findings.push(`公开源码树包含内部上下文文件：${path}`);
  if (path.split("/").includes("AGENTS.override.md") || /(?:^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith(".env.example")) {
    findings.push(`公开源码包含本地配置文件：${path}`);
  }
  let metadata;
  try {
    metadata = await lstat(file);
  } catch (error) {
    if (error.code === "ENOENT") continue; // A tracked deletion has no publishable bytes.
    throw error;
  }
  // Git publishes a symlink's target text, never the external file's contents.
  // Reading errors must fail verification rather than silently skip a file.
  const bytes = metadata.isSymbolicLink() ? Buffer.from(await readlink(file), "utf8") : await readFile(file);
  if (bytes.includes(0)) continue;
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    continue; // Images and other binary assets need separate visual review.
  }
  textFileCount += 1;
  for (const [label, pattern] of patterns) {
    const match = pattern.exec(text);
    if (match) findings.push(`${label}：${path}:${text.slice(0, match.index).split("\n").length}`);
  }
}
if (findings.length) throw new Error(findings.join("\n"));

process.stdout.write(`${textFileCount} 个公开文本文件边界检查通过\n`);

async function collectFiles(directory) {
  // Standalone fixture directories have no Git index or ignore rules.
  const ignored = new Set([".git", "dist", "node_modules", "coverage"]);
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile() || entry.isSymbolicLink()) files.push(path);
  }
  return files;
}
