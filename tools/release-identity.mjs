import { createHash } from "node:crypto";

export function hasStableExtensionIdentity(manifest = {}) {
  const key = String(manifest.key ?? "").replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key) || key.length < 128) return false;
  try {
    return Buffer.from(key, "base64").length >= 96;
  } catch {
    return false;
  }
}

export function requireStableExtensionIdentity(manifest = {}) {
  if (!hasStableExtensionIdentity(manifest)) {
    throw new Error(
      "正式安装包已阻止：Manifest 尚未写入 Chrome Web Store 项目的公钥。" +
      "请先取得正式公钥，避免 GitHub 未压缩版产生新扩展 ID 并让用户误以为资料丢失。"
    );
  }
}

export function extensionIdFromPublicKey(manifest = {}) {
  requireStableExtensionIdentity(manifest);
  const digest = createHash("sha256").update(Buffer.from(String(manifest.key).replace(/\s+/g, ""), "base64")).digest("hex").slice(0, 32);
  return [...digest].map((character) => String.fromCharCode(97 + Number.parseInt(character, 16))).join("");
}

export function chromeStoreUploadManifest(manifest = {}) {
  requireStableExtensionIdentity(manifest);
  const { key: _developmentIdentityKey, ...uploadManifest } = manifest;
  return uploadManifest;
}

export function extensionArchiveName(manifest = {}, { release = false } = {}) {
  const version = String(manifest.version ?? "").trim();
  if (release) {
    requireStableExtensionIdentity(manifest);
    return `PromptDirector-${version}.zip`;
  }
  const suffix = hasStableExtensionIdentity(manifest) ? "-FIXED-ID-DEV" : "-UNFIXED-ID-DEV";
  return `PromptDirector-${version}${suffix}.zip`;
}
