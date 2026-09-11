import { AGENT_JOB_PREFIX, agentError, requireAgentId } from "./agent-protocol.js";

// Chrome storage may reorder object keys. Compare JSON meaning while retaining
// array order, so a persisted request can be retried without changing its work.
function canonicalInput(value) {
  if (Array.isArray(value)) return value.map(canonicalInput);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalInput(value[key])]));
  }
  return value;
}

// Receipts survive client disconnects. Mutations share the existing library
// queue; a request id names exactly one immutable operation and its arguments.
export function createAgentTasks({ storage, execute, now = () => new Date().toISOString() }) {
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

  async function run(task) {
    running.add(task.id);
    try {
      await put({ ...task, state: "running", updatedAt: now() });
      const result = await execute(task.operation, task.input, task.id);
      await put({ ...task, state: result?.ok === false ? "failed" : "completed", result, updatedAt: now() });
    } catch (error) {
      await put({ ...task, state: "failed", error: { code: error.code || "operation_failed", message: error.message }, updatedAt: now() });
    } finally { running.delete(task.id); }
  }

  return {
    async submit(operation, input, id) {
      return serialize(async () => {
        const prior = await get(id);
        if (prior) {
          if (prior.operation !== operation || JSON.stringify(canonicalInput(prior.input)) !== JSON.stringify(canonicalInput(input))) {
            throw agentError("request_conflict", "这个请求编号已用于其他内容；请使用新的编号。");
          }
          return this.inspect(id);
        }
        const task = { id, operation, input, state: "queued", createdAt: now(), updatedAt: now() };
        await put(task);
        // Start before returning so a live worker never mistakes its queued job
        // for an interrupted one. run catches execution failures into receipts.
        void run(task).catch(error => console.error("PromptDirector agent receipt write failed", error.code || error.name));
        return { id, operation, state: "queued", createdAt: task.createdAt };
      });
    },
    async inspect(id) {
      const task = await get(id);
      if (!task) throw agentError("task_not_found", "没有找到这个任务，请核对请求编号与所连接的案例库。");
      if (["queued", "running"].includes(task.state) && !running.has(id)) {
        task.state = "interrupted";
        task.error = { code: "worker_restarted", message: "插件执行被中断。请先核对已保存结果；使用新请求编号重试时会检查已有内容。" };
        await put(task);
      }
      const { input: _input, ...receipt } = task;
      return receipt;
    }
  };
}
