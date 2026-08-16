const TEXT_CAPABILITIES = Object.freeze(["textTags", "skillExtraction", "creativePlanning"]);

function preset(value) {
  return Object.freeze({
    ...value,
    discovery: Object.freeze({ ...value.discovery }),
    capabilities: Object.freeze([...value.capabilities]),
    catalogRequiredTasks: Object.freeze([...(value.catalogRequiredTasks ?? [])])
  });
}

export const AI_PROVIDER_PRESETS = Object.freeze([
  preset({
    id: "deepseek",
    label: "DeepSeek",
    category: "official",
    endpoint: "https://api.deepseek.com/chat/completions",
    protocol: "chat_completions",
    discovery: { adapter: "identity" },
    capabilities: TEXT_CAPABILITIES
  }),
  preset({
    id: "openai",
    label: "OpenAI",
    category: "official",
    endpoint: "https://api.openai.com/v1/responses",
    protocol: "responses",
    discovery: { adapter: "identity" },
    capabilities: [...TEXT_CAPABILITIES, "imageAnalysis", "imageGeneration", "videoGeneration"]
  }),
  preset({
    id: "gemini",
    label: "Google Gemini",
    category: "official",
    endpoint: "https://generativelanguage.googleapis.com",
    protocol: "gemini",
    discovery: { adapter: "gemini" },
    capabilities: [...TEXT_CAPABILITIES, "imageAnalysis", "videoAnalysis", "imageGeneration", "videoGeneration"],
    catalogRequiredTasks: ["imageGeneration"]
  }),
  preset({
    id: "xai",
    label: "xAI",
    category: "official",
    endpoint: "https://api.x.ai/v1",
    protocol: "xai",
    discovery: { adapter: "xai" },
    capabilities: [...TEXT_CAPABILITIES, "imageAnalysis", "imageGeneration", "videoGeneration"]
  }),
  preset({
    id: "kimi",
    label: "Kimi",
    category: "official",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    protocol: "chat_completions",
    discovery: { adapter: "kimi" },
    capabilities: [...TEXT_CAPABILITIES, "imageAnalysis", "videoAnalysis"]
  }),
  preset({
    id: "minimax",
    label: "MiniMax",
    category: "official",
    endpoint: "https://api.minimaxi.com/v1",
    protocol: "minimax_videos",
    discovery: { adapter: "configured_video" },
    capabilities: ["videoGeneration"]
  }),
  preset({
    id: "volcengine",
    label: "火山引擎",
    category: "official",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    protocol: "ark_videos",
    discovery: { adapter: "configured_video" },
    capabilities: ["videoGeneration"]
  }),
  preset({
    id: "openrouter",
    label: "OpenRouter",
    category: "aggregator",
    endpoint: "https://openrouter.ai/api/v1",
    protocol: "openrouter",
    discovery: { adapter: "openrouter" },
    capabilities: [...TEXT_CAPABILITIES, "imageAnalysis", "videoAnalysis", "imageGeneration", "videoGeneration"]
  }),
  preset({
    id: "custom-text",
    label: "自定义兼容服务（文字）",
    category: "custom",
    endpoint: "",
    protocol: "chat_completions",
    discovery: { adapter: "identity" },
    capabilities: TEXT_CAPABILITIES
  }),
  preset({
    id: "custom-media",
    label: "自定义兼容服务（图片与生成）",
    category: "custom",
    endpoint: "",
    protocol: "chat_completions",
    discovery: { adapter: "identity" },
    capabilities: ["imageAnalysis", "imageGeneration"]
  })
]);

export function getAiProviderPreset(idValue) {
  const id = String(idValue ?? "").trim();
  return AI_PROVIDER_PRESETS.find((item) => item.id === id) ?? null;
}
