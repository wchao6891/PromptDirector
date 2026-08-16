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

export function publicAiServiceProfiles(value = {}) {
  const profiles = normalizeAiServiceProfiles(value);
  return {
    gemini: {
      model: profiles.gemini.model,
      configured: Boolean(profiles.gemini.apiKey && profiles.gemini.model)
    },
    xai: {
      textModel: profiles.xai.textModel,
      imageModel: profiles.xai.imageModel,
      videoModel: profiles.xai.videoModel,
      mediaConsent: profiles.xai.mediaConsent,
      configured: Boolean(profiles.xai.apiKey && (
        profiles.xai.textModel || profiles.xai.imageModel || profiles.xai.videoModel
      ))
    }
  };
}

function clean(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}
