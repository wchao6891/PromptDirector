import { entryMediaAssets } from "./media.js";

export const CONTACT_SHEET_MAX_IMAGES = 9;
export const CONTACT_SHEET_COLUMNS = 3;

export function selectedSkillContentImages(entriesValue = [], entryIdsValue = []) {
  const selected = new Set((Array.isArray(entryIdsValue) ? entryIdsValue : []).map(String));
  const result = [];
  let caseNumber = 0;
  for (const entry of Array.isArray(entriesValue) ? entriesValue : []) {
    if (!selected.has(String(entry?.id ?? ""))) continue;
    caseNumber += 1;
    let imageNumber = 0;
    for (const asset of entryMediaAssets(entry)) {
      if (asset.kind !== "image" || asset.usage === "poster" || asset.storageMode === "reference") continue;
      imageNumber += 1;
      result.push({ entryId: entry.id, visualId: asset.id, caseNumber, imageNumber });
    }
  }
  return result;
}

export function contactSheetPlan(imagesValue = []) {
  const images = Array.isArray(imagesValue) ? imagesValue : [];
  if (images.length <= 1) return images.length ? [{ kind: "single", items: images }] : [];
  const batches = [];
  for (let index = 0; index < images.length; index += CONTACT_SHEET_MAX_IMAGES) {
    batches.push({ kind: "contact-sheet", items: images.slice(index, index + CONTACT_SHEET_MAX_IMAGES) });
  }
  return batches;
}

export async function renderContactSheetBatch(batch, loadBlob, options = {}) {
  if (!batch?.items?.length) throw new Error("联系表没有内容图");
  if (batch.kind === "single") {
    const blob = await loadBlob(batch.items[0].visualId);
    if (!(blob instanceof Blob) || !blob.type.startsWith("image/")) throw new Error("内容图读取失败");
    return { ...batch, blob };
  }
  const cellSize = Math.max(128, Math.floor(Number(options.cellSize) || 512));
  const canvas = document.createElement("canvas");
  canvas.width = cellSize * CONTACT_SHEET_COLUMNS;
  canvas.height = cellSize * CONTACT_SHEET_COLUMNS;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法创建视觉联系表");
  context.fillStyle = "#111111";
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, item] of batch.items.entries()) {
    const blob = await loadBlob(item.visualId);
    if (!(blob instanceof Blob) || !blob.type.startsWith("image/")) throw new Error(`案例 ${item.caseNumber} 的第 ${item.imageNumber} 张内容图读取失败`);
    const bitmap = await createImageBitmap(blob);
    try {
      const x = (index % CONTACT_SHEET_COLUMNS) * cellSize;
      const y = Math.floor(index / CONTACT_SHEET_COLUMNS) * cellSize;
      const scale = Math.min(cellSize / bitmap.width, cellSize / bitmap.height);
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, x + Math.round((cellSize - width) / 2), y + Math.round((cellSize - height) / 2), width, height);
      context.fillStyle = "rgba(0, 0, 0, 0.78)";
      context.fillRect(x + 12, y + 12, 116, 38);
      context.fillStyle = "#ffffff";
      context.font = "600 20px system-ui, sans-serif";
      context.fillText(`C${item.caseNumber} · ${item.imageNumber}`, x + 24, y + 38);
    } finally {
      bitmap.close();
    }
  }
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error("视觉联系表生成失败")),
    "image/jpeg",
    0.9
  ));
  canvas.width = 1;
  canvas.height = 1;
  return { ...batch, blob };
}
