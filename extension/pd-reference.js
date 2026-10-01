// Stable, non-secret identity. This URI is resolved through the paired MCP,
// never fetched as a webpage and never interpreted as permission to mutate data.
export function pdReference({ libraryId, caseId, assetId = "" }) {
  if (!libraryId || !caseId) throw new Error("PD引用缺少资料库或案例身份");
  const url = new URL("promptdirector://reference");
  url.searchParams.set("v", "1");
  url.searchParams.set("library", libraryId);
  url.searchParams.set("case", caseId);
  if (assetId) url.searchParams.set("asset", assetId);
  return url.href;
}

export function parsePdReference(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("不是有效的PD引用"); }
  const keys = [...url.searchParams.keys()];
  if (url.protocol !== "promptdirector:" || url.hostname !== "reference" || url.pathname || url.hash || url.username || url.password || url.port ||
    url.searchParams.get("v") !== "1" || !url.searchParams.get("library") || !url.searchParams.get("case") ||
    keys.some(key => !["v", "library", "case", "asset"].includes(key)) || new Set(keys).size !== keys.length) throw new Error("PD引用格式或版本无效");
  return { libraryId: url.searchParams.get("library"), caseId: url.searchParams.get("case"), assetId: url.searchParams.get("asset") || "" };
}
