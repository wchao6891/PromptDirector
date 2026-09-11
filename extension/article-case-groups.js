import { normalizeArticleDocument, articleDocumentText } from './article-document.js';

// Split only when repeated source boundaries contain evidence of independent prompt/image cases.
// Keep uncertain fragments separate so adjacency never silently invents a prompt association.
export function splitArticleCases(candidate) {
  const document = normalizeArticleDocument(candidate?.articleDocument);
  if (!document) return [];
  const blocks = document.blocks;
  const owned = new Set(blocks.flatMap(block => (block.rows || []).flatMap(row => row.flatMap(cell => cell.blockIds))));
  const top = blocks.filter(block => !owned.has(block.id));
  const promptLabel = text => /(?:提示词|prompt|生成指令)/iu.test(text || '');
  const sectionLabel = text => /^(?:[\p{Emoji_Presentation}\s📝📖🖼📌]*)(?:描述|提示词|生成图片|参考图|详情|说明|description|prompt|generated images?|details)\s*[:：]?$/iu.test(text || '');
  const numbered = text => /^(?:(?:no\.?|case|案例|示例)\s*\d+\s*[:：.、-]?|第[\d一二三四五六七八九十百]+[个项章节]|\d+[、．.)]\s*\S)/iu.test(text || '');
  const bonus = text => /^(?:彩蛋|番外|bonus\b)/iu.test(text || '');
  const isTitle = block => !sectionLabel(block.text) && (block.kind === 'heading' || block.kind === 'paragraph' && !block.text.includes('\n') && numbered(block.text));
  const mediaIds = new Set((candidate.media || []).map(media => media.id));
  const hasMedia = parts => parts.some(block => block.assetId && mediaIds.has(block.assetId));
  const hasPrompt = parts => parts.some(block => ['heading','paragraph'].includes(block.kind) && promptLabel(block.text))
    || parts.some(block => ['code','quote'].includes(block.kind) && block.text);
  const expand = parts => {
    const ids = new Set(parts.flatMap(block => (block.rows || []).flatMap(row => row.flatMap(cell => cell.blockIds))));
    return blocks.filter(block => parts.includes(block) || ids.has(block.id));
  };
  let ranges = [];
  for (const level of [1,2,3,4,5,6,0]) {
    const starts = top.flatMap((block,index) => isTitle(block) && (level ? block.kind === 'heading' && block.level === level : block.kind === 'paragraph') ? [index] : []);
    if (starts.length < 2) continue;
    const proposal = starts.map((start,index) => ({ start, end: starts[index+1] ?? top.length }));
    if (proposal.filter(({start,end}) => {
      const parts = expand(top.slice(start,end));
      return hasMedia(parts) && hasPrompt(parts);
    }).length >= 2) { ranges = proposal; break; }
  }
  if (!ranges.length) return [];
  // Bonus sections can use a paragraph rather than the numbered heading level.
  ranges = ranges.flatMap(range => {
    const extra = top.findIndex((block,index) => index > range.start && index < range.end && ['heading','paragraph'].includes(block.kind) && bonus(block.text));
    if (extra < 0 || !hasPrompt(expand(top.slice(extra,range.end))) || !hasMedia(expand(top.slice(extra,range.end)))) return [range];
    return [{start:range.start,end:extra},{start:extra,end:range.end}];
  });
  const groups = [];
  const used = new Set();
  for (const {start,end} of ranges) {
    const parts = expand(top.slice(start,end));
    if (!hasPrompt(parts)) continue;
    parts.forEach(block => used.add(block.id));
    groups.push(makeGroup(top[start].text, parts, groups.length, !hasMedia(parts)));
  }
  if (groups.length < 2) return [];
  const remainder = blocks.filter(block => !used.has(block.id));
  if (remainder.length) groups.push(makeGroup('未分组内容 · ' + candidate.title, remainder, groups.length, true));
  return groups;

  function makeGroup(title, parts, index, review) {
    const articleDocument = normalizeArticleDocument({blocks:parts.map((block, sourceOrder) => ({...block,sourceOrder}))});
    const selectedIds = new Set(parts.flatMap(block => block.assetId ? [block.assetId] : []));
    const media = (candidate.media || []).filter(media => selectedIds.has(media.id));
    return {
      ...candidate,
      id: `${candidate.id}:section:${index}`,
      title,
      pageType: 'artwork',
      contentText: articleDocumentText(articleDocument),
      contentHtml: '',
      articleDocument,
      textBlocks: parts.filter(block => block.text && !owned.has(block.id)).map(block => ({id:block.id,text:block.text,kind:block.kind,sourceOrder:block.sourceOrder})),
      media,
      possibleOmissions: [], supplements: [],
      batchStructureStatus: review ? 'review' : 'matched',
      sourceFacts: {...candidate.sourceFacts, pageType:'artwork', itemId:`${candidate.sourceFacts?.itemId || candidate.id}:section:${index}`},
      region: candidate.region ? {...candidate.region, contentTargets:(candidate.region.contentTargets || []).filter(target =>
        target.articleBlockIds?.some(id=>parts.some(block=>block.id===id)) || target.mediaIds?.some(id=>selectedIds.has(id)))} : null
    };
  }
}
