const LOCALIZED_MESSAGE = /^__MSG_([A-Za-z0-9_]+)__$/;

export function validateChromeStoreManifest({ manifest = {}, locales = {} } = {}) {
  if (manifest.manifest_version !== 3) throw new Error("Chrome Web Store 只接受当前项目的 Manifest V3 包");
  if (!/^\d+(?:\.\d+){0,3}$/.test(String(manifest.version ?? ""))) {
    throw new Error("Chrome 扩展 version 必须由一到四段非负整数组成");
  }
  const fields = [
    ["name", 75],
    ["description", 132],
    ...(manifest.short_name === undefined ? [] : [["short_name", 12]])
  ];
  for (const [field, limit] of fields) {
    const key = localizedKey(manifest[field], field);
    for (const [locale, messages] of Object.entries(locales)) {
      const value = String(messages?.[key]?.message ?? "");
      if (!value) throw new Error(`${locale} 缺少 manifest ${field} 对应的 ${key}`);
      if ([...value].length > limit) {
        throw new Error(`${locale} 的 manifest ${field} 超过 Chrome 上限 ${limit} 个字符`);
      }
    }
  }
}

function localizedKey(value, field) {
  const match = LOCALIZED_MESSAGE.exec(String(value ?? ""));
  if (!match) throw new Error(`manifest ${field} 必须使用本地化消息`);
  return match[1];
}
