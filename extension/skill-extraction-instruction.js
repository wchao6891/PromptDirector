export function defaultSkillExtractionInstruction(localeValue = 'zh-CN') {
  return localeValue === 'en'
    ? 'Extract reusable methods that serve the stated goal. Separate transferable decisions from source-specific details. Preserve variables, alternatives and decision boundaries. Make the method self-contained: another agent must be able to use it without this conversation or numbered references. Keep source examples and model-specific syntax conditional, rather than turning them into universal requirements. Write imperative instructions. Check that alternative branches and quality constraints do not contradict one another.'
    : '提炼服务于当前目标的可复用方法，区分可迁移决策与案例专属细节，保留变量、可选路线和判断边界。正文必须自包含，另一个 Agent 无需原对话或参考编号也能使用。案例中的具体数值、主体特征和模型专属语法只作有条件的示例，不转成普遍强制要求。用命令式写步骤，检查不同路线与质量约束是否互相冲突。';
}
