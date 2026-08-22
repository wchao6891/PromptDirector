import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = join(projectRoot, "node_modules", "lucide-static", "icon-nodes.json");
const outputPath = join(projectRoot, "assets", "ui-icons.svg");
const iconNames = [
  "arrow-down", "arrow-left", "arrow-up", "check", "chevron-down", "chevron-left", "chevron-right", "circle-check-big", "copy",
  "download", "ellipsis", "external-link", "file-text", "folder", "image", "library",
  "list-checks", "maximize-2", "menu", "moon", "panel-left", "paperclip", "pencil", "play", "plus",
  "refresh-cw", "save", "search", "send", "settings", "sliders-horizontal", "sparkles", "square-check-big",
  "square", "sun", "tag", "trash-2", "upload", "video", "wand-sparkles", "x"
];

const iconNodes = JSON.parse(await readFile(sourcePath, "utf8"));
const symbols = iconNames.map((name) => {
  const nodes = iconNodes[name];
  if (!nodes) throw new Error(`Lucide 图标不存在：${name}`);
  return `  <symbol id="icon-${name}" viewBox="0 0 24 24">\n${nodes.map(renderNode).join("\n")}\n  </symbol>`;
});
const sprite = [
  "<!-- Generated from lucide-static. ISC license: THIRD_PARTY_NOTICES.md -->",
  '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2">',
  ...symbols,
  "</svg>",
  ""
].join("\n");

await mkdir(join(projectRoot, "assets"), { recursive: true });
await writeFile(outputPath, sprite);
process.stdout.write(`${outputPath}\n${iconNames.length} 个本地图标\n`);

function renderNode([tag, attributes]) {
  const props = Object.entries(attributes)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(" ");
  return `    <${tag}${props ? ` ${props}` : ""} />`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
