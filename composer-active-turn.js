const ACTIVE_TURN_STATUSES = Object.freeze([
  "submitted",
  "waiting",
  "receiving",
  "stop_requested",
  "interrupted",
  "failed",
  "stopped"
]);
const ACTIVE_TURN_PHASES = Object.freeze([
  "submitted",
  "waiting",
  "streaming",
  "stopping",
  "interrupted",
  "failed",
  "stopped"
]);
const ACTIVE_TURN_ROUTES = Object.freeze(["auto", "compose", "analyze_materials", "chat"]);
const UNFINISHED_ACTIVE_TURN_STATUSES = new Set(["submitted", "waiting", "receiving", "stop_requested"]);

export function createComposerActiveTurn(value = {}) {
  value = value && typeof value === "object" ? value : {};
  const turnId = String(value.turnId ?? "").trim();
  const userMessageId = String(value.userMessageId ?? "").trim();
  if (!turnId || !userMessageId) return null;
  const startedAt = validIso(value.startedAt) || new Date().toISOString();
  return {
    turnId,
    userMessageId,
    status: ACTIVE_TURN_STATUSES.includes(value.status) ? value.status : "submitted",
    phase: ACTIVE_TURN_PHASES.includes(value.phase) ? value.phase : "submitted",
    route: ACTIVE_TURN_ROUTES.includes(value.route) ? value.route : "auto",
    routeSource: value.routeSource === "manual" ? "manual" : "auto",
    serviceId: String(value.serviceId ?? "").trim(),
    model: String(value.model ?? "").trim(),
    partialText: String(value.partialText ?? ""),
    providerMayHaveAccepted: value.providerMayHaveAccepted === true,
    startedAt,
    updatedAt: validIso(value.updatedAt) || startedAt,
    stopRequestedAt: validIso(value.stopRequestedAt)
  };
}

export function updateComposerActiveTurn(value, patch = {}) {
  const current = createComposerActiveTurn(value);
  if (!current) return null;
  return createComposerActiveTurn({ ...current, ...patch });
}

export function recoverInterruptedComposerTurn(sessionValue, nowValue = new Date().toISOString()) {
  const activeTurn = createComposerActiveTurn(sessionValue?.activeTurn);
  if (!activeTurn || !UNFINISHED_ACTIVE_TURN_STATUSES.has(activeTurn.status)) return sessionValue;
  const recoveredTurn = updateComposerActiveTurn(activeTurn, {
    status: "interrupted",
    phase: "interrupted",
    updatedAt: validIso(nowValue) || new Date().toISOString()
  });
  return {
    ...sessionValue,
    activeTurn: recoveredTurn,
    lastFailure: {
      userMessageId: recoveredTurn.userMessageId,
      phase: "streaming",
      kind: "interrupted",
      message: recoveredTurn.partialText
        ? "连接已中断，已保留收到的内容；本轮不会自动重试"
        : "连接已中断，服务端执行状态未知；本轮不会自动重试",
      retryable: true
    }
  };
}

export function createLatestCheckpointWriter(write) {
  let pending;
  let running = null;

  const flush = async () => {
    while (pending !== undefined) {
      const value = pending;
      pending = undefined;
      await write(value);
    }
  };

  return {
    schedule(value) {
      pending = value;
      if (!running) {
        running = flush().finally(() => { running = null; });
      }
      return running;
    },
    async drain() {
      while (running) await running;
    }
  };
}

function validIso(value) {
  const text = String(value ?? "").trim();
  return text && !Number.isNaN(Date.parse(text)) ? text : "";
}
