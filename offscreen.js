import { deleteScreenshotBlob, getScreenshotBlob, saveScreenshotBlob } from "./image-store.js";
import { deleteMediaBlob, getMediaBlob } from "./media-store.js";
import {
  SCREENSHOT_SETTINGS,
  archiveMarkdownFilename,
  calculateCropGeometry,
  renderLibraryJson,
  renderMarkdown
} from "./lib.js";
import { createZipBlob } from "./zip.js";
import { sha256Hex } from "./sync-crypto.js";
import {
  CURATED_SUBMISSION_MAX_FILE_BYTES,
  CURATED_SUBMISSION_PART_PAYLOAD_BYTES,
  submissionManifest,
  submissionPartManifest
} from "./curated-submission.js";
import { PALETTE_VERSION, extractPalette } from "./palette.js";
import {
  SHARE_PREVIEW_FOUNDATION_FILENAME,
  SHARE_PREVIEW_HTML_FILENAME,
  SHARE_PREVIEW_MASONRY_FILENAME,
  SHARE_PREVIEW_RUNTIME_FILENAME,
  renderSharePreviewHtml,
  renderSharePreviewMasonryJs,
  renderSharePreviewRuntimeJs
} from "./share-preview.js";
import { normalizeUiPreferences } from "./preferences.js";
import { normalizeEntryMedia } from "./media.js";
import { normalizeCreativeRuns } from "./creative-runs.js";
import { buildCreativeExperimentPackage } from "./creative-experiment-package.js";
import { runCreativeJob } from "./creative-job-runner.js";
import { composerServiceErrorDetails } from "./composer-service.js";
import {
  assetFormatForExtension,
  assetFormatsForMimeType,
  canonicalMimeType,
  fileExtension,
  isReportedMimeCompatible
} from "./asset-formats.js";
import {
  LOCAL_ASSET_LINK_STATUS,
  getLocalAssetHandleRecord,
  inspectStoredLocalAsset
} from "./local-asset-store.js";

const blobUrls = new Set();
let creativeJobRunner = null;

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "offscreen") return false;
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  });
}

async function handleMessage(message) {
  switch (message.type) {
    case "CROP_AND_STORE_SCREENSHOT":
      return cropScreenshot(message);
    case "CROP_AND_STORE_SCREENSHOTS":
      return cropScreenshots(message);
    case "CROP_PAGE_CAPTURE_PREVIEWS":
      return cropPageCapturePreviews(message);
    case "CREATE_ARCHIVE_URL":
      return createArchiveUrl(message);
    case "CREATE_CURATED_SUBMISSION_URLS":
      return createCuratedSubmissionUrls(message);
    case "CREATE_CREATIVE_EXPERIMENT_ARCHIVE_URL":
      return createCreativeExperimentArchiveUrl(message);
    case "ANALYZE_STORED_SCREENSHOT":
      return analyzeStoredScreenshot(message.entryId);
    case "RUN_CREATIVE_JOB":
      return startCreativeJob(message.job);
    case "CANCEL_CREATIVE_JOB":
      return cancelCreativeJob(message.jobId);
    case "GET_CREATIVE_JOB_RUNNER":
      return { ok: true, jobId: creativeJobRunner?.jobId ?? "" };
    case "REVOKE_BLOB_URL":
      if (blobUrls.delete(message.url)) URL.revokeObjectURL(message.url);
      return { ok: true };
    default:
      return { ok: false, message: "未知后台画布操作" };
  }
}

function startCreativeJob(job) {
  const jobId = String(job?.id ?? "").trim();
  if (!jobId) throw new Error("创作任务编号无效");
  if (creativeJobRunner) {
    if (creativeJobRunner.jobId === jobId) return { ok: true, jobId, running: true };
    throw new Error("后台已有创作任务正在运行");
  }
  const controller = new AbortController();
  const runner = { jobId, controller, cancelRequested: false, promise: null };
  runner.promise = runCreativeJob(job, {
    signal: controller.signal,
    loadState: () => sendBackgroundMessage({ type: "GET_CREATIVE_JOB_EXECUTION_STATE" }),
    progress: ({ phase, session, remoteVideo }) => sendBackgroundMessage({
      type: "UPDATE_CREATIVE_JOB_PROGRESS",
      jobId,
      phase,
      session,
      remoteVideo
    })
  }).then(async (result) => {
    const response = await sendBackgroundMessage({
      type: "COMPLETE_CREATIVE_JOB",
      jobId,
      session: result.session,
      visuals: result.visuals,
      generation: result.generation
    });
    if (!response?.ok) {
      await Promise.allSettled((result.visuals ?? []).map((visual) => visual.kind === "video" ? deleteMediaBlob(visual.id) : deleteScreenshotBlob(visual.id)));
      throw new Error(response?.message || "创作任务结果保存失败");
    }
    return response;
  }).catch(async (error) => {
    if (runner.cancelRequested || error?.name === "AbortError") return { ok: false, canceled: true };
    const details = composerServiceErrorDetails(error);
    await sendBackgroundMessage({
      type: "FAIL_CREATIVE_JOB",
      jobId,
      error: details
    }).catch(() => undefined);
    return { ok: false, message: details.message };
  }).finally(async () => {
    const maskAssetId = String(job?.request?.imageEdit?.maskAssetId ?? "").trim();
    if (maskAssetId) await deleteScreenshotBlob(maskAssetId).catch(() => undefined);
    if (creativeJobRunner === runner) creativeJobRunner = null;
  });
  creativeJobRunner = runner;
  return { ok: true, jobId, running: true };
}

async function cancelCreativeJob(jobIdValue) {
  const jobId = String(jobIdValue ?? "").trim();
  if (!creativeJobRunner || creativeJobRunner.jobId !== jobId) {
    return { ok: false, message: "后台没有找到正在运行的创作任务" };
  }
  creativeJobRunner.cancelRequested = true;
  creativeJobRunner.controller.abort();
  await creativeJobRunner.promise;
  return { ok: true, jobId, canceled: true };
}

async function sendBackgroundMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.message || "创作任务状态保存失败");
  return response;
}

async function createCreativeExperimentArchiveUrl({
  composerSettings,
  composerSessions,
  creativeExperimentSettings,
  creativeRuns
}) {
  const files = [];
  const visualPaths = {};
  const seen = new Set();
  for (const run of normalizeCreativeRuns(creativeRuns)) {
    for (const output of run.outputs) {
      if (seen.has(output.visual.id)) continue;
      const video = output.visual.kind === "video" || String(output.visual.mimeType ?? "").startsWith("video/");
      const blob = video ? await getMediaBlob(output.visual.id) : await getScreenshotBlob(output.visual.id);
      if (!blob) throw new Error(`创作实验中的生成结果${video ? "视频" : "图片"}缺失，请删除该结果或重新采集后再导出`);
      const path = `results/${safeAssetName(run.id)}/${safeAssetName(output.visual.id)}.${resultExtension(blob.type)}`;
      visualPaths[output.visual.id] = path;
      files.push({ name: path, data: blob });
      seen.add(output.visual.id);
    }
  }
  const data = buildCreativeExperimentPackage({
    composerSettings,
    composerSessions,
    creativeExperimentSettings,
    creativeRuns
  }, visualPaths);
  files.unshift({ name: "experiments.json", data: `${JSON.stringify(data, null, 2)}\n` });
  const archive = await createZipBlob(files);
  const url = URL.createObjectURL(archive);
  blobUrls.add(url);
  return {
    ok: true,
    url,
    runCount: data.runs.length,
    mediaCount: seen.size,
    imageCount: seen.size,
    byteSize: archive.size
  };
}

function resultExtension(mimeType) {
  const known = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov"
  };
  return known[mimeType] || imageExtension(mimeType);
}

async function analyzeStoredScreenshot(entryId) {
  const blob = await getScreenshotBlob(entryId);
  if (!blob) return { ok: false, message: "没有找到已保存的截图" };
  const url = URL.createObjectURL(blob);
  try {
    const image = await loadImage(url);
    const maximumWidth = 480;
    const width = Math.min(maximumWidth, image.naturalWidth);
    const height = Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("浏览器无法创建色卡画布");
    context.drawImage(image, 0, 0, width, height);
    const colors = extractPalette(context.getImageData(0, 0, width, height));
    return {
      ok: true,
      width: image.naturalWidth,
      height: image.naturalHeight,
      mimeType: blob.type,
      byteSize: blob.size,
      palette: colors.length ? { colors, source: "screenshot", version: PALETTE_VERSION } : undefined
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function cropScreenshot({ entryId, dataUrl, selection }) {
  const image = await loadImage(dataUrl);
  return cropLoadedScreenshot(image, entryId, selection);
}

async function cropScreenshots({ entryIds, dataUrl, selections }) {
  const ids = Array.isArray(entryIds) ? entryIds : [];
  const values = Array.isArray(selections) ? selections : [];
  if (!ids.length || ids.length !== values.length) throw new Error("批量截图数据不完整");
  const image = await loadImage(dataUrl);
  const storedIds = [];
  try {
    const results = [];
    for (const [index, selection] of values.entries()) {
      storedIds.push(ids[index]);
      results.push(await cropLoadedScreenshot(image, ids[index], selection));
    }
    return { ok: true, results };
  } catch (error) {
    await Promise.allSettled(storedIds.map((entryId) => deleteScreenshotBlob(entryId)));
    throw error;
  }
}

async function cropPageCapturePreviews({ dataUrl, selections, maxDataUrlCharacters }) {
  const values = Array.isArray(selections) ? selections : [];
  if (!values.length) return { ok: true, dataUrls: [] };
  const image = await loadImage(dataUrl);
  const limit = Number.isSafeInteger(Number(maxDataUrlCharacters)) && Number(maxDataUrlCharacters) > 0
    ? Number(maxDataUrlCharacters)
    : 1;
  return {
    ok: true,
    dataUrls: values.map((selection) => cropLoadedScreenshotDataUrl(image, selection, limit))
  };
}

function cropLoadedScreenshotDataUrl(image, selection, maxCharacters) {
  const geometry = calculateCropGeometry({
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    viewportWidth: selection.viewportWidth,
    viewportHeight: selection.viewportHeight,
    rect: selection.rect
  });
  let width = geometry.outputWidth;
  let height = geometry.outputHeight;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return "";
    context.drawImage(image, geometry.sourceX, geometry.sourceY, geometry.sourceWidth, geometry.sourceHeight, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(SCREENSHOT_SETTINGS.mimeType, SCREENSHOT_SETTINGS.quality);
    if (dataUrl.length <= maxCharacters) return dataUrl;
    width = Math.max(1, Math.floor(width * 0.7));
    height = Math.max(1, Math.floor(height * 0.7));
  }
  return "";
}

async function cropLoadedScreenshot(image, entryId, selection) {
  const geometry = calculateCropGeometry({
    imageWidth: image.naturalWidth,
    imageHeight: image.naturalHeight,
    viewportWidth: selection.viewportWidth,
    viewportHeight: selection.viewportHeight,
    rect: selection.rect
  });
  const canvas = document.createElement("canvas");
  canvas.width = geometry.outputWidth;
  canvas.height = geometry.outputHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法创建截图画布");
  context.drawImage(
    image,
    geometry.sourceX,
    geometry.sourceY,
    geometry.sourceWidth,
    geometry.sourceHeight,
    0,
    0,
    geometry.outputWidth,
    geometry.outputHeight
  );
  const blob = await canvasToBlob(canvas);
  await saveScreenshotBlob(entryId, blob);
  const colors = extractPalette(context.getImageData(0, 0, canvas.width, canvas.height));
  return {
    ok: true,
    width: geometry.outputWidth,
    height: geometry.outputHeight,
    mimeType: blob.type,
    byteSize: blob.size,
    palette: colors.length ? { colors, source: "screenshot", version: PALETTE_VERSION } : undefined
  };
}

async function createArchiveUrl({
  entries, settings, taxonomy, facetCatalog, classificationRules, organizerState,
  composerSettings, composerSessions, creativeExperimentSettings, creativeRuns,
  creativeSkills, compoundCases, uiPreferences, locale: localeValue, sharing = false,
  installUrl = "", sourceUrl = ""
}) {
  const files = [];
  const resolvedEntries = [];
  const imagePaths = new Map();
  let imageCount = 0;
  const preferences = normalizeUiPreferences(uiPreferences);
  const locale = localeValue === "en" ? "en" : "zh-CN";

  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeEntryMedia(entry);
    const mediaAssets = [];
    for (const asset of normalized.mediaAssets) {
      if (asset.storageMode === "reference") {
        if (sharing && asset.recordType === "local-asset-reference") {
          const blob = await readLinkedAssetForShare(asset, entry.title);
          const extension = packageMediaExtension(asset, blob);
          const assetPath = `${mediaDirectory(asset.kind)}/${safeAssetName(entry.id)}/${safeAssetName(asset.id)}.${extension}`;
          files.push({ name: assetPath, data: blob });
          mediaAssets.push(portableManagedAsset(asset, blob, assetPath, extension));
          continue;
        }
        mediaAssets.push(asset);
        continue;
      }
      const blob = await getMediaBlob(asset.id);
      if (!blob) throw new Error(`“${entry.title || "未命名案例"}”的媒体文件缺失，请从完整备份恢复后再导出`);
      const extension = packageMediaExtension(asset, blob);
      const assetPath = `${mediaDirectory(asset.kind)}/${safeAssetName(entry.id)}/${safeAssetName(asset.id)}.${extension}`;
      files.push({ name: assetPath, data: blob });
      if (asset.kind === "image") {
        imagePaths.set(asset.id, assetPath);
        imageCount += 1;
      }
      mediaAssets.push(portableManagedAsset(asset, blob, assetPath, extension));
    }
    resolvedEntries.push({ ...normalized, mediaAssets });
  }

  const resolvedCreativeRuns = [];
  if (!sharing) {
    for (const run of normalizeCreativeRuns(creativeRuns)) {
      const outputs = [];
      for (const output of run.outputs) {
        let screenshotPath = imagePaths.get(output.visual.id);
        if (!screenshotPath) {
          const blob = await getScreenshotBlob(output.visual.id);
          if (!blob) throw new Error("创作实验中的生成结果图片缺失，请删除该结果或重新采集后再备份");
          screenshotPath = `creative-results/${safeAssetName(run.id)}/${safeAssetName(output.visual.id)}.${imageExtension(blob.type)}`;
          files.push({ name: screenshotPath, data: blob });
          imagePaths.set(output.visual.id, screenshotPath);
          imageCount += 1;
        }
        outputs.push({ ...output, visual: { ...output.visual, screenshotPath } });
      }
      resolvedCreativeRuns.push({ ...run, outputs });
    }
  }

  const resolvedCreativeSkills = structuredClone(creativeSkills ?? { version: 1, items: [] });
  if (!sharing) {
    for (const skill of resolvedCreativeSkills.items ?? []) {
      for (const file of skill.packageFiles ?? []) {
        const blob = await getMediaBlob(file.assetId);
        if (!blob) throw new Error(`外部 Skill 原包文件缺失：${file.path}`);
        const archivePath = skillArchivePath(skill.portableId, file.assetId, file.path);
        files.push({ name: archivePath, data: blob });
        file.archivePath = archivePath;
        file.byteSize = blob.size;
        file.mimeType = blob.type || file.mimeType || "application/octet-stream";
      }
    }
  }

  files.unshift({
    name: archiveMarkdownFilename(settings),
    data: renderMarkdown(resolvedEntries, settings, taxonomy, facetCatalog, { locale })
  });
  files.splice(1, 0, {
    name: "library.json",
    data: renderLibraryJson(
      resolvedEntries,
      settings,
      taxonomy,
      facetCatalog,
      classificationRules,
      organizerState,
      sharing ? null : {
        composerSettings,
        composerSessions,
        creativeExperimentSettings,
        creativeRuns: resolvedCreativeRuns,
        creativeSkills: resolvedCreativeSkills
      },
      compoundCases
    )
  });
  if (sharing) {
    const [foundationCss, iconSprite, masonrySource] = await Promise.all([
      packagedRuntimeAsset("ui-foundation.css"),
      packagedRuntimeAsset("assets/ui-icons.svg"),
      packagedRuntimeAsset("stable-masonry.js")
    ]);
    files.splice(2, 0, {
      name: SHARE_PREVIEW_HTML_FILENAME,
      data: renderSharePreviewHtml(resolvedEntries, settings, taxonomy, facetCatalog, {
        installUrl,
        sourceUrl,
        locale,
        theme: preferences.theme,
        iconSprite
      })
    });
    files.splice(3, 0, {
      name: SHARE_PREVIEW_RUNTIME_FILENAME,
      data: renderSharePreviewRuntimeJs()
    });
    files.splice(4, 0,
      { name: SHARE_PREVIEW_FOUNDATION_FILENAME, data: foundationCss },
      { name: SHARE_PREVIEW_MASONRY_FILENAME, data: renderSharePreviewMasonryJs(masonrySource) }
    );
  }
  const archive = await createZipBlob(files);
  const url = URL.createObjectURL(archive);
  blobUrls.add(url);
  return { ok: true, url, imageCount, fileCount: files.length, byteSize: archive.size };
}

async function createCuratedSubmissionUrls({
  entries, settings, taxonomy, facetCatalog, classificationRules, organizerState, compoundCases
}) {
  const files = [];
  const resolvedEntries = [];
  let mediaCount = 0;
  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeEntryMedia(entry);
    const mediaAssets = [];
    for (const asset of normalized.mediaAssets) {
      if (asset.storageMode !== "managed") throw new Error(`“${entry.title || "未命名案例"}”包含未保存到本地的媒体`);
      const blob = await getMediaBlob(asset.id);
      if (!blob) throw new Error(`“${entry.title || "未命名案例"}”的媒体文件缺失`);
      const extension = packageMediaExtension(asset, blob);
      const assetPath = `${mediaDirectory(asset.kind)}/${safeAssetName(entry.id)}/${safeAssetName(asset.id)}.${extension}`;
      files.push({ name: assetPath, data: blob });
      mediaAssets.push(portableManagedAsset(asset, blob, assetPath, extension));
      mediaCount += 1;
    }
    resolvedEntries.push({ ...normalized, mediaAssets });
  }
  files.unshift({
    name: "library.json",
    data: renderLibraryJson(
      resolvedEntries,
      settings,
      taxonomy,
      facetCatalog,
      classificationRules,
      organizerState,
      null,
      compoundCases
    )
  });
  const payload = await createZipBlob(files);
  const submissionId = await sha256Hex(payload);
  const manifest = submissionManifest({
    submissionId,
    payloadBytes: payload.size,
    caseCount: resolvedEntries.length,
    mediaCount
  });
  const submissionArchive = await createZipBlob([
    { name: "submission.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: "payload.zip", data: payload }
  ]);
  const archiveSha256 = await sha256Hex(submissionArchive);
  const outputBlobs = submissionArchive.size <= CURATED_SUBMISSION_MAX_FILE_BYTES
    ? [submissionArchive]
    : await splitCuratedSubmissionArchive(submissionArchive, { submissionId, archiveSha256 });
  const shortId = submissionId.slice(0, 12);
  const outputs = outputBlobs.map((blob, index) => {
    const url = URL.createObjectURL(blob);
    blobUrls.add(url);
    const split = outputBlobs.length > 1;
    return {
      url,
      byteSize: blob.size,
      filename: split
        ? `PromptDirector-投稿-${shortId}-${String(index + 1).padStart(2, "0")}-of-${String(outputBlobs.length).padStart(2, "0")}.zip`
        : `PromptDirector-投稿-${shortId}.zip`
    };
  });
  return {
    ok: true,
    submissionId,
    caseCount: resolvedEntries.length,
    mediaCount,
    payloadBytes: payload.size,
    archiveBytes: submissionArchive.size,
    partCount: outputs.length,
    outputs
  };
}

async function splitCuratedSubmissionArchive(archive, { submissionId, archiveSha256 }) {
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const partCount = Math.ceil(bytes.byteLength / CURATED_SUBMISSION_PART_PAYLOAD_BYTES);
  const parts = [];
  for (let index = 0; index < partCount; index += 1) {
    const start = index * CURATED_SUBMISSION_PART_PAYLOAD_BYTES;
    const payload = bytes.slice(start, Math.min(bytes.byteLength, start + CURATED_SUBMISSION_PART_PAYLOAD_BYTES));
    const manifest = submissionPartManifest({
      submissionId,
      archiveSha256,
      archiveBytes: bytes.byteLength,
      partIndex: index + 1,
      partCount,
      payloadSha256: await sha256Hex(payload),
      payloadBytes: payload.byteLength
    });
    const part = await createZipBlob([
      { name: "part.json", data: `${JSON.stringify(manifest, null, 2)}\n` },
      { name: "payload.bin", data: payload }
    ]);
    if (part.size > CURATED_SUBMISSION_MAX_FILE_BYTES) throw new Error("投稿分卷超过 GitHub 上传上限");
    parts.push(part);
  }
  return parts;
}

async function packagedRuntimeAsset(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  if (!response.ok) throw new Error(`分享页运行资源缺失：${path}`);
  return response.text();
}

function skillArchivePath(portableId, assetId, packagePath) {
  const parts = String(packagePath ?? "").split("/").filter(Boolean).map(safeAssetName);
  if (!parts.length) throw new Error("外部 Skill 原包路径无效");
  return ["skills", safeAssetName(portableId), safeAssetName(assetId), ...parts].join("/");
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("截图压缩失败"))),
      SCREENSHOT_SETTINGS.mimeType,
      SCREENSHOT_SETTINGS.quality
    );
  });
}

function safeAssetName(value) {
  const safe = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-");
  if (!safe || safe === "." || safe === "..") throw new Error("案例编号无效");
  return safe;
}

function imageExtension(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  throw new Error(`不支持的截图格式：${mimeType || "未知"}`);
}

function mediaDirectory(kind) {
  const directories = {
    image: "images",
    video: "videos",
    audio: "audio",
    document: "documents",
    attachment: "attachments"
  };
  const directory = directories[kind];
  if (!directory) throw new Error(`不支持的媒体类型：${kind || "未知"}`);
  return directory;
}

export function packageMediaExtension(asset, blob) {
  const candidates = [
    cleanExtension(asset?.sourceFormat),
    fileExtension(asset?.sourceTitle),
    ...assetFormatsForMimeType(blob?.type).filter((item) => item.kind === asset?.kind).flatMap((item) => item.extensions),
    ...assetFormatsForMimeType(asset?.mimeType).filter((item) => item.kind === asset?.kind).flatMap((item) => item.extensions)
  ].filter(Boolean);
  for (const extension of candidates) {
    const format = assetFormatForExtension(extension);
    if (format?.kind === asset?.kind && isReportedMimeCompatible(format, blob?.type || asset?.mimeType)) return extension;
    if (!format && asset?.kind === "attachment" && /^[a-z0-9]+$/u.test(extension)) return extension;
  }
  const known = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
    "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
    "video/x-matroska": "mkv", "video/x-msvideo": "avi",
    "audio/mpeg": "mp3", "audio/wav": "wav", "audio/mp4": "m4a", "audio/aac": "aac",
    "audio/flac": "flac", "audio/ogg": "ogg", "audio/opus": "opus",
    "application/pdf": "pdf", "application/rtf": "rtf", "text/rtf": "rtf",
    "text/plain": "txt", "text/markdown": "md", "text/html": "html", "text/vtt": "vtt"
  };
  const extension = known[blob?.type] || known[asset?.mimeType];
  if (extension) return extension;
  throw new Error(`“${asset?.sourceTitle || asset?.id || "未命名媒体"}”缺少可安全识别的文件扩展名`);
}

export function portableManagedAsset(asset, blob, assetPath, extension) {
  const next = { ...asset };
  for (const field of [
    "recordType", "linkStatus", "importFailure", "sourceLastModified", "linkedAt",
    "localPath", "absolutePath", "fileHandle", "handle", "reference"
  ]) delete next[field];
  const format = assetFormatForExtension(extension);
  const reportedMimeType = String(blob?.type || asset?.mimeType || "").trim().toLocaleLowerCase("en-US");
  const compatibleMimeType = [blob?.type, asset?.mimeType]
    .map((value) => String(value ?? "").trim().toLocaleLowerCase("en-US"))
    .find((value) => value && !["application/octet-stream", "application/x-unknown"].includes(value) &&
      (!format || isReportedMimeCompatible(format, value)));
  next.storageMode = "managed";
  next.assetPath = assetPath;
  next.byteSize = blob.size;
  next.mimeType = format
    ? canonicalMimeType(format, compatibleMimeType || "")
    : compatibleMimeType || reportedMimeType || "application/octet-stream";
  next.sourceFormat = extension;
  next.formatCategory = format?.category || "other-source";
  next.playbackCapability = ["image", "video", "audio"].includes(asset.kind) ? "native" : "unknown";
  return next;
}

export async function readLinkedAssetForShare(asset, entryTitle, dependencies = {}) {
  const label = `“${entryTitle || "未命名案例"}”中的“${asset.sourceTitle || "本机源文件"}”`;
  const getRecord = dependencies.getLocalAssetHandleRecord || getLocalAssetHandleRecord;
  const inspect = dependencies.inspectStoredLocalAsset || inspectStoredLocalAsset;
  const record = await getRecord(asset.id);
  if (!record) throw new Error(`${label}没有保存可读取的本机链接，请重新选择文件后再分享`);
  const inspection = await inspect(asset.id);
  if (inspection.status === LOCAL_ASSET_LINK_STATUS.NEEDS_PERMISSION) {
    throw new Error(`${label}尚未获得读取权限，请在素材详情中授权后再分享`);
  }
  if (inspection.status === LOCAL_ASSET_LINK_STATUS.MISSING) {
    throw new Error(`${label}已移动、改名或删除，请重新链接后再分享`);
  }
  if (inspection.status === LOCAL_ASSET_LINK_STATUS.CHANGED) {
    throw new Error(`${label}自链接后发生了变化，请确认并重新链接后再分享`);
  }
  if (inspection.status !== LOCAL_ASSET_LINK_STATUS.READY || !(inspection.file instanceof Blob)) {
    throw new Error(`${label}当前不可读取，请重新链接后再分享`);
  }
  return inspection.file;
}

function cleanExtension(value) {
  return String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/^\./u, "");
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("浏览器无法读取当前截图"));
    image.src = dataUrl;
  });
}
