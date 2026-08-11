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

export async function planComposerSession({ session: sessionValue, composerSettings, settings, signal, retrieveSources }) {
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
  let retrievedCount = 0;
  if (planned.librarySearch && typeof retrieveSources === "function") {
    const retrievedSources = await retrieveSources(session, planned.librarySearch);
    retrievedCount = retrievedSources.length;
    session = createComposerSession({ ...session, retrievedSources });
    session = appendDiagnosticEvent(session, {
      phase: "retrieval",
      status: retrievedCount ? "completed" : "empty",
      detail: retrievedCount
        ? `本地检索采用 ${retrievedCount} 条来源`
        : `本地检索没有找到匹配来源：${planned.librarySearch.query}`
    });
  }
  session = appendDiagnosticEvent(session, {
    phase: "planning",
    status: "completed",
    detail: `${planned.route} 轻量规划已完成`
  });
  return { session, planned, needsClarification: false, retrievedCount };
}

export function applyComposerServiceResult(sessionValue, result, composerSettings, route, instruction) {
  const instructionSnapshot = createInstructionSnapshot(
    composerSettings,
    route,
    sessionValue.targetType,
    result.outputLanguage,
    sessionValue.currentRouteSource,
    instruction
  );
  if (route !== "compose") {
    return appendComposerMessage(clearComposerFailure(sessionValue), {
      role: "assistant",
      type: result.kind === "analysis" ? "analysis" : "chat",
      content: result.text,
      route,
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
    route,
    routeSource: session.currentRouteSource,
    instructionSnapshot
  });
}
