export const COMPOSER_DIAGNOSTIC_VERSION = 2;

export function composerOutputChecks(sessionValue = {}, promptVersionValue = null) {
  const text = String(promptVersionValue?.text ?? sessionValue.promptVersions?.at?.(-1)?.text ?? "").trim();
  const targetType = sessionValue.targetType === "video" ? "video" : "image";
  const checks = [
    check("complete-output", Boolean(text), "最终输出完整", "还没有可检查的最终输出"),
    check(
      "self-contained",
      !/@(?:参考|Reference)\s*\d+|参考(?:上文|图|视频|素材)|attached reference/i.test(text),
      "最终提示词不依赖参考编号",
      "最终提示词仍依赖参考编号或外部素材"
    ),
    check(
      "placeholder-consistency",
      !claimsReplaceablePlaceholder(text) || /【[^【】]+】/.test(text),
      "占位符说明与正文一致",
      "输出声称可以替换占位符，但没有真实的【】区域"
    ),
    check(
      "target-type",
      targetType === "video" || !hasExplicitTimeline(text),
      `输出结构符合${targetType === "video" ? "视频" : "图片"}任务`,
      "图片提示词中出现了明确时间轴或编号分镜，可能误生成了视频提示词"
    )
  ];
  if (sessionValue.appliedSkills?.length) {
    checks.push(check(
      "creative-skill-context",
      sessionValue.appliedSkills.every((skill) => String(skill.skillMarkdown ?? "").trim()),
      "已应用 Skill 均保存了具体版本快照",
      "有 Skill 缺少可执行版本快照"
    ));
  }
  return checks;
}

export function buildComposerDiagnostic(sessionValue = {}) {
  const session = structuredClone(sessionValue);
  const promptVersions = (session.promptVersions ?? []).map((version) => ({
    ...version,
    checks: composerOutputChecks(session, version)
  }));
  return {
    schema: "promptdirector-composer-diagnostic",
    version: COMPOSER_DIAGNOSTIC_VERSION,
    exportedAt: new Date().toISOString(),
    session: {
      id: String(session.id ?? ""),
      title: String(session.title ?? ""),
      targetType: session.targetType === "video" ? "video" : "image",
      targetPlatform: String(session.targetPlatform ?? ""),
      outputLanguage: String(session.outputLanguage ?? ""),
      aiProfile: session.aiProfile ?? null,
      productionReviewEnabled: session.productionReviewEnabled !== false,
      appliedSkills: session.appliedSkills ?? [],
      references: (session.referenceSnapshots ?? []).map(({ entryId, alias, referenceKind, referenceText }) => ({
        entryId,
        alias,
        referenceKind,
        referenceText
      })),
      messages: session.messages ?? [],
      promptVersions,
      currentInstruction: String(session.currentInstruction ?? ""),
      retrievedSources: session.retrievedSources ?? [],
      diagnosticEvents: session.diagnosticEvents ?? [],
      lastFailure: session.lastFailure ?? null,
      updatedAt: session.updatedAt ?? ""
    }
  };
}

export function diagnosticFilename(title = "") {
  const safe = String(title).trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").slice(0, 60) || "未命名对话";
  return `PromptDirector-诊断-${safe}.json`;
}

function claimsReplaceablePlaceholder(text) {
  return /替换.{0,8}(?:括号|占位符)|replace.{0,12}(?:bracket|placeholder)/i.test(text);
}

function hasExplicitTimeline(text) {
  return /\b\d+\s*(?:-|–|—|至)\s*\d+\s*(?:s|秒)\b|(?:镜头|shot)\s*(?:#|：|:)?\s*\d+/i.test(text);
}

function check(id, passed, passedMessage, failedMessage) {
  return { id, status: passed ? "passed" : "failed", message: passed ? passedMessage : failedMessage };
}
