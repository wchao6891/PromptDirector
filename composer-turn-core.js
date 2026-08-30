import {
  appendComposerMessage,
  appendDiagnosticEvent,
  appendPromptVersion,
  clearComposerFailure,
  createComposerSession,
  createInstructionSnapshot
} from "./composer.js";
import { composerOutputChecks } from "./composer-diagnostics.js";
import { planComposerTurnWithService } from "./composer-service.js";

export function prepareComposerTurnStart(sessionValue, policy = {}) {
  const session = createComposerSession(sessionValue);
  const instruction = [...session.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  if (policy.path === "direct_text") {
    return {
      session: createComposerSession({
        ...session,
        currentInstruction: instruction,
        currentRoute: policy.route,
        currentRouteSource: "manual"
      }),
      startPhase: "streaming",
      executionRoute: policy.route
    };
  }
  if (policy.path === "direct_auto") {
    return {
      session: createComposerSession({
        ...session,
        currentInstruction: instruction,
        currentRoute: "",
        currentRouteSource: "auto"
      }),
      startPhase: "streaming",
      executionRoute: "auto"
    };
  }
  if (["direct_generation", "assemble_then_generate"].includes(policy.path)) {
    return {
      session: createComposerSession({
        ...session,
        currentInstruction: instruction,
        currentRoute: "compose",
        currentRouteSource: "manual"
      }),
      startPhase: "generation",
      executionRoute: "compose"
    };
  }
  return { session, startPhase: "planning", executionRoute: "" };
}

export async function planComposerSession({ session: sessionValue, composerSettings, settings, signal }) {
  const planned = await planComposerTurnWithService({
    session: sessionValue,
    userMessage: "",
    composerSettings
  }, settings, { signal });
  let session = createComposerSession({
    ...sessionValue,
    currentInstruction: planned.instruction,
    currentRoute: planned.route,
    currentRouteSource: sessionValue.routeMode === "auto" ? "auto" : "manual"
  });
  if (planned.suggestedTitle && session.promptVersions.length === 0) session.title = planned.suggestedTitle;
  if (planned.status === "needs_clarification") {
    session = appendComposerMessage(session, {
      role: "assistant",
      type: "question",
      content: planned.question.text,
      route: planned.route,
      routeSource: session.currentRouteSource,
      recommendedAnswer: planned.question.recommendedAnswer,
      options: planned.question.options
    });
    session = appendDiagnosticEvent(session, {
      phase: "planning",
      status: "needs-clarification",
      detail: planned.question.text
    });
    return { session, planned, needsClarification: true, retrievedCount: 0 };
  }
  session = appendDiagnosticEvent(session, {
    phase: "planning",
    status: "completed",
    detail: `${planned.route} 轻量规划已完成`
  });
  return { session, planned, needsClarification: false, retrievedCount: session.retrievedSources.length };
}

export function applyComposerServiceResult(sessionValue, result, composerSettings, route, instruction) {
  const resolvedRoute = ["compose", "analyze_materials", "chat"].includes(result?.route)
    ? result.route
    : route;
  const instructionSnapshot = createInstructionSnapshot(
    composerSettings,
    resolvedRoute,
    sessionValue.targetType,
    result.outputLanguage,
    sessionValue.currentRouteSource,
    instruction
  );
  if (result.kind === "question") {
    return appendComposerMessage(clearComposerFailure(sessionValue), {
      role: "assistant",
      type: "question",
      content: result.text,
      route: resolvedRoute,
      routeSource: sessionValue.currentRouteSource,
      instructionSnapshot
    });
  }
  if (resolvedRoute !== "compose") {
    return appendComposerMessage(clearComposerFailure(sessionValue), {
      role: "assistant",
      type: resolvedRoute === "analyze_materials" ? "analysis" : "chat",
      content: result.text,
      route: resolvedRoute,
      routeSource: sessionValue.currentRouteSource,
      instructionSnapshot
    });
  }
  const draft = {
    text: result.finalPrompt,
    productionReviewEnabled: sessionValue.productionReviewEnabled,
    retrievedSources: sessionValue.retrievedSources,
    instructionSnapshot
  };
  let session = appendPromptVersion(clearComposerFailure(sessionValue), {
    ...draft,
    title: sessionValue.title,
    methodVersion: composerSettings.methodVersion,
    outputLanguage: result.outputLanguage,
    usage: result.usage,
    validation: composerOutputChecks(sessionValue, draft)
  });
  return appendComposerMessage(session, {
    role: "assistant",
    type: "prompt",
    content: result.finalPrompt,
    route: resolvedRoute,
    routeSource: session.currentRouteSource,
    instructionSnapshot
  });
}
