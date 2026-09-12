import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const targetRoot = join(projectRoot, "extension", "vendor", "document-ingestion");
const checkOnly = process.argv.includes("--check");
const rtfDist = join(projectRoot, "node_modules", "@jonahschulte", "rtf-toolkit", "dist");
const mammothNotices = join(projectRoot, "tools", "licenses", "mammoth-THIRD-PARTY-NOTICES");
const mammothRuntime = await readFile(join(projectRoot, "node_modules", "mammoth", "mammoth.browser.js"));
const notices = await readFile(mammothNotices, "utf8");
// A new upstream browser bundle requires reviewing its embedded dependencies.
if (!notices.includes(`Runtime SHA-256: ${createHash("sha256").update(mammothRuntime).digest("hex")}`)) {
  throw new Error("Mammoth browser dependency notices must be updated for the installed runtime");
}
const sources = [
  [mammothNotices, join(targetRoot, "mammoth-THIRD-PARTY-NOTICES")],
  [join(projectRoot, "node_modules", "mammoth", "mammoth.browser.js"), join(targetRoot, "mammoth.browser.js")],
  [join(projectRoot, "node_modules", "mammoth", "LICENSE"), join(targetRoot, "mammoth-LICENSE")],
  [join(rtfDist, "parser", "parser.js"), join(targetRoot, "rtf-toolkit", "parser", "parser.js")],
  [join(rtfDist, "parser", "tokenizer.js"), join(targetRoot, "rtf-toolkit", "parser", "tokenizer.js")],
  [join(rtfDist, "renderers", "html.js"), join(targetRoot, "rtf-toolkit", "renderers", "html.js")],
  [join(projectRoot, "node_modules", "@jonahschulte", "rtf-toolkit", "LICENSE"), join(targetRoot, "rtf-toolkit-LICENSE")],
  [join(projectRoot, "node_modules", "turndown", "lib", "turndown.browser.es.js"), join(targetRoot, "turndown.browser.es.js")],
  [join(projectRoot, "node_modules", "turndown", "LICENSE"), join(targetRoot, "turndown-LICENSE")]
  ,[join(projectRoot, "node_modules", "@mozilla", "readability", "LICENSE.md"), join(targetRoot, "readability-LICENSE")]
];

if (checkOnly) {
  for (const [source, target] of sources) await comparePath(source, target);
  const readabilitySource = await readFile(join(projectRoot, "node_modules", "@mozilla", "readability", "Readability.js"), "utf8");
  const readabilityTarget = await readFile(join(targetRoot, "Readability.js"), "utf8");
  if (readabilityTarget !== `${readabilitySource}\nglobalThis.Readability = Readability;\n`) {
    throw new Error("Readability 运行时与锁定依赖不一致");
  }
  process.stdout.write("文档导入运行时与锁定依赖一致\n");
} else {
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });
  for (const [source, target] of sources) {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true });
  }
  const readabilitySource = await readFile(join(projectRoot, "node_modules", "@mozilla", "readability", "Readability.js"), "utf8");
  await writeFile(join(targetRoot, "Readability.js"), `${readabilitySource}\nglobalThis.Readability = Readability;\n`);
  process.stdout.write("已同步文档导入运行时\n");
}

async function comparePath(source, target) {
  const sourceInfo = await stat(source).catch(() => null);
  const targetInfo = await stat(target).catch(() => null);
  if (!sourceInfo || !targetInfo || sourceInfo.isDirectory() !== targetInfo.isDirectory()) {
    throw new Error(`文档运行时缺失或类型不匹配：${target}`);
  }
  if (!sourceInfo.isDirectory()) {
    const [sourceBytes, targetBytes] = await Promise.all([readFile(source), readFile(target)]);
    if (!sourceBytes.equals(targetBytes)) throw new Error(`文档运行时与锁定依赖不一致：${target}`);
    return;
  }
  const { readdir } = await import("node:fs/promises");
  const [sourceEntries, targetEntries] = await Promise.all([
    readdir(source, { withFileTypes: true }),
    readdir(target, { withFileTypes: true })
  ]);
  const sourceNames = sourceEntries.map((entry) => entry.name).sort();
  const targetNames = targetEntries.map((entry) => entry.name).sort();
  if (sourceNames.join("\n") !== targetNames.join("\n")) throw new Error(`文档运行时文件列表不一致：${target}`);
  for (const name of sourceNames) await comparePath(join(source, name), join(target, name));
}
