import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { validateChromeStoreManifest } from "./chrome-store-manifest.mjs";
import { extensionIdFromPublicKey } from "./release-identity.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = await json("manifest.json");
const locales = Object.fromEntries(await Promise.all(["zh_CN", "en"].map(async (locale) => [
  locale,
  await json(`_locales/${locale}/messages.json`)
])));
validateChromeStoreManifest({ manifest, locales });
const extensionId = extensionIdFromPublicKey(manifest);

const privacy = await text("store/PRIVACY_POLICY.md");
for (const permission of [...manifest.permissions, ...manifest.optional_permissions]) {
  requireText(privacy, `\`${permission}\``, `隐私政策缺少权限 ${permission}`);
}
for (const origin of [...manifest.host_permissions, ...manifest.optional_host_permissions]) {
  requireText(privacy, `\`${origin}\``, `隐私政策缺少域名权限 ${origin}`);
}
for (const phrase of ["Chrome Web Store User Data Policy", "Limited Use", "不会将用户数据用于个性化广告", "不会允许人工读取用户数据"]) {
  requireText(privacy, phrase, `隐私政策缺少 ${phrase}`);
}

const listingZh = await text("store/LISTING_ZH_CN.md");
const listingEn = await text("store/LISTING_EN.md");
const submission = await text("store/CHROME_WEB_STORE_SUBMISSION.md");
requireText(listingZh, locales.zh_CN.extensionName.message, "中文商店名称与 manifest 不一致");
requireText(listingEn, locales.en.extensionName.message, "英文商店名称与 manifest 不一致");
for (const permission of [
  ...manifest.permissions,
  ...manifest.optional_permissions,
  ...manifest.host_permissions,
  ...manifest.optional_host_permissions
]) {
  requireText(submission, `\`${permission}\``, `商店提交清单缺少 ${permission} 的说明`);
}
for (const phrase of ["Remote code", "Limited Use", "npm run package:release", extensionId]) {
  requireText(submission, phrase, `商店提交清单缺少 ${phrase}`);
}

for (const [path, expectedWidth, expectedHeight] of [
  ["assets/icons/icon-128.png", 128, 128],
  ["store/small-promo-440x280.png", 440, 280],
  ["store/screenshots/01-library-1280x800.png", 1280, 800],
  ["store/screenshots/02-skills-1280x800.png", 1280, 800],
  ["store/screenshots/03-composer-1280x800.png", 1280, 800]
]) {
  const bytes = await readFile(join(projectRoot, path)).catch(() => null);
  if (!bytes) throw new Error(`商店素材缺少 ${path}`);
  const dimensions = pngDimensions(bytes);
  if (dimensions.width !== expectedWidth || dimensions.height !== expectedHeight) {
    throw new Error(`${path} 尺寸应为 ${expectedWidth}x${expectedHeight}，当前为 ${dimensions.width}x${dimensions.height}`);
  }
}

process.stdout.write("Chrome Web Store 本地提交材料检查通过\n");

async function json(path) {
  return JSON.parse(await text(path));
}

async function text(path) {
  return readFile(join(projectRoot, path), "utf8");
}

function requireText(source, value, message) {
  if (!source.includes(value)) throw new Error(message);
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.subarray(1, 4).toString("ascii") !== "PNG") {
    throw new Error("商店素材必须是真实 PNG 文件");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
