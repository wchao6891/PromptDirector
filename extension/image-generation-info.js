import { readGenerationTextRecords, GENERATION_TEXT_BUDGET } from './image-generation-container.js';

const record = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.trim() : '';
const scalar = value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

export function normalizeGenerationInfo(value) {
  if (!record(value) || value.version !== 1 || !['extracted', 'ambiguous', 'partial'].includes(value.status)) return null;
  const candidates = (Array.isArray(value.candidates) ? value.candidates : []).filter(record).flatMap(item => {
    if (!['a1111', 'comfyui'].includes(item.format)) return [];
    const parameters = (Array.isArray(item.parameters) ? item.parameters : []).filter(p => record(p) && text(p.name) && scalar(p.value))
      .map(p => ({ name: text(p.name), value: String(p.value) }));
    const result = { format: item.format, location: text(item.location), prompt: text(item.prompt), negativePrompt: text(item.negativePrompt), parameters };
    return result.prompt || result.negativePrompt || parameters.length ? [result] : [];
  });
  const warnings = (Array.isArray(value.warnings) ? value.warnings : []).filter(v => typeof v === 'string').map(text).filter(Boolean);
  const result = { version: 1, status: value.status, candidates, warnings };
  if (new TextEncoder().encode(JSON.stringify(result)).length > GENERATION_TEXT_BUDGET) return null;
  return candidates.length || warnings.length ? result : null;
}

export async function readImageGenerationInfo(blob, options = {}) {
  const { records, warnings } = await readGenerationTextRecords(blob, options);
  const candidates = [];
  let ambiguous = false;
  for (const item of records) {
    options.signal?.throwIfAborted();
    const keyword = item.keyword.toLowerCase();
    try {
      if (['parameters', 'usercomment', 'imagedescription'].includes(keyword)) {
        const parsed = parseA1111(item.text);
        if (parsed) candidates.push({ ...parsed, location: item.location });
      }
      // ComfyUI stores these keys in PNG and in WebP EXIF Make/Model.
      const payload = item.text.replace(/^(?:prompt|workflow):\s*/u, '');
      if (keyword === 'prompt' || (['make', 'model', 'imagedescription'].includes(keyword) && item.text.startsWith('prompt:'))) {
        const parsed = parseComfyGraph(parseGenerationJson(payload), options);
        ambiguous ||= parsed.ambiguous;
        warnings.push(...parsed.warnings);
        candidates.push(...parsed.candidates.map(c => ({ ...c, location: `${item.location}:${c.location}` })));
      }
      if (keyword === 'workflow' || (['make', 'model', 'imagedescription'].includes(keyword) && item.text.startsWith('workflow:'))) {
        // Workflow UI widgets do not define executable input semantics. Preserve
        // the original instead of guessing widget positions for custom nodes.
        const workflow = JSON.parse(payload);
        if (!record(workflow) || !Array.isArray(workflow.nodes)) throw new Error('工作流结构无法识别');
        if (!records.some(r => r.keyword.toLowerCase() === 'prompt' || (['make', 'model', 'imagedescription'].includes(r.keyword.toLowerCase()) && r.text.startsWith('prompt:')))) {
          warnings.push('文件仅包含工作流布局，未自动推定提示词；完整工作流保留在原图');
        }
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      warnings.push(`生成信息未完整解析（${item.keyword}）；原图保留`);
    }
  }
  const unique = [...new Map(candidates.map(c => [JSON.stringify([c.prompt, c.negativePrompt, c.parameters]), c])).values()];
  ambiguous ||= unique.length > 1;
  return normalizeGenerationInfo({ version: 1,
    status: ambiguous ? 'ambiguous' : warnings.length ? 'partial' : 'extracted',
    candidates: unique, warnings: [...new Set(warnings)] }) || (unique.length
      ? { version: 1, status: 'partial', candidates: [], warnings: ['结构化生成信息超过文本解析预算；完整信息仍保留在原图'] }
      : null);
}

export function parseA1111(value) {
  const source = text(value);
  // Require the producer's parameter footer: ordinary photo EXIF comments are
  // not generation prompts. Preserve unfamiliar footer keys without guessing.
  const match = /(?:^|\n)(Steps:\s*\d+,[\s\S]*)$/u.exec(source);
  if (!match || !/(?:^|,\s*)(?:Sampler|Seed|CFG scale):/u.test(match[1])) return null;
  const body = source.slice(0, match.index).trim();
  const negative = /(?:^|\n)Negative prompt:\s*/u.exec(body);
  const parameters = [];
  const footer = match[1];
  const keys = [...footer.matchAll(/(?:^|,\s*)([\w][\w .\-/]*):\s*/gu)].filter(match => !insideQuotedValue(footer, match.index));
  for (let i = 0; i < keys.length; i++) {
    const start = keys[i].index + keys[i][0].length;
    parameters.push({ name: keys[i][1], value: footer.slice(start, keys[i + 1]?.index ?? footer.length).trim() });
  }
  return { format: 'a1111', prompt: negative ? body.slice(0, negative.index).trim() : body,
    negativePrompt: negative ? body.slice(negative.index + negative[0].length).trim() : '', parameters };
}

export function parseComfyGraph(graph, { signal } = {}) {
  if (!record(graph)) throw new Error('生成图结构无效');
  const entries = Object.entries(graph).filter(([, n]) => record(n) && record(n.inputs));
  const nodes = new Map(entries), warnings = [], candidates = [];
  const link = value => Array.isArray(value) && value.length === 2 && Number.isInteger(value[1]) && nodes.has(String(value[0])) ? String(value[0]) : null;
  function upstream(root) {
    const pending = [root], visited = new Set();
    while (pending.length) {
      signal?.throwIfAborted();
      const id = pending.pop();
      if (visited.has(id)) continue;
      visited.add(id);
      const node = nodes.get(id);
      for (const value of Object.values(node?.inputs ?? {})) { const parent = link(value); if (parent) pending.push(parent); }
    }
    return visited;
  }
  const outputs = entries.filter(([, n]) => ['SaveImage', 'PreviewImage', 'SaveAnimatedWEBP'].includes(n.class_type));
  if (!outputs.length) warnings.push('缺少可识别的图像输出节点，未自动对应提示词');
  const reachable = outputs.length ? new Set(outputs.flatMap(([id]) => [...upstream(id)])) : new Set(nodes.keys());
  const samplers = entries.filter(([id, n]) => reachable.has(id) && ['KSampler', 'KSamplerAdvanced'].includes(n.class_type));
  function conditioning(value) {
    const id = link(value), node = nodes.get(id);
    if (!node) return null;
    if (node.class_type === 'CLIPTextEncode' && typeof node.inputs.text === 'string') return node.inputs.text.trim();
    return null;
  }
  for (const [id, node] of samplers) {
    const prompt = conditioning(node.inputs.positive), negativePrompt = conditioning(node.inputs.negative);
    if (prompt === null || negativePrompt === null) {
      warnings.push('生成分支包含未识别的条件节点，未猜测或拼接提示词；完整信息保留在原图');
    }
    const parameters = [];
    for (const name of ['seed', 'noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise', 'start_at_step', 'end_at_step']) {
      if (scalar(node.inputs[name])) parameters.push({ name, value: String(node.inputs[name]) });
    }
    const modelNodes = [...upstream(id)].map(key => nodes.get(key));
    const models = modelNodes.filter(n => ['CheckpointLoaderSimple', 'CheckpointLoader'].includes(n?.class_type));
    if (models.length === 1 && typeof models[0].inputs.ckpt_name === 'string') parameters.push({ name: 'Model', value: models[0].inputs.ckpt_name });
    const latent = nodes.get(link(node.inputs.latent_image));
    if (latent?.class_type === 'EmptyLatentImage') {
      for (const name of ['width', 'height']) if (scalar(latent.inputs[name])) parameters.push({ name, value: String(latent.inputs[name]) });
    }
    candidates.push({ format: 'comfyui', location: `node:${id}`, prompt: prompt ?? '', negativePrompt: negativePrompt ?? '', parameters });
  }
  if (!samplers.length) warnings.push('未识别可唯一对应的生成节点；完整信息保留在原图');
  return { candidates, warnings, ambiguous: samplers.length > 1 || outputs.length > 1 };
}

// Only called while adding new media, never during normalization, recovery, or
// opening an entry. Thus explicit edits/deletions are not automatically undone.
export function embeddedMediaPrompts(assets, existing = []) {
  return (assets ?? []).flatMap(asset => {
    const info = normalizeGenerationInfo(asset.generationInfo);
    if (asset.kind !== 'image' || asset.usage === 'poster' || info?.status !== 'extracted' || info.candidates.length !== 1) return [];
    if (existing.some(p => p.assetId === asset.id && p.source !== 'ai-suggestion')) return [];
    const prompt = info.candidates[0].prompt;
    return prompt ? [{ assetId: asset.id, text: prompt, source: 'embedded', textRevision: 1, updatedAt: asset.capturedAt }] : [];
  });
}

function insideQuotedValue(text, end) {
  let quoted = false, escaped = false;
  for (let i = 0; i < end; i++) {
    if (escaped) { escaped = false; continue; }
    if (text[i] === "\\") { escaped = true; continue; }
    if (text[i] === '"') quoted = !quoted;
  }
  return quoted;
}

// Seeds are identifiers, not floating-point quantities. Quote only unquoted
// integer tokens that JavaScript would round, leaving string content intact.
function parseGenerationJson(source) {
  return JSON.parse(source.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu, token =>
    /^-?\d+$/u.test(token) && !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token));
}
