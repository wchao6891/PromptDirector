export function parseStructuredObject(value, message = "模型返回的结构化 JSON 无效") {
  const parsed = parseStructuredValue(value, 0);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(message);
  return parsed;
}

function parseStructuredValue(value, depth) {
  if (depth > 2) throw new Error("模型返回的结构化 JSON 重复编码过多");
  if (value && typeof value === "object") return value;
  const source = String(value ?? "").replace(/^\uFEFF/, "").trim();
  if (!source) throw new Error("模型没有返回结构化 JSON");
  for (const candidate of jsonCandidates(source)) {
    try {
      const parsed = JSON.parse(removeTrailingCommas(candidate));
      return typeof parsed === "string" ? parseStructuredValue(parsed, depth + 1) : parsed;
    } catch {}
  }
  throw new Error("模型返回的结构化 JSON 无效");
}

function jsonCandidates(source) {
  const candidates = [];
  const unfenced = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  candidates.push(unfenced);
  const object = firstBalancedObject(unfenced);
  if (object && object !== unfenced) candidates.push(object);
  if (!object) candidates.push(...recoverableTruncatedObjectPrefixes(unfenced));
  return [...new Set(candidates)];
}

function recoverableTruncatedObjectPrefixes(source) {
  const start = source.indexOf("{");
  if (start < 0) return [];
  const object = source.slice(start);
  const safeEnds = [];
  const stack = [];
  let quote = false;
  let escaped = false;
  for (let index = 0; index < object.length; index += 1) {
    const character = object[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') {
      quote = true;
      continue;
    }
    if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") stack.pop();
    else if (character === "," && stack.length === 1 && stack[0] === "{") safeEnds.push(index);
  }
  const candidates = [`${object}}`];
  for (const end of safeEnds.reverse()) candidates.push(`${object.slice(0, end)}}`);
  return candidates;
}

function firstBalancedObject(source) {
  let start = -1;
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') {
      quote = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === "}" && depth) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function removeTrailingCommas(source) {
  let result = "";
  let quote = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      result += character;
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quote = false;
      continue;
    }
    if (character === '"') {
      quote = true;
      result += character;
      continue;
    }
    if (character === ",") {
      let next = index + 1;
      while (/\s/.test(source[next] ?? "")) next += 1;
      if (["}", "]"].includes(source[next])) continue;
    }
    result += character;
  }
  return result;
}
