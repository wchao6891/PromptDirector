export const AI_TASKS = Object.freeze([
  { id: "text-tags", label: "文字标签", services: ["current-text", "xai"] },
  { id: "image-analysis", label: "图片分析", services: ["current-vision", "xai"] },
  { id: "video-analysis", label: "视频分析", services: ["gemini"] },
  { id: "skill-extraction", label: "Skill 提炼", services: ["current-text", "xai"] },
  { id: "creative-planning", label: "创作规划", services: ["current-text", "xai"] },
  { id: "image-generation", label: "图片生成", services: ["current-vision", "xai"] },
  { id: "video-generation", label: "视频生成", services: ["current-vision", "xai"] }
]);

export const AI_SERVICE_LABELS = Object.freeze({
  "current-text": "当前文字服务",
  "current-vision": "当前图片与生成服务",
  gemini: "Google Gemini",
  xai: "xAI"
});

export const GEMINI_API_ORIGIN = "https://generativelanguage.googleapis.com/*";
export const XAI_API_ORIGIN = "https://*.x.ai/*";

export function normalizeAiServiceProfiles(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    gemini: {
      apiKey: clean(source.gemini?.apiKey),
      model: clean(source.gemini?.model)
    },
    xai: {
      apiKey: clean(source.xai?.apiKey),
      textModel: clean(source.xai?.textModel),
      imageModel: clean(source.xai?.imageModel),
      videoModel: clean(source.xai?.videoModel),
      mediaConsent: source.xai?.mediaConsent === true
    }
  };
}

export function mergeAiServiceProfiles(currentValue = {}, incomingValue = {}) {
  const current = normalizeAiServiceProfiles(currentValue);
  const incoming = incomingValue && typeof incomingValue === "object" ? incomingValue : {};
  const next = normalizeAiServiceProfiles({
    gemini: {
      apiKey: clean(incoming.gemini?.apiKey) || current.gemini.apiKey,
      model: Object.hasOwn(incoming.gemini ?? {}, "model") ? incoming.gemini.model : current.gemini.model
    },
    xai: {
      apiKey: clean(incoming.xai?.apiKey) || current.xai.apiKey,
      textModel: Object.hasOwn(incoming.xai ?? {}, "textModel") ? incoming.xai.textModel : current.xai.textModel,
      imageModel: Object.hasOwn(incoming.xai ?? {}, "imageModel") ? incoming.xai.imageModel : current.xai.imageModel,
      videoModel: Object.hasOwn(incoming.xai ?? {}, "videoModel") ? incoming.xai.videoModel : current.xai.videoModel,
      mediaConsent: Object.hasOwn(incoming.xai ?? {}, "mediaConsent") ? incoming.xai.mediaConsent === true : current.xai.mediaConsent
    }
  });
  if (incoming.clearApiKey === "gemini") next.gemini.apiKey = "";
  if (incoming.clearApiKey === "xai") next.xai.apiKey = "";
  return next;
}

export function publicAiServiceProfiles(value = {}) {
  const profiles = normalizeAiServiceProfiles(value);
  return {
    gemini: { model: profiles.gemini.model, configured: Boolean(profiles.gemini.apiKey && profiles.gemini.model) },
    xai: {
      textModel: profiles.xai.textModel,
      imageModel: profiles.xai.imageModel,
      videoModel: profiles.xai.videoModel,
      mediaConsent: profiles.xai.mediaConsent,
      configured: Boolean(profiles.xai.apiKey && (profiles.xai.textModel || profiles.xai.imageModel || profiles.xai.videoModel))
    }
  };
}

export function normalizeAiTaskRoutes(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(AI_TASKS.map((task) => {
    const requested = clean(source[task.id]?.serviceId ?? source[task.id]);
    const serviceId = task.services.includes(requested) ? requested : task.services[0];
    return [task.id, { serviceId, model: clean(source[task.id]?.model) }];
  }));
}

export function resolveAiTaskRoute(taskId, routesValue = {}, context = {}) {
  const task = AI_TASKS.find((item) => item.id === taskId);
  if (!task) throw new Error("未知 AI 任务");
  const route = normalizeAiTaskRoutes(routesValue)[task.id];
  const profiles = normalizeAiServiceProfiles(context.profiles);
  const currentText = context.currentText ?? {};
  const currentVision = context.currentVision ?? {};
  if (route.serviceId === "gemini") {
    if (!profiles.gemini.apiKey || !(route.model || profiles.gemini.model)) throw new Error("视频分析需要先配置 Gemini API Key 和模型");
    return { taskId, serviceId: "gemini", provider: "Google Gemini", model: route.model || profiles.gemini.model };
  }
  if (route.serviceId === "xai") {
    const profileModel = taskId === "video-generation"
      ? profiles.xai.videoModel
      : taskId.includes("image") ? profiles.xai.imageModel : profiles.xai.textModel;
    const model = route.model || profileModel;
    if (!profiles.xai.apiKey || !model) throw new Error("所选任务需要先配置 xAI API Key 和对应模型");
    return { taskId, serviceId: "xai", provider: "xAI", model };
  }
  if (route.serviceId === "current-vision") {
    if (!currentVision.configured) throw new Error("当前图片与生成服务尚未完成配置");
    return { taskId, serviceId: route.serviceId, provider: currentVision.provider || "当前图片与生成服务", model: route.model || currentVision.model };
  }
  if (!currentText.configured) throw new Error("当前文字服务尚未完成配置");
  return { taskId, serviceId: route.serviceId, provider: currentText.provider || "当前文字服务", model: route.model || currentText.model };
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
