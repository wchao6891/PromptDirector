const MICU_1K_IMAGE_SIZES = Object.freeze([
  "1024x1024",
  "1280x720",
  "720x1280",
  "1024x1536",
  "1536x1024"
]);

const MICU_2K_IMAGE_SIZES = Object.freeze([
  "2048x2048",
  "2048x1152",
  "1152x2048"
]);

const MICU_4K_IMAGE_SIZES = Object.freeze([
  "3840x2160",
  "2160x3840"
]);

const micuImageModels = Object.freeze({
  "gpt-image-2": Object.freeze({
    sizes: Object.freeze([...MICU_1K_IMAGE_SIZES, ...MICU_2K_IMAGE_SIZES])
  }),
  "gpt-image-2-openai": Object.freeze({
    sizes: Object.freeze([...MICU_1K_IMAGE_SIZES, ...MICU_2K_IMAGE_SIZES, ...MICU_4K_IMAGE_SIZES])
  })
});

// Verified provider capability:
// https://docs.micuapi.ai/tools#micu-image-mcp
// https://github.com/Subaru486desuwa/micu-image-mcp
export const MICU_COMPATIBLE_PROVIDER_PRESET = Object.freeze({
  id: "micu-personal",
  label: "米醋",
  hostname: "micuapi.ai",
  protocol: "responses",
  endpoint: "https://www.micuapi.ai/v1/responses",
  defaultChatModel: "gpt-5.4-mini",
  imageGeneration: Object.freeze({
    protocol: "images_generations",
    endpoint: "https://www.micuapi.ai/v1/images/generations",
    editsEndpoint: "https://www.micuapi.ai/v1/images/edits",
    defaultModel: "gpt-image-2",
    defaultSize: "1536x1024",
    models: micuImageModels
  })
});

export function compatibleProviderPresetForEndpoint(value) {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase("en-US");
    const suffix = MICU_COMPATIBLE_PROVIDER_PRESET.hostname;
    return hostname === suffix || hostname.endsWith(`.${suffix}`)
      ? MICU_COMPATIBLE_PROVIDER_PRESET
      : null;
  } catch {
    return null;
  }
}

export function compatibleImageSizesFor(providerEndpoint, image = {}) {
  const preset = compatibleProviderPresetForEndpoint(providerEndpoint);
  if (preset && image.protocol === preset.imageGeneration.protocol) {
    const model = preset.imageGeneration.models[String(image.model ?? "").trim()];
    if (model) return [...model.sizes];
  }
  return Array.isArray(image.sizes) ? [...image.sizes] : [];
}
