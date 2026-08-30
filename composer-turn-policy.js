import { AGENT_ROUTES, normalizeAgentRoute } from "./composer-agent.js";

export function resolveComposerTurnPolicy(input = {}) {
  const routeMode = normalizeAgentRoute(input.routeMode);
  if (["create_image", "create_video"].includes(input.outputMode)) {
    const requiresPromptAssembly = input.generationCapability?.requiresPromptAssembly === true;
    const preflightIssues = uniqueStrings([
      ...(input.generationCapability?.available === false ? [input.generationCapability?.issue] : []),
      ...(Array.isArray(input.referenceCapabilities?.issues) ? input.referenceCapabilities.issues : [])
    ]);
    return {
      route: "compose",
      routeSource: "manual",
      path: requiresPromptAssembly ? "assemble_then_generate" : "direct_generation",
      expectedModelCalls: preflightIssues.length ? 0 : requiresPromptAssembly ? 2 : 1,
      stages: preflightIssues.length ? [] : [
        ...(requiresPromptAssembly ? ["assembling_prompt"] : []),
        "submitting_generation",
        "generation",
        "persisting"
      ],
      preflightIssues
    };
  }
  if (AGENT_ROUTES.includes(routeMode)) {
    return {
      route: routeMode,
      routeSource: "manual",
      path: "direct_text",
      expectedModelCalls: 1,
      stages: ["requesting_model", "receiving_text"],
      preflightIssues: []
    };
  }
  return {
    route: "auto",
    routeSource: "auto",
    path: "direct_auto",
    expectedModelCalls: 1,
    stages: ["requesting_model", "receiving_text"],
    preflightIssues: []
  };
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}
