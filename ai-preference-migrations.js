// Exact prior defaults belong to migration evidence, not active model instructions.
const VIDEO_V2_DEFAULTS = {
  "zh-CN": "从创意导演与视频生成的角度，忠实逆推成片中可见的主体、场景、镜头时间线、运镜、动作、转场、光色、材质、文字与连续性约束。优先保留决定复现效果的证据，不补写画面之外的信息。",
  en: "Reverse-engineer the visible subject, setting, shot timeline, camera movement, action, transitions, lighting, materials, on-screen text, and continuity constraints for faithful video recreation. Preserve the evidence that controls the result and do not invent anything outside the frames."
};

export function migratedVideoMethod(preferences, locale, defaults) {
  const value = String(preferences.videoInstructionsByLocale?.[locale] ?? "").trim();
  return !value || (Number(preferences.version || 0) < 3 && value === VIDEO_V2_DEFAULTS[locale])
    ? defaults[locale] : value;
}
