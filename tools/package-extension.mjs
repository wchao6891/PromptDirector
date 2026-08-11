import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createZipBlob } from "../zip.js";
import { verifyPdfjsRuntime } from "./pdfjs-runtime.mjs";
import { extensionArchiveName } from "./release-identity.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
const runtimeExtensions = new Set([".css", ".html", ".js"]);
const files = [];

await verifyPdfjsRuntime({ projectRoot });

for (const name of await readdir(projectRoot)) {
  if (name === "manifest.json" || runtimeExtensions.has(extname(name))) {
    files.push(await packageFile(join(projectRoot, name)));
  }
}

for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  files.push(await packageFile(join(projectRoot, name)));
}

for (const name of await readdir(join(projectRoot, "assets", "icons"))) {
  if (name === "icon-source.svg" || /^icon-(?:16|32|48|128)\.png$/.test(name)) {
    files.push(await packageFile(join(projectRoot, "assets", "icons", name)));
  }
}

files.push(await packageFile(join(projectRoot, "assets", "ui-icons.svg")));

for (const path of await runtimeFiles(join(projectRoot, "vendor", "pdfjs"))) {
  files.push(await packageFile(path));
}

for (const path of await runtimeFiles(join(projectRoot, "vendor", "document-ingestion"))) {
  files.push(await packageFile(path));
}

for (const locale of await readdir(join(projectRoot, "_locales"), { withFileTypes: true })) {
  if (locale.isDirectory()) {
    files.push(await packageFile(join(projectRoot, "_locales", locale.name, "messages.json")));
  }
}

validateManifest(manifest, files.map((file) => file.name));
await mkdir(join(projectRoot, "dist"), { recursive: true });
const archive = await createZipBlob(files);
const release = process.argv.includes("--release");
const outputPath = join(projectRoot, "dist", extensionArchiveName(manifest, { release }));
await writeFile(outputPath, new Uint8Array(await archive.arrayBuffer()));
process.stdout.write(`${outputPath}\n${files.length} 个运行文件，${archive.size} 字节\n`);

async function packageFile(path) {
  return {
    name: relative(projectRoot, path).replaceAll("\\", "/"),
    data: await readFile(path)
  };
}

async function runtimeFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await runtimeFiles(path));
    else paths.push(path);
  }
  return paths;
}

function validateManifest(value, paths) {
  if (value.manifest_version !== 3) throw new Error("只允许打包 Manifest V3 扩展");
  if (!/^\d+\.\d+\.\d+$/.test(value.version ?? "")) throw new Error("manifest 版本号无效");
  if (!/^__MSG_[A-Za-z0-9_]+__$/.test(String(value.name ?? ""))) throw new Error("manifest 品牌名未使用本地化消息");
  for (const required of ["manifest.json", "LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md", "ui-foundation.css", "ui-icons.js", "assets/ui-icons.svg", "collector.html", "collector.js", "collector-view.js", "collector.css", "capture-draft.js", "compound-cases.js", "media.js", "media-store.js", "visuals.js", "composer.html", "composer-page.js", "composer-page.css", "composer-diagnostics.js", "creative-skills.js", "creative-skill-package.js", "creative-skill-service.js", "skill-contact-sheet.js", "skills.html", "skills-page.js", "skills-page.css", "curated.html", "curated-page.js", "curated.css", "curated-catalog.js", "curated-config.js", "background.js", "image-transaction.js", "assets/icons/icon-128.png", "_locales/zh_CN/messages.json", "_locales/en/messages.json"]) {
    if (!paths.includes(required)) throw new Error(`发布包缺少 ${required}`);
  }
  if (!paths.includes("ui-dialogs.js")) throw new Error("发布包缺少 ui-dialogs.js");
  if (!paths.includes("smart-visual-selection.js")) throw new Error("发布包缺少 smart-visual-selection.js");
  if (!paths.includes("page-capture.js") || !paths.includes("vendor/document-ingestion/Readability.js")) {
    throw new Error("发布包缺少网页采集运行时");
  }
  if (!paths.includes("ai-task-routing.js") || !paths.includes("video-analysis.js")) {
    throw new Error("发布包缺少 AI 任务分工或视频分析运行时");
  }
  if (paths.some((path) => /(?:^|\/)(?:test|tools|store|dist)(?:\/|$)/.test(path))) {
    throw new Error("发布包混入了测试、工具或商店素材");
  }
}
