import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const destination = process.argv[2];
if (!destination) throw new Error("Usage: node tools/sync-skill-cover-site.mjs <curated-site-directory> [--check]");
const check = process.argv.includes("--check");
const source = fileURLToPath(new URL("../extension/", import.meta.url));
for (const [name, output] of [["skill-cover.js", "lib/skill-cover.js"], ["asset-formats.js", "lib/asset-formats.js"], ["skill-cover.css", "skill-cover.css"], ["resource-limits.js", "lib/resource-limits.js"]]) {
  const bytes = await readFile(join(source, name));
  const target = join(resolve(destination), output);
  if (check) {
    if (!bytes.equals(await readFile(target))) throw new Error(`Shared Skill cover resource differs: ${output}`);
  } else {
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, bytes);
  }
}
console.log(check ? "Shared Skill cover resources match" : "Shared Skill cover resources synchronized");
