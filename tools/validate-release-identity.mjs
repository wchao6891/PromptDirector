import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { requireStableExtensionIdentity } from "./release-identity.mjs";

const manifestUrl = new URL("../manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(fileURLToPath(manifestUrl), "utf8"));
requireStableExtensionIdentity(manifest);
process.stdout.write("正式扩展身份已校验\n");
