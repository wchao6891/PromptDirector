import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const checkOnly = process.argv.includes("--check");
const iconSource = await readFile(join(projectRoot, "assets/icons/icon-source.svg"));
const promoSource = await readFile(join(projectRoot, "store/brand/prompt-director-promo-source.svg"));

const outputs = [
  ["store/brand/prompt-director-mark-source.png", render(iconSource, 1024)],
  ["store/small-promo-440x280.png", render(promoSource, 440)],
  ["store/brand/prompt-director-promo-source.png", render(promoSource, 1572)]
];

for (const [relativePath, bytes] of outputs) {
  const path = join(projectRoot, relativePath);
  if (checkOnly) {
    const current = await readFile(path).catch(() => null);
    if (!current?.equals(bytes)) throw new Error(`${relativePath} 不是当前品牌母版生成的商店素材`);
  } else {
    await writeFile(path, bytes);
  }
}

process.stdout.write(`${checkOnly ? "已核对" : "已生成"} ${outputs.length} 个商店品牌素材\n`);

function render(source, width) {
  return new Resvg(source, { fitTo: { mode: "width", value: width } }).render().asPng();
}
