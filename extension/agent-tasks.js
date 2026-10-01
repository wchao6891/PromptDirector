import { AGENT_JOB_PREFIX, AGENT_CHUNK_BYTES, agentError, requireAgentId, requireInteger } from "./agent-protocol.js";

// Chrome storage may reorder object keys. Compare JSON meaning while retaining
// array order, so a persisted request can be retried without changing its work.
export function canonicalInput(value) {
  if (Array.isArray(value)) return value.map(canonicalInput);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalInput(value[key])]));
  }
  return value;
}

// Receipts survive client disconnects. Mutations share the existing library
// queue; a request id names exactly one immutable operation and its arguments.
export function createAgentTasks({ storage, execute, getLibraryId, allowLegacyTasks = false, now = () => new Date().toISOString() }) {
  if (typeof getLibraryId !== "function") throw new Error("Agent 任务缺少资料库身份。");
  const running = new Set();
  let queue = Promise.resolve();
  const serialize = fn => {
    const operation = queue.then(fn, fn);
    queue = operation.catch(() => {});
    return operation;
  };
  const key = id => AGENT_JOB_PREFIX + requireAgentId(id);
  const get = async id => (await storage.get(key(id)))[key(id)] ?? null;
  const put = task => storage.set({ [key(task.id)]: task });
  const currentLibraryId = async () => {
    const id = await getLibraryId();
    if (typeof id !== "string" || !id.trim()) throw agentError("library_identity_invalid", "资料库身份不可用，任务尚未开始。");
    return id;
  };
  const assertLibrary = async id => {
    if (await currentLibraryId() !== id) throw agentError("library_changed", "资料库已改变，本任务不能写入其他资料库。");
  };
  async function ownTask(task) {
    const libraryId = await currentLibraryId();
    if (!Object.hasOwn(task, "libraryId") && (typeof allowLegacyTasks === 'function' ? await allowLegacyTasks() : allowLegacyTasks === true)) return { ...task, libraryId };
    if (task.libraryId !== libraryId) throw agentError("library_mismatch", "任务属于另一份资料库，请连接原资料库。");
    return task;
  }

  async function run(task) {
    running.add(task.id);
    try {
      await assertLibrary(task.libraryId);
      await put({ ...task, state: "running", updatedAt: now() });
      const scope = Object.freeze({ libraryId: task.libraryId, assertCurrent: () => assertLibrary(task.libraryId) });
      const result = await execute(task.operation, task.input, task.id, scope);
      await scope.assertCurrent();
      await put({ ...task, state: result?.ok === false ? "failed" : "completed", result, updatedAt: now() });
    } catch (error) {
      // Leave the original receipt intact when its library is no longer
      // active. Reopening it reports interruption; never replay paid work.
      await assertLibrary(task.libraryId);
      await put({ ...task, state: "failed", error: { code: error.code || "operation_failed", message: error.message }, updatedAt: now() });
    } finally { running.delete(task.id); }
  }

  return {
    async submit(operation, input, id) {
      return serialize(async () => {
        const prior = await get(id);
        if (prior) {
          await ownTask(prior);
          if (prior.operation !== operation || JSON.stringify(canonicalInput(prior.input)) !== JSON.stringify(canonicalInput(input))) {
            throw agentError("request_conflict", "这个请求编号已用于其他内容；请使用新的编号。");
          }
          return this.inspect(id);
        }
        const libraryId = await currentLibraryId();
        const task = { id, operation, input, libraryId, state: "queued", createdAt: now(), updatedAt: now() };
        await put(task);
        // Start before returning so a live worker never mistakes its queued job
        // for an interrupted one. run catches execution failures into receipts.
        void run(task).catch(error => console.error("PromptDirector agent receipt write failed", error.code || error.name));
        return { id, operation, state: "queued", createdAt: task.createdAt };
      });
    },
    async inspect(id, options = {}) {
      const stored = await get(id);
      if (!stored) throw agentError("task_not_found", "没有找到这个任务，请核对请求编号与所连接的案例库。");
      const task = await ownTask(stored);
      if (["queued", "running"].includes(task.state) && !running.has(id)) {
        task.state = "interrupted";
        task.error = { code: "worker_restarted", message: "插件执行被中断。请先核对已保存结果；使用新请求编号重试时会检查已有内容。" };
        await put(task);
      }
      const { input: _input, ...receipt } = task;
      const conflicts = receipt.result?.promptConflicts;
      if (options.conflictToken) {
        const conflict = conflicts?.find(item => item.token === options.conflictToken);
        if (!conflict || !["originalText", "embeddedText"].includes(options.conflictPart)) throw agentError("invalid_input", "请指定有效的提示词冲突和内容部分。");
        const offset = options.offset ?? 0, length = options.length ?? 12000;
        requireInteger(offset); requireInteger(length, { min: 1, max: AGENT_CHUNK_BYTES / 4 });
        const text = conflict[options.conflictPart];
        return { id, token: conflict.token, part: options.conflictPart, content: text.slice(offset, offset + length),
          offset, totalCharacters: text.length, nextOffset: offset + length < text.length ? offset + length : null, untrustedContent: true };
      }
      if (conflicts) receipt.result = { ...receipt.result, promptConflicts: conflicts.map(({originalText, embeddedText, ...item}) => ({
        ...item, originalCharacters: originalText.length, embeddedCharacters: embeddedText.length,
        readWith: "get_task: conflictToken, conflictPart, offset, length"
      })) };
      return receipt;
    }
  };
}
