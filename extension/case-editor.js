import { updateArticleText } from './article-edit.js';
import { updateEntryText } from './analysis-revision.js';
import { editedLabels } from './label-edits.js';
import { assertCaseFilesReadable } from './case-file-status.js';
import { editCurrentVideoReconstruction, setEntryMediaPrompt } from './media.js';
import { editVisionReconstructionPrompt } from './analysis-candidates.js';
import { normalizeEntryVisuals, primaryVisual, updateEntryVisual } from './visuals.js';

// Business edits run against the latest single case inside the storage write lock.
// The committer also advances the library revision and sync state in that transaction.
export function createCaseEditor({ commitCase }) {
  async function edit(message, transform) {
    let response;
    const committed = await commitCase(message.entryId, current => {
      assertCaseFilesReadable(current);
      response = transform(current);
      return response.ok ? response.entry : current;
    });
    return response.ok ? { ...response, entry: committed.entry, changed: committed.changed } : response;
  }
  return {
    article: message => edit(message, current => {
      const next = updateArticleText(current, message.patches, message.textRevision);
      const entry = userVisibleEntryEqual(current, next) ? next : touchEntry(next);
      return { ok: true, message: '正文已保存', entry };
    }),
    text: message => edit(message, current => {
      const next = updateEntryText(current, message.text, message.textRevision);
      const changed = next.text !== current.text;
      return { ok: true, message: changed ? '提示词已保存，需要时可重新分析标签' : '提示词没有变化',
        entry: changed ? touchEntry(next) : next };
    }),
    title: message => edit(message, current => {
      const title = String(message.title ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (!title) return { ok: false, message: '案例标题不能为空' };
      const changed = title !== current.title;
      return { ok: true, message: changed ? '标题已保存' : '标题没有变化',
        entry: changed ? touchEntry({ ...current, title }) : current };
    }),
    customLabels: message => edit(message, current => {
      const customLabels = editedLabels(current.customLabels, message);
      const entry = stringListsEqual(customLabels, current.customLabels) ? current : touchEntry({ ...current, customLabels });
      return { ok: true, message: '标签已保存', entry };
    }),
    videoReconstruction: message => edit(message, current => ({
      ok: true, message: 'AI 视觉逆推提示词已保存',
      entry: editCurrentVideoReconstruction(current, message.assetId, message.reconstructionPrompt)
    })),
    visionReconstruction: message => edit(message, current => {
      const visualId = String(message.visualId ?? '').trim() || primaryVisual(current)?.id;
      const visual = normalizeEntryVisuals(current).visuals.find(item => item.id === visualId);
      if (!visual?.visionAnalysis) throw new Error('这张截图还没有可编辑的反推提示词');
      const temporary = editVisionReconstructionPrompt({ visionAnalysis: visual.visionAnalysis }, message.reconstructionPrompt);
      const entry = updateEntryVisual(current, visual.id, item => ({ ...item, visionAnalysis: temporary.visionAnalysis }));
      return { ok: true, message: '反推提示词已保存', entry };
    }),
    mediaPrompt: message => edit(message, current => {
      const preserveAiSource = message.preserveAiSource === true
        && current.mediaPrompts?.some(item => item.assetId === message.assetId && item.source === 'ai-suggestion');
      const next = setEntryMediaPrompt(current, message.assetId, message.text, preserveAiSource ? 'ai-suggestion' : 'manual', { preserveOtherSource: true });
      const entry = userVisibleEntryEqual(current, next) ? next : touchEntry(next);
      return { ok: true, message: String(message.text ?? '').trim() ? '独立提示词已保存' : '已恢复使用案例共享提示词', entry };
    }),
    mediaPromptSuggestions: message => edit(message, current => {
      const suggestions = Array.isArray(message.suggestions) ? message.suggestions : [];
      let entry = current;
      let appliedCount = 0;
      for (const item of suggestions) {
        const text = String(item?.text ?? '').trim();
        if (!text) continue;
        entry = setEntryMediaPrompt(entry, item.assetId, text, 'ai-suggestion', { preserveOtherSource: true });
        appliedCount += 1;
      }
      if (!appliedCount) return { ok: false, message: '没有需要保存的逐图提示词' };
      return { ok: true, message: `已确认并保存 ${appliedCount} 条逐图提示词`, entry: touchEntry(entry) };
    })
  };
}

export function touchEntry(entry, updatedAt = new Date().toISOString()) {
  return { ...entry, libraryUpdatedAt: updatedAt };
}

export function stringListsEqual(leftValue, rightValue) {
  const left = Array.isArray(leftValue) ? leftValue : [];
  const right = Array.isArray(rightValue) ? rightValue : [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function userVisibleEntryEqual(left = {}, right = {}) {
  return JSON.stringify({
    title: left.title,
    text: left.text,
    customLabels: left.customLabels ?? [],
    classification: left.classification ?? null,
    facetAssignments: left.facetAssignments ?? [],
    mediaPrompts: left.mediaPrompts ?? []
  }) === JSON.stringify({
    title: right.title,
    text: right.text,
    customLabels: right.customLabels ?? [],
    classification: right.classification ?? null,
    facetAssignments: right.facetAssignments ?? [],
    mediaPrompts: right.mediaPrompts ?? []
  });
}
