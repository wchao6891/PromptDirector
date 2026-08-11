import {
  COMPOSER_INPUT_MAX_CHARACTERS,
  appendDiagnosticEvent,
  composerInputUsage,
  createComposerSession,
  normalizeComposerSettings
} from "./composer.js";
import {
  ComposerServiceError,
  executeComposerTurnWithService,
  selectedComposerService
} from "./composer-service.js";
import { applyComposerServiceResult, planComposerSession } from "./composer-turn-core.js";
import { retrieveComposerSources } from "./composer-retrieval.js";
import { normalizeAiSettings } from "./deepseek.js";
import { deleteScreenshotBlob, getScreenshotBlob, saveScreenshotBlob } from "./image-store.js";
import { readImageDimensions } from "./image-metadata.js";
import { deleteMediaBlob, getDerivedMedia, getMediaBlob, saveDerivedMedia, saveMediaBlob } from "./media-store.js";
import { prepareLocalMedia } from "./local-media.js";
import { entryMediaAssets } from "./media.js";
import { assertImageDimensions } from "./resource-limits.js";
import { buildSearchIndex } from "./search-index.js";
import { materializeLogicalCases } from "./compound-cases.js";
import { blobToDataUrl, normalizeVisionSettings } from "./vision.js";
import { normalizeAiServiceProfiles } from "./ai-task-routing.js";

export async function runCreativeJob(job, context = {}) {
  const signal = context.signal;
  const stored = await context.loadState();
  const profiles = normalizeAiServiceProfiles(stored.aiServiceProfiles);
  const settings = {
    ai: normalizeAiSettings(stored.aiSettings),
    vision: {
      ...normalizeVisionSettings(stored.visionSettings),
      xai: profiles.xai,
      providerProfiles: stored.visionSettings?.providerProfiles
    }
  };
  const composerSettings = normalizeComposerSettings(stored.composerSettings);
  let session = createComposerSession(job.request.session);
  const savedIds = [];
  try {
    if (job.request.startPhase === "planning" && !job.remoteVideo) {
      await context.progress({ phase: "planning", session });
      const service = selectedComposerService(session.aiProfile, settings.ai, settings.vision);
      session = appendDiagnosticEvent(session, {
        phase: "planning",
        status: "started",
        detail: `${service.shortLabel} 正在规划`
      });
      const planning = await planComposerSession({
        session,
        composerSettings,
        settings,
        signal,
        retrieveSources: (current, search) => retrieveSources(stored, current, search, composerSettings)
      });
      session = planning.session;
      if (planning.needsClarification) {
        return { session, visuals: [], generation: null };
      }
    }

    if (!job.remoteVideo || job.phase === "generation") {
      await context.progress({ phase: "generation", session });
    }
    const route = session.currentRoute || "compose";
    const instruction = session.currentInstruction || latestUserMessage(session);
    session = appendDiagnosticEvent(session, {
      phase: "streaming",
      status: "started",
      detail: session.outputMode === "create_image"
        ? "正在创建图片"
        : session.outputMode === "create_video" ? "正在创建视频" : "正在生成"
    });
    const executionSession = createComposerSession(session);
    const preparedImages = await prepareReferenceImages(executionSession, settings);
    const imageEdit = await prepareImageEdit(job.request.imageEdit);
    let phaseQueue = Promise.resolve();
    const result = await executeComposerTurnWithService({
      session: executionSession,
      userMessage: "",
      composerSettings,
      route,
      instruction,
      imageEdit
    }, settings, preparedImages, {
      signal,
      stream: false,
      onPhase: (phase) => {
        phaseQueue = phaseQueue.then(() => context.progress({ phase, session }));
      },
      remoteVideo: job.remoteVideo,
      onRemoteVideo: (remoteVideo) => {
        phaseQueue = phaseQueue.then(() => context.progress({ phase: "generation", session, remoteVideo }));
      },
      pollIntervalMs: context.pollIntervalMs
    });
    await phaseQueue;
    session = appendDiagnosticEvent(session, {
      phase: "streaming",
      status: "completed",
      detail: `输入 ${result.usage.promptTokens} / 输出 ${result.usage.completionTokens} tokens`
    });
    session = applyComposerServiceResult(session, result, composerSettings, route, instruction);

    if (!["image", "video"].includes(result.kind)) return { session, visuals: [], generation: null };
    await context.progress({ phase: "persisting", session });
    const visuals = [];
    for (const item of result.images ?? []) {
      const blob = item?.blob;
      if (!(blob instanceof Blob) || !blob.type.startsWith("image/") || !blob.size) {
        throw new Error("生图服务没有返回有效图片");
      }
      const { width, height } = await readImageDimensions(blob);
      assertImageDimensions(width, height);
      const id = globalThis.crypto.randomUUID();
      await saveScreenshotBlob(id, blob);
      savedIds.push(id);
      visuals.push({
        id,
        kind: "image",
        usage: "content",
        storageMode: "managed",
        mimeType: blob.type,
        width,
        height,
        byteSize: blob.size,
        capturedAt: new Date().toISOString(),
        reviewStatus: "unverified"
      });
    }
    for (const item of result.videos ?? []) {
      const blob = item?.blob;
      if (!(blob instanceof Blob) || !blob.type.startsWith("video/") || !blob.size) throw new Error("视频服务没有返回有效视频");
      const id = globalThis.crypto.randomUUID();
      const extension = blob.type === "video/webm" ? "webm" : "mp4";
      const file = new File([blob], `generated-video.${extension}`, { type: blob.type });
      const prepared = await prepareLocalMedia(file, id, {
        relativePath: file.name,
        readVideoMedia: readGeneratedVideoMedia
      });
      await saveMediaBlob(id, prepared.blob);
      savedIds.push(id);
      if (prepared.poster?.blob instanceof Blob) {
        await saveDerivedMedia(id, { thumbnail: prepared.poster.blob });
      }
      visuals.push({ ...prepared.asset, reviewStatus: "unverified" });
    }
    if (!visuals.length) throw new Error(result.kind === "video" ? "视频服务没有返回视频" : "生图服务没有返回图片");
    return {
      session,
      visuals,
      generation: {
        parentVisualId: job.request.imageEdit?.parentVisualId,
        editMode: job.request.imageEdit?.mode,
        serviceId: result.serviceId,
        requestModel: result.requestModel,
        responseModel: result.model,
        requestParameters: result.requestParameters,
        usage: result.providerUsage || result.usage,
        cost: result.cost,
        routing: result.routing,
        modification: job.request.imageEdit?.modification
      }
    };
  } catch (error) {
    await Promise.allSettled(savedIds.flatMap((id) => [deleteScreenshotBlob(id), deleteMediaBlob(id)]));
    throw error;
  }
}

function readGeneratedVideoMedia(blob, _mimeType, videoAssetId) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(blob);
    const finish = (value, error) => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(value);
    };
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = () => {
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(video, 0, 0, width, height);
        canvas.toBlob((posterBlob) => {
          const metadata = {
            width,
            height,
            durationMs: Math.max(1, Math.round(video.duration * 1000)),
            playbackCapability: "native"
          };
          if (!posterBlob) return finish({ metadata });
          finish({
            metadata,
            poster: {
              blob: posterBlob,
              asset: {
                id: `poster:${videoAssetId}`,
                kind: "image",
                usage: "poster",
                derivedFromAssetId: videoAssetId,
                storageMode: "managed",
                mimeType: posterBlob.type,
                byteSize: posterBlob.size,
                width,
                height,
                capturedAt: new Date().toISOString(),
                reviewStatus: "verified"
              }
            }
          });
        }, "image/webp", .82);
      } catch (error) {
        finish(null, error);
      }
    };
    video.onerror = () => finish(null, new Error("生成视频无法在当前浏览器中读取"));
    video.src = url;
  });
}

async function prepareReferenceImages(session, settings) {
  const profile = ["create_image", "create_video"].includes(session.outputMode)
    ? session.generationAiProfile
    : session.aiProfile;
  const service = selectedComposerService(profile, settings.ai, settings.vision);
  if (!service.vision) return [];
  const refs = [...new Map(session.referenceSnapshots
    .flatMap((reference) => reference.imageRefs)
    .map((item) => [item.visualId, item])).values()];
  return Promise.all(refs.map(async (imageRef) => {
    const blob = await getMediaBlob(imageRef.visualId) ?? await getScreenshotBlob(imageRef.visualId);
    if (!blob) throw new ComposerServiceError("有一张手选内容图已不存在，本次没有发送不完整参考", 422, { retryable: true });
    return { visualId: imageRef.visualId, mimeType: blob.type, dataUrl: await blobToDataUrl(blob) };
  }));
}

async function prepareImageEdit(value) {
  if (!value) return null;
  const baseBlob = await getScreenshotBlob(value.parentVisualId);
  if (!baseBlob) throw new ComposerServiceError("当前结果底图已经不存在", 422, { retryable: false });
  const maskBlob = value.mode === "local" ? await getScreenshotBlob(value.maskAssetId) : null;
  if (value.mode === "local" && !maskBlob) {
    throw new ComposerServiceError("局部修改遮罩已经不存在", 422, { retryable: false });
  }
  return {
    mode: value.mode,
    parentVisualId: value.parentVisualId,
    originalPrompt: value.originalPrompt,
    modification: value.modification,
    baseImage: { visualId: value.parentVisualId, dataUrl: await blobToDataUrl(baseBlob) },
    mask: maskBlob ? { dataUrl: await blobToDataUrl(maskBlob) } : null
  };
}

async function retrieveSources(stored, session, search, composerSettings) {
  const entries = materializeLogicalCases(stored.entries, stored.compoundCases);
  const documentIds = [...new Set(entries.flatMap((entry) => entryMediaAssets(entry))
    .filter((asset) => asset.kind === "document")
    .map((asset) => asset.id))];
  const derived = await Promise.all(documentIds.map(async (id) => [id, await getDerivedMedia(id).catch(() => null)]));
  const documentText = new Map(derived.flatMap(([id, value]) => value?.searchText ? [[id, value.searchText]] : []));
  const documentTextByEntryId = new Map(entries.flatMap((entry) => {
    const text = entryMediaAssets(entry).map((asset) => documentText.get(asset.id)).filter(Boolean).join("\n").trim();
    return text ? [[entry.id, text]] : [];
  }));
  const baseSession = createComposerSession({ ...session, retrievedSources: [] });
  const remainingCharacters = Math.max(
    0,
    COMPOSER_INPUT_MAX_CHARACTERS - composerInputUsage(baseSession, "", composerSettings).characters
  );
  return retrieveComposerSources({
    query: search.query,
    contentRoles: search.contentRoles,
    targetType: session.targetType,
    characterBudget: remainingCharacters,
    entries,
    facetCatalog: stored.facetCatalog,
    excludedEntryIds: session.referenceSnapshots.map((item) => item.entryId),
    searchIndex: buildSearchIndex(entries, stored.facetCatalog, documentText),
    documentTextByEntryId
  });
}

function latestUserMessage(session) {
  return [...session.messages].reverse().find((item) => item.role === "user")?.content || "";
}
