import { normalizeGenerationInfo, embeddedMediaPrompts } from './image-generation-info.js';
import { detailPromptSources } from './prompt-sources.js';
import { sha256Blob } from './blob-digest.js';

// This boundary runs only for newly added media. Read/normalize/restore paths
// never call it, so editing or clearing a saved prompt cannot trigger a refill.
export async function planImageGenerationPrompts(entry, newAssets, choices = {}, sharedPrompt = "") {
  const ids = new Set(newAssets.map(asset => asset.id));
  const prompts = (entry.mediaPrompts ?? []).filter(prompt => !(ids.has(prompt.assetId) && prompt.source === 'embedded'));
  const result = { ...entry, mediaPrompts: [...prompts] }, conflicts = [];
  for (const asset of newAssets) {
    const info = normalizeGenerationInfo(asset.generationInfo);
    if (asset.kind !== 'image' || asset.usage === 'poster' || info?.status !== 'extracted' || info.candidates.length !== 1) continue;
    const proposed = info.candidates[0].prompt;
    if (!proposed) continue;
    const current = detailPromptSources({ ...entry, mediaPrompts: prompts }, asset);
    current.original ||= sharedPrompt;
    if (!current.original) { result.mediaPrompts.push(...embeddedMediaPrompts([asset], result.mediaPrompts)); continue; }
    if (current.original === proposed) continue;
    const token = await sha256Blob(new Blob([JSON.stringify([entry.url, entry.title, asset.sourceUrl, asset.sourceTitle, current.original, proposed])]));
    const choice = choices[token];
    if (choice === 'skip') continue;
    if (choice === 'overwrite') {
      result.mediaPrompts = result.mediaPrompts.filter(prompt => prompt.assetId !== asset.id || prompt.source === 'ai-suggestion');
      result.mediaPrompts.push(...embeddedMediaPrompts([asset], result.mediaPrompts));
      continue;
    }
    conflicts.push({ assetId: asset.id, name: asset.sourceTitle || entry.title || '', token,
      originalText: current.original, embeddedText: proposed });
  }
  return { entry: result, conflicts };
}

export function generationPromptConfirmation(conflicts) {
  return { ok: false, code: 'generation_prompt_confirmation_required',
    message: '原始提示词与图片内嵌内容不同，请确认覆盖或跳过。', promptConflicts: conflicts };
}
