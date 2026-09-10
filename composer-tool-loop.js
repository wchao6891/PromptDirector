// Provider-native tool messages stay inside a turn. UI records contain no image bytes or provider secrets.
export async function runComposerToolLoop({ body, protocol, request, runtime, signal, onDelta = () => {}, maxCharacters, allowImageOutput = false }) {
  const current = structuredClone(body);
  const specs = runtime.specs;
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
  const seen = new Map();
  const callIds = new Set();
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
  let usageKnown = true;
  let requestCount = 0;
  for (;;) {
    signal?.throwIfAborted();
    if (requestCharacters(current) > maxCharacters) throw new Error("本轮工具读取已达到请求容量，请缩小范围后继续");
    const response = await request(current);
    requestCount += 1;
    const step = await readToolResponse(response, protocol, onDelta, signal);
    usageKnown &&= step.usage != null;
    addUsage(usage, step.usage, protocol);
    await runtime.onRequest?.({ requestCount, usage: usageKnown ? usage : null });
    signal?.throwIfAborted();
    if (!step.calls.length) {
      if (!step.content.trim() && !(allowImageOutput && step.items.some(item => item.type === "image_generation_call" && item.result))) throw new Error("模型没有返回文字或有效的工具调用");
      return { content: step.content, model: step.model, finishReason: step.finishReason, usage, usageKnown, requestCount, outputItems: step.items };
    }
    if (protocol === "responses") current.input.push(...step.items);
    else current.messages.push(step.message);
    for (const call of step.calls) {
      signal?.throwIfAborted();
      if (!call.id || !specs.some(spec => spec.name === call.name)) throw new Error("模型调用了当前不可用的工具");
      if (callIds.has(call.id)) throw new Error("模型重复使用了工具调用编号，已停止本轮");
      callIds.add(call.id);
      let args;
      try { args = JSON.parse(call.arguments); } catch { throw new Error("工具参数不完整，本次没有读取资料"); }
      if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("工具参数必须是对象");
      const key = JSON.stringify([call.name, stableObject(args)]);
      const cached = seen.get(key);
      if (cached && cached.requestCount !== requestCount) throw new Error("模型重复请求相同资料且没有进展，已停止继续调用");
      const result = cached ? { data: cached.result.data } : await runtime.execute(call.name, args, { callId: call.id, signal });
      seen.set(key, { result, requestCount });
      signal?.throwIfAborted();
      const output = JSON.stringify(result.data);
      if (protocol === "responses") {
        current.input.push({ type: "function_call_output", call_id: call.id, output });
        if (result.images?.length) current.input.push({ role: "user", content: result.images.flatMap(image => [
          { type: "input_text", text: image.label },
          { type: "input_image", image_url: image.dataUrl, detail: "high" }
        ]) });
      } else {
        current.messages.push({ role: "tool", tool_call_id: call.id, content: output });
        if (result.images?.length) current.messages.push({ role: "user", content: result.images.flatMap(image => [
          { type: "text", text: image.label },
          runtime.chatImagePart?.(image) ?? { type: "image_url", image_url: { url: image.dataUrl, detail: "high" } }
        ]) });
      }
    }
  }
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableObject(value[key])]));
  return value;
}

function requestCharacters(body) {
  return JSON.stringify(body, (key, value) => ["image_url", "file_data"].includes(key) ? "[image]" : value).length;
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
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let terminal = false;
  let payload = protocol === "responses" ? { output: [] } : { choices: [{ message: { role: "assistant", content: "", tool_calls: [] } }] };
  const items = new Map();
  const consume = block => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
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
  };
  const onAbort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const result = await reader.read();
      buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) consume(block);
      if (result.done) break;
    }
    if (buffer.trim()) consume(buffer);
    signal?.throwIfAborted();
    if (!terminal) throw new Error("工具调用连接中断，未执行不完整调用");
    return normalizeResponse(payload, protocol);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
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
