// One capability vocabulary for query discovery and the shared write service.
// Identity, transport metadata and calculated evidence are never writable patches.
export function caseFieldAccess(name) {
  const base = { query: true, read: true, edit: null, save: null };
  const save = input => ({ operation: 'save_material', input });
  if (name === 'title') return { ...base, save: save('title'), edit: { operation: 'edit_case', patch: 'title' } };
  if (name === 'body') return { ...base, save: save('text'), edit: { operation: 'edit_case', patch: 'text/articlePatches', protection: 'source_or_creation' } };
  if (name.startsWith('source.')) return { ...base, save: save(name === 'source.url' ? 'sourceUrl' : 'sourceFacts'), edit: { operation: 'edit_case', patch: name === 'source.url' ? 'sourceUrl' : 'sourceFacts', protection: 'source_correction' } };
  if (name === 'prompt.original') return { ...base, edit: { operation: 'edit_case', patch: 'mediaPrompts', protection: 'source_or_creation' } };
  if (name === 'prompt.ai') return { ...base, edit: { operation: 'edit_case', patch: 'mediaPrompts', source: 'ai-suggestion' } };
  if (name === 'manualLabels') return { ...base, save: save('customLabels'), edit: { operation: 'edit_case', patch: 'customLabels' }, organize: 'remove_tags' };
  if (name.startsWith('creative.')) return { ...base, save: save(name), edit: { operation: 'edit_case', patch: name } };
  if (name === 'classification.pathIds') return { ...base, save: save('classificationPathIds'), edit: { operation: 'edit_case', patch: 'classificationPathIds' } };
  if (name.startsWith('classification.')) return { ...base, derived: true };
  if (name.startsWith('project.')) return { ...base, organize: ['move_project', 'copy_project'], edit: null };
  if (name.startsWith('label.')) return { ...base, organize: 'remove_tags', edit: null };
  if (name === 'media.id') return { ...base, organize: ['split_media', 'move_media'], order: { operation: 'edit_case', patch: 'mediaOrder' } };
  if (name === 'media.isCover') return { ...base, edit: { operation: 'edit_case', patch: 'coverVisualId', selectExistingAsset: true } };
  if (name === 'primaryMediaId' || name === 'coverVisualId') return { ...base, edit: { operation: 'edit_case', patch: name } };
  if (['media.originalWorkUrl', 'media.sourceTitle', 'media.sourceAuthor'].includes(name)) return { ...base, edit: { operation: 'edit_case', patch: 'mediaSources', protection: 'source_correction' } };
  return { ...base, derived: name.startsWith('similarity.') || /Count$/.test(name), reason: '由真实资料、文件或关系维护；不支持任意手写。' };
}

export function protectedCasePatchFields(entry, patch) {
  const fields = [];
  for (const name of ['sourceUrl', 'sourceFacts', 'mediaSources']) if (Object.hasOwn(patch, name)) fields.push(name);
  // Existing/manual originals are conservatively protected. An explicitly
  // saved creation has its own editable authored text and prompts.
  if (entry.agentProvenance?.kind !== 'creation' && entry.sourceKind !== 'quick_note') {
    for (const name of ['text', 'articlePatches']) if (Object.hasOwn(patch, name)) fields.push(name);
    if (patch.mediaPrompts?.some(item => item.source !== 'ai-suggestion')) fields.push('mediaPrompts');
  } else if (patch.mediaPrompts?.some(item => item.source === 'webpage')) fields.push('mediaPrompts');
  return fields;
}

export function assertSourceCorrection(entry, patch, correction) {
  const fields = protectedCasePatchFields(entry, patch);
  if (!fields.length) return;
  if (!correction?.reason?.trim() || fields.some(name => !correction.fields?.includes(name))) {
    throw Object.assign(new Error(`原始资料默认保护：${fields.join('、')}。仅在用户明确要求修正来源/原文时提供sourceCorrection.reason及对应fields；创作提炼写入creative，AI词使用ai-suggestion。`), { code: 'source_protected' });
  }
}
