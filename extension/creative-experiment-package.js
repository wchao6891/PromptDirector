import {
  normalizeComposerSessions,
  normalizeComposerSettings
} from "./composer.js";
import {
  normalizeCreativeExperimentSettings,
  normalizeCreativeRuns
} from "./creative-runs.js";
import { formatBytes, portableLibraryLimits } from "./resource-limits.js";

export const CREATIVE_EXPERIMENT_PACKAGE_FORMAT = "promptdirector-creative-experiments";
export const CREATIVE_EXPERIMENT_PACKAGE_VERSION = 2;

export function buildCreativeExperimentPackage(state = {}, visualPaths = {}) {
  const runs = normalizeCreativeRuns(state.creativeRuns);
  const sessionIds = new Set(runs.map((run) => run.sessionId));
  const sessions = normalizeComposerSessions(state.composerSessions)
    .filter((session) => sessionIds.has(session.id));
  return {
    format: CREATIVE_EXPERIMENT_PACKAGE_FORMAT,
    version: CREATIVE_EXPERIMENT_PACKAGE_VERSION,
    exportedAt: new Date().toISOString(),
    composerSettings: normalizeComposerSettings(state.composerSettings),
    experimentSettings: normalizeCreativeExperimentSettings(state.creativeExperimentSettings),
    sessions,
    runs: runs.map((run) => ({
      ...run,
      outputs: run.outputs.map((output) => {
        const assetPath = clean(visualPaths[output.visual.id]);
        if (!isResultPath(assetPath)) throw new Error("创作结果缺少实验包媒体路径");
        const { screenshotPath: _screenshotPath, ...visual } = output.visual;
        return { ...output, visual: { ...visual, assetPath } };
      })
    }))
  };
}

export function parseCreativeExperimentPackage(value, files = new Map(), limitsValue = {}) {
  const limits = portableLibraryLimits(limitsValue);
  if (!value || value.format !== CREATIVE_EXPERIMENT_PACKAGE_FORMAT ||
      ![1, CREATIVE_EXPERIMENT_PACKAGE_VERSION].includes(value.version) ||
      !Array.isArray(value.runs) || !Array.isArray(value.sessions)) {
    throw new Error("这不是受支持的 PromptDirector 创作实验包");
  }
  const data = structuredClone(value);
  data.composerSettings = normalizeComposerSettings(data.composerSettings);
  data.experimentSettings = normalizeCreativeExperimentSettings(data.experimentSettings);
  data.sessions = normalizeComposerSessions(data.sessions);
  data.runs = normalizeCreativeRuns(data.runs);
  const sessionIds = new Set(data.sessions.map((session) => session.id));
  const assets = new Map();
  for (const run of data.runs) {
    if (!sessionIds.has(run.sessionId)) throw new Error("创作实验包缺少结果对应的对话");
    for (const output of run.outputs) {
      const path = resultAssetPath(output.visual);
      if (!isResultPath(path)) throw new Error("创作实验包包含无效的结果媒体路径");
      const asset = files.get(path);
      const video = output.visual.kind === "video" || String(output.visual.mimeType ?? "").startsWith("video/");
      if (!(asset instanceof Blob) || !asset.type.startsWith(video ? "video/" : "image/")) {
        throw new Error(`创作实验包缺少结果${video ? "视频" : "图片"}`);
      }
      if (!video && asset.size > limits.maxImageBytes) {
        throw new Error(`创作结果图片超过 ${formatBytes(limits.maxImageBytes)} 上限`);
      }
      if (assets.has(output.visual.id)) throw new Error("创作实验包包含重复的结果媒体编号");
      assets.set(output.visual.id, asset);
    }
  }
  const images = new Map([...assets].filter(([, asset]) => asset.type.startsWith("image/")));
  return { ...data, assets, images };
}

export function mergeCreativeExperimentPackage(current = {}, importedValue = {}, options = {}) {
  const imported = parseCreativeExperimentPackage(
    importedValue,
    placeholderAssets(importedValue)
  );
  const sessions = normalizeComposerSessions(current.composerSessions);
  const runs = normalizeCreativeRuns(current.creativeRuns);
  const usedSessionIds = new Set(sessions.map((item) => item.id));
  const usedRunIds = new Set(runs.map((item) => item.id));
  const usedVisualIds = new Set(runs.flatMap((run) => run.outputs.map((output) => output.visual.id)));
  const sessionIdMap = {};
  const runIdMap = {};
  const visualIdMap = {};
  const importedSessions = imported.sessions.map((source) => {
    const session = structuredClone(source);
    const sourceId = session.id;
    if (usedSessionIds.has(session.id)) {
      const preferred = clean(options.sessionIdMap?.[sourceId]);
      session.id = preferred && !usedSessionIds.has(preferred)
        ? preferred
        : uniqueId("session", usedSessionIds);
    }
    usedSessionIds.add(session.id);
    sessionIdMap[sourceId] = session.id;
    return session;
  });
  const importedRuns = imported.runs.map((source) => {
    const run = withoutPaths(source);
    const sourceRunId = run.id;
    if (usedRunIds.has(run.id)) {
      const preferred = clean(options.runIdMap?.[sourceRunId]);
      run.id = preferred && !usedRunIds.has(preferred)
        ? preferred
        : uniqueId("run", usedRunIds);
    }
    usedRunIds.add(run.id);
    runIdMap[sourceRunId] = run.id;
    run.sessionId = sessionIdMap[run.sessionId] ?? run.sessionId;
    run.outputs = run.outputs.map((output) => {
      const sourceId = output.visual.id;
      const preferred = clean(options.visualIdMap?.[sourceId]);
      const targetId = usedVisualIds.has(sourceId)
        ? preferred && !usedVisualIds.has(preferred)
          ? preferred
          : uniqueId("creative-visual", usedVisualIds)
        : sourceId;
      usedVisualIds.add(targetId);
      visualIdMap[sourceId] = targetId;
      return { ...output, visual: { ...output.visual, id: targetId } };
    });
    return run;
  });
  return {
    state: {
      ...structuredClone(current),
      composerSettings: normalizeComposerSettings(current.composerSettings ?? imported.composerSettings),
      composerSessions: normalizeComposerSessions([...sessions, ...importedSessions]),
      creativeExperimentSettings: normalizeCreativeExperimentSettings(
        current.creativeExperimentSettings ?? imported.experimentSettings
      ),
      creativeRuns: normalizeCreativeRuns([...runs, ...importedRuns])
    },
    sessionIdMap,
    runIdMap,
    visualIdMap,
    importedRunCount: importedRuns.length,
    importedOutputCount: importedRuns.reduce((sum, run) => sum + run.outputs.length, 0)
  };
}

function placeholderAssets(value) {
  return new Map(normalizeCreativeRuns(value?.runs).flatMap((run) =>
    run.outputs.map((output) => [
      resultAssetPath(output.visual),
      new Blob(["placeholder"], { type: assetType(output.visual) })
    ])
  ));
}

function withoutPaths(runValue) {
  const run = structuredClone(runValue);
  run.outputs = run.outputs.map((output) => {
    const { screenshotPath: _screenshotPath, assetPath: _assetPath, ...visual } = output.visual;
    return { ...output, visual };
  });
  return run;
}

function resultAssetPath(visual = {}) {
  return clean(visual.assetPath || visual.screenshotPath);
}

function isResultPath(value) {
  return /^results\/[A-Za-z0-9._/-]+\.(?:png|jpe?g|webp|mp4|webm|mov)$/i.test(value) && !value.includes("..");
}

function assetType(visual = {}) {
  const declared = clean(visual.mimeType);
  if (declared.startsWith("image/") || declared.startsWith("video/")) return declared;
  const path = resultAssetPath(visual);
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.mp4$/i.test(path)) return "video/mp4";
  if (/\.webm$/i.test(path)) return "video/webm";
  if (/\.mov$/i.test(path)) return "video/quicktime";
  return "image/webp";
}

function uniqueId(prefix, used) {
  let id;
  do id = `${prefix}:${globalThis.crypto.randomUUID()}`; while (used.has(id));
  return id;
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}
