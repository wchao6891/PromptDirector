export function createComposerAnalysisTaskBridge(options = {}) {
  if (typeof options.sendMessage !== "function") throw new Error("分析任务桥接缺少消息发送器");
  const createId = typeof options.createId === "function"
    ? options.createId
    : () => globalThis.crypto.randomUUID();
  let revision = 0;
  let state = emptyState();

  return {
    async start(request = {}) {
      const currentRevision = ++revision;
      state = {
        ...emptyState(),
        attached: true,
        consumerId: createId(),
        clientRequestId: createId(),
        status: "starting"
      };
      const response = await options.sendMessage({
        type: "START_OR_JOIN_ANALYSIS_TASK",
        priority: "interactive",
        consumerId: state.consumerId,
        clientRequestId: state.clientRequestId,
        sessionId: String(request.sessionId ?? "").trim(),
        tempReferenceIds: uniqueIds(request.tempReferenceIds),
        outputLocale: request.outputLocale === "en" ? "en" : "zh-CN"
      });
      requireSuccessfulCommand(response);
      if (currentRevision === revision && state.attached) applyResponse(response);
      return snapshot();
    },

    async detach() {
      if (!state.attached) return snapshot();
      revision += 1;
      const message = {
        type: "DETACH_ANALYSIS_CONSUMER",
        taskId: state.taskId,
        consumerId: state.consumerId,
        clientRequestId: state.clientRequestId
      };
      state.attached = false;
      state.autoContinue = false;
      requireSuccessfulCommand(await options.sendMessage(message));
      return snapshot();
    },

    async stop() {
      if (!state.attached && !state.taskId) return snapshot();
      revision += 1;
      const message = {
        type: "STOP_ANALYSIS_TASK",
        taskId: state.taskId,
        consumerId: state.consumerId,
        clientRequestId: state.clientRequestId
      };
      state.attached = false;
      state.autoContinue = false;
      try {
        const response = await options.sendMessage(message);
        requireSuccessfulCommand(response);
        applyResponse(response);
        return snapshot();
      } catch (error) {
        state.status = "stopped";
        state.executionState = "execution_state_unknown";
        throw error;
      }
    },

    async refresh() {
      if (!state.attached || !state.taskId) return snapshot();
      const currentRevision = revision;
      const response = await options.sendMessage({
        type: "GET_ANALYSIS_TASK",
        taskId: state.taskId,
        consumerId: state.consumerId,
        clientRequestId: state.clientRequestId
      });
      requireSuccessfulCommand(response);
      if (currentRevision === revision && state.attached) applyResponse(response);
      return snapshot();
    },

    async retry(retryOptions = {}) {
      if (retryOptions.confirmed !== true) throw new Error("请确认重新分析可能再次计费");
      if (!canRetry()) throw new Error("当前分析任务不能重新发起");
      const previousAttemptId = state.attemptId;
      const currentRevision = ++revision;
      state.attached = true;
      state.autoContinue = true;
      state.consumerId = createId();
      state.clientRequestId = createId();
      state.status = "starting";
      state.executionState = "";
      state.result = null;
      const response = await options.sendMessage({
        type: "RETRY_ANALYSIS_TASK",
        taskId: state.taskId,
        previousAttemptId,
        consumerId: state.consumerId,
        clientRequestId: state.clientRequestId,
        confirmDuplicateCharge: true
      });
      requireSuccessfulCommand(response);
      if (currentRevision === revision && state.attached) applyResponse(response, { allowAttemptChange: true });
      return snapshot();
    },

    acceptUpdate(response) {
      if (!state.attached) return false;
      return applyResponse(response);
    },

    consumeCompletion() {
      if (!state.attached || !state.autoContinue || state.status !== "completed" || !state.result) return null;
      const result = structuredClone(state.result);
      state.attached = false;
      state.autoContinue = false;
      state.result = null;
      return result;
    },

    snapshot
  };

  function applyResponse(response = {}, applyOptions = {}) {
    const task = response?.task ?? {};
    const taskId = String(task.id ?? response.taskId ?? state.taskId ?? "").trim();
    const attemptId = String(response.attemptId ?? task.activeAttemptId ?? state.attemptId ?? "").trim();
    if (state.taskId && taskId && state.taskId !== taskId) return false;
    if (!applyOptions.allowAttemptChange && state.attemptId && attemptId && state.attemptId !== attemptId) return false;
    state.taskId = taskId;
    state.attemptId = attemptId;
    state.status = String(task.status ?? response.status ?? state.status ?? "").trim();
    state.executionState = String(task.executionState ?? response.executionState ?? "").trim();
    state.result = Object.hasOwn(response, "result") ? structuredClone(response.result) : null;
    state.autoContinue = state.attached;
    return true;
  }

  function snapshot() {
    return structuredClone({ ...state, result: undefined, canRetry: canRetry() });
  }

  function canRetry() {
    return state.executionState === "execution_state_unknown" || ["failed", "stopped"].includes(state.status);
  }
}

function emptyState() {
  return {
    attached: false,
    autoContinue: false,
    consumerId: "",
    clientRequestId: "",
    taskId: "",
    attemptId: "",
    status: "idle",
    executionState: "",
    result: null
  };
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function requireSuccessfulCommand(response) {
  if (response?.ok === true) return;
  throw new Error(String(response?.message ?? "图片分析任务请求失败"));
}
