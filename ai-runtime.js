import { normalizeAiSettings } from "./deepseek.js";
import { getAiModelCapability } from "./ai-model-capabilities.js";
import { normalizeVisionSettings } from "./vision.js";
import {
  normalizeAiProviderRegistry,
  normalizeAiTaskAssignments,
  resolveAiProviderAssignment
} from "./ai-provider-registry.js";

const TEXT_TASKS = new Set(["textTags", "skillExtraction", "creativePlanning"]);

export const AI_RUNTIME_PROTOCOL_VERSION = 2;

export function requireAiRuntimeProtocolVersion(value) {
  if (Number(value) !== AI_RUNTIME_PROTOCOL_VERSION) {
    throw new Error("创作台页面与扩展后台不是同一版本。请在浏览器扩展管理页重新加载 PromptDirector，再回到本轮继续；本轮内容不会丢失，也没有发起付费请求");
  }
  return true;
}

export function aiConfigurationFromStorage(stored = {}) {
  const registry = normalizeAiProviderRegistry(stored.aiProviderRegistry);
  return {
    registry,
    assignments: normalizeAiTaskAssignments(stored.aiTaskAssignments, registry),
    preferences: normalizeAiPreferences(stored.aiPreferences)
  };
}

export function normalizeAiPreferences(value = {}) {
  const text = normalizeAiSettings();
  const vision = normalizeVisionSettings();
  const source = value && typeof value === "object" ? value : {};
  return {
    version: 1,
    textInstructionsByLocale: {
      "zh-CN": clean(source.textInstructionsByLocale?.["zh-CN"]) || text.analysisInstructionsByLocale["zh-CN"],
      en: clean(source.textInstructionsByLocale?.en) || text.analysisInstructionsByLocale.en
    },
    visionInstructionsByLocale: {
      "zh-CN": clean(source.visionInstructionsByLocale?.["zh-CN"]) || vision.instructionsByLocale["zh-CN"],
      en: clean(source.visionInstructionsByLocale?.en) || vision.instructionsByLocale.en
    },
    autoAnalyzeImports: Object.hasOwn(source, "autoAnalyzeImports")
      ? source.autoAnalyzeImports === true
      : vision.autoAnalyzeImports
  };
}

export function projectAiRuntime(configurationValue = {}) {
  const configuration = normalizeConfiguration(configurationValue);
  const { registry, assignments, preferences } = configuration;
  const providers = registry.providers;
  const providerProfiles = providerProfilesWithAssignments(providers, assignments);
  const planning = settingsForTextAssignment(assignments.creativePlanning, providers, preferences, false);
  const imageAnalysis = assignments.imageAnalysis;
  const imageAnalysisProfile = providers[imageAnalysis.providerId] ?? providers["custom-media"];
  const imageAnalysisUsesOpenAi = imageAnalysis.providerId === "openai";
  const openai = providers.openai;
  const customMedia = providers["custom-media"];
  const vision = normalizeVisionSettings({
    activeProvider: imageAnalysisUsesOpenAi ? "openai" : "compatible",
    consent: true,
    autoAnalyzeImports: preferences.autoAnalyzeImports,
    instructionsByLocale: preferences.visionInstructionsByLocale,
    openai: {
      model: imageAnalysisUsesOpenAi
        ? assignments.imageAnalysis.model
        : openai?.models?.imageAnalysis || openai?.models?.imageGeneration || "",
      apiKey: usableKey(openai),
      videoGeneration: {
        ...(providers.openai?.videoGeneration ?? {}),
        model: assignments.videoGeneration.providerId === "openai" ? assignments.videoGeneration.model : ""
      }
    },
    compatible: {
      protocol: imageAnalysisProfile?.protocol === "responses" ? "responses" : "chat_completions",
      structuredOutput: imageAnalysisProfile?.structuredOutput,
      imageBase64: imageAnalysisProfile?.mediaInput?.imageBase64,
      endpoint: clean(imageAnalysis?.providerId) ? chatEndpoint(imageAnalysisProfile) : "",
      model: !imageAnalysisUsesOpenAi ? assignments.imageAnalysis.model : "",
      apiKey: !imageAnalysisUsesOpenAi ? usableKey(imageAnalysisProfile) : "",
      imageGeneration: {
        ...(customMedia?.imageGeneration ?? {}),
        model: assignments.imageGeneration.providerId === "custom-media"
          ? assignments.imageGeneration.model
          : customMedia?.models?.imageGeneration || customMedia?.imageGeneration?.model || "",
        apiKey: usableKey(customMedia, true, "imageGeneration")
      }
    },
    nativeProvider: imageAnalysis.providerId === "gemini" ? {
      id: "gemini",
      endpoint: imageAnalysisProfile.endpoint,
      apiKey: imageAnalysisProfile.apiKey,
      model: imageAnalysis.model
    } : null
  });
  if (!clean(imageAnalysis?.providerId)) {
    vision.activeProvider = "compatible";
    vision.openai.model = "";
    vision.compatible.endpoint = "";
    vision.compatible.model = "";
  }
  const xai = providers.xai;
  const xaiRuntime = {
    apiKey: usableKey(xai),
    textModel: assignments.creativePlanning.providerId === "xai" ? assignments.creativePlanning.model : "",
    imageModel: assignments.imageGeneration.providerId === "xai"
      ? assignments.imageGeneration.model
      : assignments.imageAnalysis.providerId === "xai" ? assignments.imageAnalysis.model : "",
    videoModel: assignments.videoGeneration.providerId === "xai" ? assignments.videoGeneration.model : "",
    mediaConsent: xai?.consent === true
  };
  return {
    aiSettings: planning,
    visionSettings: {
      ...vision,
      providerProfiles,
      xai: xaiRuntime
    },
    aiServiceProfiles: {
      gemini: {
        apiKey: usableKey(providers.gemini, false),
        model: assignments.videoAnalysis.providerId === "gemini" ? assignments.videoAnalysis.model : ""
      },
      xai: {
        apiKey: usableKey(xai),
        textModel: assignments.creativePlanning.providerId === "xai" ? assignments.creativePlanning.model : "",
        imageModel: assignments.imageGeneration.providerId === "xai"
          ? assignments.imageGeneration.model
          : assignments.imageAnalysis.providerId === "xai" ? assignments.imageAnalysis.model : "",
        videoModel: assignments.videoGeneration.providerId === "xai" ? assignments.videoGeneration.model : "",
        mediaConsent: xai?.consent === true
      }
    },
    aiTaskAssignments: assignments,
    aiProviderRegistry: registry,
    aiPreferences: preferences
  };
}

function providerProfilesWithAssignments(providers = {}, assignments = {}) {
  return Object.fromEntries(Object.entries(providers).map(([providerId, profile]) => [providerId, {
    ...profile,
    models: {
      ...profile.models,
      ...Object.fromEntries(Object.entries(assignments).flatMap(([taskId, assignment]) =>
        assignment?.providerId === providerId && clean(assignment.model)
          ? [[taskId, clean(assignment.model)]]
          : []
      ))
    }
  }]));
}

export function resolveTextTaskSettings(taskId, configurationValue = {}, options = {}) {
  if (!TEXT_TASKS.has(taskId)) throw new Error("这不是文字任务");
  const configuration = normalizeConfiguration(configurationValue);
  if (options.requireConfigured === false) {
    return settingsForTextAssignment(configuration.assignments[taskId], configuration.registry.providers, configuration.preferences, false);
  }
  const resolved = resolveAiProviderAssignment(taskId, configuration.registry, configuration.assignments);
  const profile = configuration.registry.providers[resolved.providerId];
  requireConsent(profile, resolved.provider);
  return settingsForTextAssignment(resolved, configuration.registry.providers, configuration.preferences, true);
}

export function resolveVisionTaskSettings(taskId, configurationValue = {}, options = {}) {
  if (!["imageAnalysis", "imageGeneration"].includes(taskId)) throw new Error("这不是图片任务");
  const configuration = normalizeConfiguration(configurationValue);
  const resolved = options.requireConfigured === false
    ? configuration.assignments[taskId]
    : resolveAiProviderAssignment(taskId, configuration.registry, configuration.assignments);
  if (options.requireConfigured === false && !clean(resolved?.providerId)) {
    const settings = normalizeVisionSettings({
      activeProvider: "compatible",
      consent: false,
      autoAnalyzeImports: configuration.preferences.autoAnalyzeImports,
      instructionsByLocale: configuration.preferences.visionInstructionsByLocale
    });
    settings.openai.model = "";
    settings.compatible.endpoint = "";
    settings.compatible.model = "";
    return settings;
  }
  const profile = configuration.registry.providers[resolved.providerId];
  if (options.requireConfigured !== false) requireConsent(profile, resolved.provider);
  const modelRuntime = modelRuntimeSettings(profile, resolved.model);
  const openai = resolved.providerId === "openai";
  const endpoint = chatEndpoint(profile);
  const settings = normalizeVisionSettings({
    activeProvider: openai ? "openai" : "compatible",
    consent: true,
    autoAnalyzeImports: configuration.preferences.autoAnalyzeImports,
    instructionsByLocale: configuration.preferences.visionInstructionsByLocale,
    openai: {
      model: resolved.model,
      apiKey: openai ? profile.apiKey : "",
      videoGeneration: profile.videoGeneration
    },
    compatible: {
      protocol: profile.protocol === "responses" ? "responses" : "chat_completions",
      structuredOutput: modelRuntime.structuredOutput,
      imageBase64: modelRuntime.mediaInput.imageBase64,
      endpoint,
      model: resolved.model,
      apiKey: openai ? "" : profile.apiKey,
      imageGeneration: {
        ...(profile.imageGeneration ?? {}),
        model: taskId === "imageGeneration" ? resolved.model : profile.models.imageGeneration,
        apiKey: openai ? "" : usableKey(profile, true, "imageGeneration")
      }
    },
    nativeProvider: resolved.providerId === "gemini" ? {
      id: "gemini",
      endpoint: profile.endpoint,
      apiKey: profile.apiKey,
      model: resolved.model
    } : null
  });
  settings.openai.model = openai ? clean(resolved.model) : "";
  settings.compatible.model = openai ? "" : clean(resolved.model);
  return settings;
}

export function resolveVideoAnalysisTask(configurationValue = {}) {
  const configuration = normalizeConfiguration(configurationValue);
  const resolved = resolveAiProviderAssignment("videoAnalysis", configuration.registry, configuration.assignments);
  const profile = configuration.registry.providers[resolved.providerId];
  requireConsent(profile, resolved.provider);
  const modelRuntime = modelRuntimeSettings(profile, resolved.model);
  return {
    ...resolved,
    providerLabel: resolved.provider,
    protocol: profile.protocol,
    apiKey: profile.apiKey,
    endpoint: profile.endpoint,
    ...(modelRuntime.structuredOutputTokenBudget ? { maxOutputTokens: modelRuntime.structuredOutputTokenBudget } : {}),
    ...(["unsupported", "base64"].includes(modelRuntime.mediaInput.localVideo) ? { localVideo: modelRuntime.mediaInput.localVideo } : {}),
    ...(modelRuntime.mediaInput.preferPublicVideoUrl === true ? { preferPublicVideoUrl: true } : {}),
    ...(modelRuntime.mediaInput.publicVideoUrl === "direct" ? { publicVideoUrl: "direct" } : {})
  };
}

export function videoAnalysisRouteSnapshot(value = {}) {
  return {
    providerId: clean(value.providerId),
    model: clean(value.model),
    protocol: clean(value.protocol),
    endpoint: clean(value.endpoint),
    localVideo: ["unsupported", "base64"].includes(value.localVideo) ? value.localVideo : "",
    preferPublicVideoUrl: value.preferPublicVideoUrl === true,
    publicVideoUrl: value.publicVideoUrl === "direct" ? "direct" : ""
  };
}

export function videoAnalysisRouteMatches(left, right) {
  const expected = videoAnalysisRouteSnapshot(left);
  const actual = videoAnalysisRouteSnapshot(right);
  return Object.keys(expected).every((key) => expected[key] === actual[key]);
}

function settingsForTextAssignment(assignmentValue, providers, preferences, strict) {
  const providerId = clean(assignmentValue?.providerId);
  if (!providerId) {
    if (strict) throw new Error("文字任务尚未分配 AI 服务");
    const settings = normalizeAiSettings({
      activeProvider: "compatible",
      consent: false,
      analysisInstructionsByLocale: preferences.textInstructionsByLocale,
      compatible: { endpoint: "", model: "", apiKey: "" }
    });
    settings.analysisModel = "";
    return settings;
  }
  const profile = providers[providerId];
  if (strict) requireConsent(profile, profile?.label || providerId);
  const model = clean(assignmentValue?.model);
  const modelRuntime = modelRuntimeSettings(profile, model);
  const deepseek = providerId === "deepseek";
  const settings = normalizeAiSettings({
    activeProvider: deepseek ? "deepseek" : "compatible",
    apiKey: deepseek ? profile?.apiKey : "",
    analysisModel: deepseek ? model : undefined,
    consent: strict ? true : profile?.consent === true,
    analysisInstructionsByLocale: preferences.textInstructionsByLocale,
    compatible: deepseek ? undefined : {
      label: profile?.label,
      endpoint: chatEndpoint(profile),
      model,
      apiKey: profile?.apiKey,
      structuredOutput: modelRuntime.structuredOutput,
      structuredOutputTokenBudget: modelRuntime.structuredOutputTokenBudget
    }
  });
  settings.analysisModel = model;
  settings.compatible.model = deepseek ? "" : model;
  return settings;
}

function modelRuntimeSettings(profile = {}, modelValue = "") {
  const capability = getAiModelCapability(profile?.id, modelValue);
  return {
    structuredOutput: capability?.structuredOutput ?? profile?.structuredOutput,
    structuredOutputTokenBudget: capability?.structuredOutputTokenBudget,
    mediaInput: {
      ...(profile?.mediaInput ?? {}),
      ...(capability?.mediaInput ?? {})
    }
  };
}

function normalizeConfiguration(value = {}) {
  const registry = normalizeAiProviderRegistry(value.registry ?? value.aiProviderRegistry);
  return {
    registry,
    assignments: normalizeAiTaskAssignments(value.assignments ?? value.aiTaskAssignments, registry),
    preferences: normalizeAiPreferences(value.preferences ?? value.aiPreferences)
  };
}

function chatEndpoint(profile = {}) {
  if (profile.id === "deepseek") return "https://api.deepseek.com/chat/completions";
  if (profile.id === "openai") return "https://api.openai.com/v1/chat/completions";
  if (profile.id === "xai") return "https://api.x.ai/v1/chat/completions";
  if (profile.id === "openrouter") return `${clean(profile.endpoint).replace(/\/$/, "")}/chat/completions`;
  if (profile.id === "gemini") return `${clean(profile.endpoint).replace(/\/$/, "")}/v1beta/openai/chat/completions`;
  return clean(profile.endpoint);
}

function usableKey(profile, requireConsent = true, taskId = "") {
  const imageKey = profile?.imageGeneration?.apiKey;
  const key = taskId === "imageGeneration"
    ? imageKey || (requiresDedicatedImageCredential(profile) ? "" : profile?.apiKey)
    : profile?.apiKey;
  return profile && (!requireConsent || profile.consent === true) ? clean(key) : "";
}

function requiresDedicatedImageCredential(profile = {}) {
  if (profile.imageGeneration?.protocol !== "images_generations") return false;
  try {
    const endpoint = profile.imageGeneration?.endpoint || profile.endpoint;
    return new URL(endpoint).hostname.toLocaleLowerCase("en-US").endsWith("micuapi.ai");
  } catch {
    return false;
  }
}

function requireConsent(profile, label) {
  if (!profile?.consent) throw new Error(`${label || "所选 AI 服务"} 尚未确认发送范围`);
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
}
