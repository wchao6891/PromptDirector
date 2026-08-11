import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(projectRoot, "manifest.json"), "utf8"));
const source = await readFile(join(projectRoot, "assets", "icons", "icon-source.svg"));
const targets = new Map(Object.entries({ ...manifest.icons, ...manifest.action?.default_icon })
  .map(([size, path]) => [Number(size), path])
  .filter(([size, path]) => Number.isInteger(size) && size > 0 && /^assets\/icons\/icon-\d+\.png$/.test(path)));
const checkOnly = process.argv.includes("--check");

for (const [size, relativePath] of [...targets].sort(([left], [right]) => left - right)) {
  const rendered = new Resvg(source, {
    fitTo: { mode: "width", value: size },
    shapeRendering: 2,
    imageRendering: 0
  }).render();
  validatePixels(rendered, size, relativePath);
  const png = rendered.asPng();
  const target = join(projectRoot, relativePath);
  if (checkOnly) {
    const current = await readFile(target).catch(() => null);
    if (!current?.equals(png)) throw new Error(`${relativePath} 不是 SVG 母版生成的当前品牌图标`);
  } else {
    await writeFile(target, png);
  }
}

process.stdout.write(`${checkOnly ? "已核对" : "已生成"} ${targets.size} 个品牌图标\n`);

function validatePixels(rendered, size, relativePath) {
  if (rendered.width !== size || rendered.height !== size) {
    throw new Error(`${basename(relativePath)} 尺寸错误：${rendered.width}x${rendered.height}`);
  }
  const pixels = rendered.pixels;
  let opaque = 0;
  let white = 0;
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 16) continue;
    const pixelIndex = index / 4;
    const x = pixelIndex % size;
    const y = Math.floor(pixelIndex / size);
    opaque += 1;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (pixels[index] > 245 && pixels[index + 1] > 245 && pixels[index + 2] > 245 && alpha > 245) white += 1;
  }
  const coverage = opaque / (size * size);
  if (coverage < 0.72 || minX > Math.ceil(size * 0.06) || minY > Math.ceil(size * 0.06) ||
      maxX < Math.floor(size * 0.93) || maxY < Math.floor(size * 0.93)) {
    throw new Error(`${relativePath} 图形没有正确铺满画布`);
  }
  if (white) throw new Error(`${relativePath} 含有不应存在的不透明白底`);
}
