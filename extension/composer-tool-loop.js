// Provider-native tool messages stay inside a turn. UI records contain no image bytes or provider secrets.
import { readEventStream } from "./event-stream.js";
import { operationBudget, resourceBudgetError } from "./resource-policy.js";

export async function runComposerToolLoop({ body, protocol, request, runtime, signal: callerSignal, onDelta = () => {}, maxCharacters, allowImageOutput = false, budget: budgetValue, continuation }) {
  const budget = operationBudget({ maxTotalTokens: runtime.contextLength ? runtime.contextLength * 2 : undefined,
    ...(budgetValue ?? runtime.budget) });
  const resumed = continuation ?? await runtime.loadContinuation?.({ model: body.model, protocol });
  if (resumed && (resumed.protocol !== protocol || resumed.body?.model !== body.model)) throw new Error("本轮模型或协议已变化，不能重放旧工具进度");
  const source = resumed?.body ?? body;
  if (workingBytes(source) > budget.workingBytes) throw resourceBudgetError("本次请求超过当前运行内存预算；完整资料保留，请分批处理", { workingBytes: budget.workingBytes });
  const current = structuredClone(source);
  const specs = runtime.specs;
  if (!resumed) {
    if (protocol === "responses") {
      current.tools = [...(current.tools ?? []), ...specs.map(spec => ({ type: "function", ...spec }))];
      current.include = [...new Set([...(current.include ?? []), "reasoning.encrypted_content"])];
    }
    else current.tools = specs.map(spec => ({ type: "function", function: spec }));
    if (runtime.instructions) {
      if (protocol === "responses") current.instructions = [current.instructions, runtime.instructions].filter(Boolean).join("\n\n");
      else {
        const system = current.messages.find(message => message.role === "system");
        if (system) system.content = [system.content, runtime.instructions].filter(Boolean).join("\n\n");
        else current.messages.unshift({role:"system",content:runtime.instructions});
      }
    }
    current.tool_choice = "auto";
  }
  const seen = new Map(resumed?.seen ?? []);
  const callIds = new Set(resumed?.callIds ?? []);
  const retainedSkillVersionIds = new Set(resumed?.retainedSkillVersionIds || []);
  const usage = resumed?.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
  let usageKnown = resumed?.usageKnown ?? true;
  let requestCount = resumed?.requestCount ?? 0;
  const segmentStart = requestCount;
  const segmentTokens = usage.totalTokens;
  let toolCalls = 0;
  let pendingCalls = resumed?.pendingCalls ?? [];
  let uncertainCallId = resumed?.uncertainCallId ?? '';
  if (uncertainCallId) throw new Error("上一次工具执行状态未确认，请先核对已保存成果，不能自动重放");
  const deadlineController = new AbortController();
  const signal = callerSignal ? AbortSignal.any([callerSignal, deadlineController.signal]) : deadlineController.signal;
  const deadline = setTimeout(() => deadlineController.abort(resourceBudgetError("本轮已达到工作时间预算；已保留任务进度，可继续本轮")), budget.maxDurationMs);
  const stop = message => { throw resourceBudgetError(message, { requestCount, toolCalls, resumable: true }); };
  try {
    for (;;) {
      signal.throwIfAborted();
      if (!pendingCalls.length) {
        if (requestCount - segmentStart >= budget.maxRequests) stop("本轮已达到模型请求预算；已保留任务进度，可继续本轮");
        if (budget.maxTotalTokens && usageKnown && usage.totalTokens - segmentTokens >= budget.maxTotalTokens) stop("本轮已达到累计模型工作预算；已保留任务进度，可继续本轮");
        if (workingBytes(current) > budget.workingBytes) stop("本轮工具内容已达到运行内存预算；完整内容及任务进度保留");
        // Explicit destination context limits are independent of the finite
        // execution budget. Never silently remove input or tool output.
        if (maxCharacters && requestCharacters(current) > maxCharacters) stop("本轮工具读取已达到请求容量，请缩小范围后继续");
        for (const value of seen.values()) delete value.result;
        requestCount += 1;
        const previouslyKnown = usageKnown;
        usageKnown = false;
        const response = await request(current, { signal });
        const step = await readToolResponse(checkedResponse(response, budget.maxTextBytes, signal), protocol, onDelta, signal);
        usageKnown = previouslyKnown && step.usage != null;
        addUsage(usage, step.usage, protocol);
        await runtime.onRequest?.({ requestCount, usage: usageKnown ? usage : null });
        signal.throwIfAborted();
        if (!step.calls.length) {
          if (!step.content.trim() && !(allowImageOutput && step.items.some(item => item.type === "image_generation_call" && item.result))) throw new Error("模型没有返回文字或有效的工具调用");
          await runtime.retainSkillVersions?.([...retainedSkillVersionIds]);
          await runtime.clearContinuation?.();
          return { content: step.content, model: step.model, finishReason: step.finishReason, usage, usageKnown, requestCount, outputItems: step.items };
        }
        if (protocol === "responses") current.input.push(...step.items);
        else current.messages.push(step.message);
        pendingCalls = step.calls;
      }
      while (pendingCalls.length) {
        signal.throwIfAborted();
        if (toolCalls >= budget.maxToolCalls) stop("本轮已达到工具工作预算；已保留任务进度，可继续本轮");
        const call = pendingCalls[0];
        if (!call.id || !specs.some(spec => spec.name === call.name)) throw new Error("模型调用了当前不可用的工具");
        if (callIds.has(call.id)) throw new Error("模型重复使用了工具调用编号，已停止本轮");
        let args;
        try { args = JSON.parse(call.arguments); } catch { throw new Error("工具参数不完整，本次没有读取资料"); }
        if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数必须是对象");
        const key = JSON.stringify([call.name, stableObject(args)]);
        const cached = seen.get(key);
        if (cached && cached.requestCount !== requestCount) throw new Error("模型重复请求相同资料且没有进展，已停止继续调用");
        uncertainCallId = call.id;
        const result = cached ? { data: cached.result.data } : await runtime.execute(call.name, args, { callId: call.id, signal });
        const objects = [result.data];
        const newlyRetained = [];
        while (objects.length) {
          const value = objects.pop();
          if (!value || typeof value !== 'object') continue;
          if ((typeof value.skillId === 'string' || (typeof value.id === 'string' && value.portableId)) && typeof value.versionId === 'string' && !retainedSkillVersionIds.has(value.versionId)) {
            retainedSkillVersionIds.add(value.versionId); newlyRetained.push(value.versionId);
          }
          for (const item of Object.values(value)) if (item && typeof item === 'object') objects.push(item);
        }
        if (newlyRetained.length) await runtime.retainSkillVersions?.(newlyRetained);
        const output = JSON.stringify(result.data);
        if (protocol === "responses") {
          current.input.push({ type: "function_call_output", call_id: call.id, output });
          if (result.images?.length) current.input.push({ role: "user", content: result.images.flatMap(image => [
            { type: "input_text", text: image.label }, { type: "input_image", image_url: image.dataUrl, detail: "high" }
          ]) });
        } else {
          current.messages.push({ role: "tool", tool_call_id: call.id, content: output });
          if (result.images?.length) current.messages.push({ role: "user", content: result.images.flatMap(image => [
            { type: "text", text: image.label }, runtime.chatImagePart?.(image) ?? { type: "image_url", image_url: { url: image.dataUrl, detail: "high" } }
          ]) });
        }
        seen.set(key, { result, requestCount });
        callIds.add(call.id);
        pendingCalls.shift(); toolCalls++;
        uncertainCallId = '';
        if (workingBytes({ body: current, cache: [...seen.values()], pendingCalls }) > budget.workingBytes) {
          stop('工具结果达到本次工作内存预算；已保留成果和未执行动作，请调整本次处理规模或使用分批读取');
        }
      }
    }
  } catch (error) {
    if (deadlineController.signal.aborted && !callerSignal?.aborted) error = deadlineController.signal.reason;
    if (error?.code === 'RESOURCE_BUDGET_REACHED' || callIds.size || uncertainCallId) {
      const checkpoint = { protocol, body: current, pendingCalls, uncertainCallId, retainedSkillVersionIds: [...retainedSkillVersionIds],
        seen: [...seen].map(([key, value]) => [key, { requestCount: value.requestCount, ...(pendingCalls.length && value.result ? { result: value.result } : {}) }]),
        callIds: [...callIds], usage, usageKnown, requestCount };
      await runtime.saveContinuation?.(checkpoint);
      error.checkpoint = checkpoint;
    }
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

function workingBytes(value) {
  const queue = [value];
  let bytes = 0;
  while (queue.length) {
    const item = queue.pop();
    if (typeof item === 'string') bytes += item.length * 2;
    else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) { bytes += key.length * 2 + 16; queue.push(child); }
    }
  }
  return bytes;
}

function checkedResponse(response, maxBytes, signal) {
  if (!response.body) return response;
  let bytes = 0;
  const stream = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) throw resourceBudgetError("模型返回超过本次解析预算；任务保留，未执行不完整工具调用");
    controller.enqueue(chunk);
  } }), { signal });
  return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  return value;
}

function requestCharacters(body) {
  return JSON.stringify(body, (key, value) => ["image_url", "video_url", "file_data"].includes(key) ? "[media]" : value).length;
}

function addUsage(target, usage, protocol) {
  if (!usage) return;
  target.promptTokens += Number(protocol === "responses" ? usage.input_tokens : usage.prompt_tokens) || 0;
  target.completionTokens += Number(protocol === "responses" ? usage.output_tokens : usage.completion_tokens) || 0;
  target.totalTokens += Number(usage.total_tokens) || 0;
  target.cacheHitTokens += Number(protocol === "responses" ? usage.input_tokens_details?.cached_tokens : usage.prompt_cache_hit_tokens) || 0;
  target.cacheMissTokens += Number(usage.prompt_cache_miss_tokens) || 0;
}

export async function readToolResponse(response, protocol, onDelta = () => {}, signal) {
  if (!response.ok) throw new Error(`模型服务请求失败（${response.status}），未自动重试`);
  if (!String(response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    return normalizeResponse(await response.json(), protocol, onDelta);
  }
  let text = "";
  let terminal = false;
  let payload = protocol === "responses" ? { output: [] } : { choices: [{ message: { role: "assistant", content: "", tool_calls: [] } }] };
  const items = new Map();
  for await (const data of readEventStream(response, { signal })) {
    if (!data.trim() || data === "[DONE]") continue;
    const event = JSON.parse(data);
    if (event.error || ["error", "response.failed", "response.incomplete"].includes(event.type)) throw new Error("工具调用连接失败或输出不完整，已停止本轮");
    if (protocol === "responses") {
      if (event.type === "response.output_text.delta") { text += event.delta; onDelta(event.delta, text); }
      if (event.type === "response.output_item.added") items.set(event.output_index, structuredClone(event.item));
      if (event.type === "response.function_call_arguments.delta") {
        const item = items.get(event.output_index);
        if (item) item.arguments = (item.arguments || "") + event.delta;
      }
      if (event.type === "response.output_item.done") items.set(event.output_index, event.item);
      if (event.type === "response.completed") {
        payload = { ...event.response, output: event.response.output?.length ? event.response.output : [...items.values()] };
        if (!payload.output_text && text) payload.output_text = text;
        terminal = true;
      }
    } else {
      const choice = event.choices?.[0];
      const message = payload.choices[0].message;
      const delta = choice?.delta;
      if (delta?.content) { message.content += delta.content; text = message.content; onDelta(delta.content, text); }
      if (delta?.reasoning_content) message.reasoning_content = (message.reasoning_content || "") + delta.reasoning_content;
      for (const call of delta?.tool_calls ?? []) {
        const index = call.index;
        if (!Number.isInteger(index) || index < 0) throw new Error("工具调用编号无效");
        const existing = message.tool_calls[index] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.function.name += call.function.name;
        if (call.function?.arguments) existing.function.arguments += call.function.arguments;
      }
      if (choice?.finish_reason) { payload.choices[0].finish_reason = choice.finish_reason; terminal = true; }
      if (event.usage) payload.usage = event.usage;
      if (event.model) payload.model = event.model;
    }
  }
  if (!terminal) throw new Error("工具调用连接中断，未执行不完整调用");
  return normalizeResponse(payload, protocol);
}

function normalizeResponse(payload, protocol, onDelta) {
  const message = payload.choices?.[0]?.message;
  const finishReason = protocol === "responses" ? payload.status : payload.choices?.[0]?.finish_reason;
  if (payload.error || ["length", "content_filter", "incomplete", "failed"].includes(finishReason)) throw new Error("模型输出不完整，未执行工具调用");
  const items = payload.output ?? [];
  const calls = protocol === "responses"
    ? items.filter(item => item.type === "function_call").map(item => ({ id: item.call_id, name: item.name, arguments: item.arguments }))
    : (message?.tool_calls ?? []).filter(Boolean).map(item => ({ id: item.id, name: item.function?.name, arguments: item.function?.arguments }));
  const content = protocol === "responses"
    ? payload.output_text || items.flatMap(item => item.content ?? []).filter(item => item.type === "output_text").map(item => item.text).join("")
    : message?.content || "";
  onDelta?.(content, content);
  return { calls, content, items, message, finishReason, model: payload.model, usage: payload.usage };
}
