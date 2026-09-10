import { AGENT_ROUTES } from "./composer-agent.js";

export function parseComposerAutoResponse(contentValue, options = {}) {
  const content = String(contentValue ?? "");
  const newlineIndex = content.indexOf("\n");
  if (newlineIndex < 0 && options.final !== true) {
    if (content.trimStart() && !content.trimStart().startsWith("{")) {
      return {
        ready: true,
        route: "chat",
        status: "ready",
        visibleText: content,
        degraded: true,
        degradationReason: "missing_control_frame"
      };
    }
    return { ready: false, route: "", status: "", visibleText: "", degraded: false, degradationReason: "" };
  }
  const headerText = newlineIndex < 0 ? content : content.slice(0, newlineIndex);
  const body = newlineIndex < 0 ? "" : content.slice(newlineIndex + 1);
  let header;
  try {
    header = JSON.parse(headerText);
  } catch {
    header = null;
  }
  const validControlFrame = AGENT_ROUTES.includes(header?.route)
    && ["ready", "needs_clarification"].includes(header?.status);
  if (!validControlFrame) {
    return {
      ready: true,
      route: "chat",
      status: "ready",
      visibleText: content,
      degraded: true,
      degradationReason: "invalid_control_frame"
    };
  }
  const route = header.route;
  const status = header?.status === "needs_clarification" ? "needs_clarification" : "ready";
  return {
    ready: true,
    route,
    status,
    visibleText: body,
    degraded: false,
    degradationReason: ""
  };
}

export function createComposerAutoResponseProjector(onDelta = () => undefined) {
  let visibleText = "";
  return {
    push(contentValue, options = {}) {
      const parsed = parseComposerAutoResponse(contentValue, options);
      if (!parsed.ready) return parsed;
      const nextVisibleText = parsed.visibleText;
      const delta = nextVisibleText.startsWith(visibleText)
        ? nextVisibleText.slice(visibleText.length)
        : nextVisibleText;
      visibleText = nextVisibleText;
      if (delta) onDelta(delta, visibleText);
      return parsed;
    }
  };
}

export function composerAutoResponseProtocolFacts(value = {}) {
  return value.degraded === true ? {
    protocolDegraded: true,
    protocolDegradationReason: String(value.degradationReason ?? "invalid_control_frame")
  } : {
    protocolDegraded: false,
    protocolDegradationReason: ""
  };
}
