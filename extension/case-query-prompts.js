import { entryMediaAssets } from './media.js';
import { caseOriginalPromptText, detailPromptSources } from './prompt-sources.js';
import { caseFilesUnavailable } from './case-file-status.js';

// Candidate previews use the same 240-character budget as existing search
// excerpts. Ranking always uses the complete text; original reads stay intact.
export function caseQueryPrompt(entry, mediaKind) {
  const texts = new Set(), sources = new Set();
  const add = (text, source) => {
    if (!text?.trim()) return;
    texts.add(text.trim()); sources.add(source);
  };
  for (const member of caseFilesUnavailable(entry) ? [] : entry.memberEntries?.length ? entry.memberEntries : [entry]) {
    if (!mediaKind) add(caseOriginalPromptText(member), 'original');
    for (const asset of entryMediaAssets(member)) {
      if (asset.usage === 'poster' || !['image', 'video'].includes(asset.kind) || mediaKind && asset.kind !== mediaKind) continue;
      const prompt = detailPromptSources(member, asset);
      add(prompt.original || prompt.ai, prompt.original ? 'original' : 'ai');
    }
  }
  const text = [...texts].join('\n\n');
  return { text, evidence: { sources: [...sources], excerpt: text.slice(0, 240), excerptOnly: true, characters: text.length } };
}
