import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { classifyContent } from "../classifier.js";
import { CONTENT_IDS } from "../taxonomy.js";
import { usesArticleReader } from "../case-presentation.js";
import { normalizePageCaptureCandidate, resolvePageCapturePageType, applyPageCaptureSelections, collectPageCaptureSnapshot } from "../page-capture.js";
import { normalizePageCaptureSitePayload } from "../page-capture-site-adapters.js";
import { capturedMediaPrompts, planPageCaptureRepair, mergePageCaptureRepair } from "../page-capture-repair.js";
import { normalizeEntryMedia, setEntryMediaPrompt } from "../media.js";
import { detailPromptSources } from "../prompt-sources.js";

test("structured work descriptions are not original generation prompts", () => {
  for (const [kind, pageType, expected] of [["image", "artwork", CONTENT_IDS.imageCase], ["video", "video", CONTENT_IDS.videoCase]]) {
    const entry = { text: "My latest campaign for a local brand.", sourceFacts: { pageType, extractionMethod: "structured" },
      mediaAssets: [{ id: kind, kind }] };
    assert.deepEqual(classifyContent(entry).pathIds, [expected]);
    entry.text = "Prompt collection: Create a portrait";
    entry.sourceFacts.originalPromptAvailable = false;
    assert.deepEqual(classifyContent(entry).pathIds, [expected]);
    assert.equal(detailPromptSources(entry, entry.mediaAssets[0]).original, "");
  }
});

test("an article with a video and example prompt opens as an intact article", () => {
  assert.equal(resolvePageCapturePageType({ structuredTypes: ["Article", "VideoObject"] }), "article");
  const entry = { title: "A production diary", text: "Prompt: Create a cinematic scene --ar 16:9",
    sourceFacts: { pageType: "article", extractionMethod: "structured" },
    mediaAssets: [{ id: "v", kind: "video" }],
    articleDocument: { version: 1, blocks: [{ kind: "paragraph", text: "Introduction" }, { kind: "video", assetId: "v" }, { kind: "code", text: "Create a scene" }] } };
  const before = structuredClone(entry);
  const classified = { ...entry, classification: classifyContent(entry) };
  assert.equal(usesArticleReader(classified), true);
  assert.deepEqual(classified.classification.pathIds, [CONTENT_IDS.reference]);
  assert.deepEqual(entry, before);
});

test("a social video caption or image model name alone cannot invent a generation prompt", () => {
  for (const [kind, text, expected] of [["video", "My video made in Runway", CONTENT_IDS.videoCase], ["image", "Midjourney photography from this week", CONTENT_IDS.imageCase]]) {
    const entry = { text, sourceFacts: { pageType: "post", extractionMethod: "page" }, mediaAssets: [{ id: "m", kind }] };
    assert.deepEqual(classifyContent(entry).pathIds, [expected]);
  }
  assert.deepEqual(classifyContent({ text: "Prompt: a red landscape", mediaAssets: [{ id: "m", kind: "image" }] }).pathIds, [CONTENT_IDS.promptImage]);
});

test("injected page extraction keeps article precedence and source prompt evidence", async () => {
  const keys = ["window", "document", "location", "chrome", "Readability"];
  const original = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  const url = "https://example.com/creative-work";
  const body = { innerText: "A complete production diary", scrollHeight: 800, querySelector: () => null, querySelectorAll: () => [] };
  const structured = [{ "@type": "Article", articleBody: body.innerText, url }, { "@type": "VideoObject", url }];
  Object.assign(globalThis, { window: { scrollX: 0, scrollY: 0, scrollTo: () => {} },
    document: { title: "Production diary", body, documentElement: { scrollHeight: 800 }, baseURI: url,
      querySelector: () => null, querySelectorAll: selector => selector === 'script[type="application/ld+json"]' ? [{ textContent: JSON.stringify(structured) }] : [],
      cloneNode: () => ({}) }, location: { hostname: "example.com", href: url }, chrome: undefined, Readability: undefined });
  try {
    const injected = (0, eval)(`(${collectPageCaptureSnapshot.toString()})`);
    const article = await injected({ adapters: [], maxCandidates: 10, maxMedia: 10 });
    assert.equal(article.candidates[0].pageType, "article");
    const work = await injected({ adapters: [], maxCandidates: 10, maxMedia: 10, siteData: {
      pageKind: "detail", pageType: "artwork", canonicalUrl: url, title: "Selected work", contentText: "原始提示词",
      sourceFacts: { originalPromptAvailable: true, description: "作品说明", extractionMethod: "structured" },
      media: [{ id: "one", kind: "image", url: "https://example.com/one.png", originalPrompt: "原始提示词" }] } });
    assert.equal(work.candidates[0].sourceFacts.originalPromptAvailable, true);
    assert.equal(work.candidates[0].sourceFacts.description, "作品说明");
    assert.equal(work.candidates[0].media[0].originalPrompt, "原始提示词");
  } finally {
    Object.assign(globalThis, original);
  }
});

function liblibWork() {
  return normalizePageCaptureCandidate(normalizePageCaptureSitePayload({ adapter: "liblibai",
    canonicalUrl: "https://www.liblib.art/imageinfo/work-fixture",
    data: { uuid: "work-fixture", title: "Two different prompts", user: { nickname: "Fixture" },
      images: ["A red landscape", "A blue portrait"].map((prompt, index) => ({ id: index + 1,
        originalImageUrl: `https://liblib.cloud/${index + 1}.png`, generateInfo: { prompt } })) }
  }));
}

test("different source prompts survive normalization, asset remapping and manual edits", () => {
  const candidate = liblibWork();
  assert.deepEqual(candidate.media.map(item => item.originalPrompt), ["A red landscape", "A blue portrait"]);
  assert.equal(candidate.contentText, "A red landscape\n\nA blue portrait");
  const ids = new Map(candidate.media.map((item, i) => [item.id, `saved-${i}`]));
  const entry = normalizeEntryMedia({ text: candidate.contentText, sourceFacts: candidate.sourceFacts,
    mediaAssets: [...ids.values()].map(id => ({ id, kind: "image" })), mediaPrompts: capturedMediaPrompts(candidate, ids) });
  assert.deepEqual(entry.mediaPrompts.map(item => item.source), ["webpage", "webpage"]);
  assert.equal(detailPromptSources(entry, entry.mediaAssets[1]).original, "A blue portrait");
  const edited = setEntryMediaPrompt(entry, "saved-1", "My edit", "manual", { preserveOtherSource: true });
  assert.equal(detailPromptSources(edited, edited.mediaAssets[1]).original, "My edit");
  assert.equal(detailPromptSources(edited, { id: "unrelated", kind: "image" }).original, "");
  assert.deepEqual(capturedMediaPrompts(candidate, ids, edited.mediaPrompts), edited.mediaPrompts);
});

test("deselecting text does not secretly save original prompts through the selected images", () => {
  const candidate = liblibWork();
  const [selected] = applyPageCaptureSelections({ candidates: [candidate], selections: [{ candidateId: candidate.id,
    includeText: false, mediaDecision: "confirmed", selectedMediaIds: candidate.media.map(item => item.id) }] });
  assert.equal(selected.contentText, "");
  assert.ok(selected.media.every(item => !item.originalPrompt));
  assert.equal(selected.sourceFacts.originalPromptAvailable, false);
});

test("keeping only a description cannot inherit the deselected source prompt classification", () => {
  const work = liblibWork();
  const candidate = normalizePageCaptureCandidate({ ...work,
    contentText: `${work.contentText}\n\nA study from my portfolio.`,
    textBlocks: [{ id: "prompts", text: work.contentText }, { id: "description", text: "A study from my portfolio." }]
  });
  const select = id => applyPageCaptureSelections({ candidates: [candidate], selections: [{ candidateId: candidate.id,
    includeText: true, selectedTextBlockIds: [id], mediaDecision: "confirmed", selectedMediaIds: candidate.media.map(item => item.id) }] })[0];
  const description = select("description");
  assert.equal(description.sourceFacts.originalPromptAvailable, false);
  assert.ok(description.media.every(item => !item.originalPrompt));
  assert.deepEqual(classifyContent({ text: description.contentText, sourceFacts: description.sourceFacts,
    mediaAssets: description.media }).pathIds, [CONTENT_IDS.imageCase]);
  assert.equal(select("prompts").sourceFacts.originalPromptAvailable, true);
});

test("recapture fills missing per-image prompts without downloading saved media or overwriting edits", async () => {
  const candidate = liblibWork();
  const entry = { text: "Edited case body", title: "My title", customLabels: ["Keep"],
    mediaAssets: candidate.media.map((item, index) => ({ id: `saved-${index}`, kind: item.kind, sourceUrl: item.url, storageMode: "managed" })),
    mediaPrompts: [{ assetId: "saved-0", source: "manual", text: "My prompt" }] };
  const plan = await planPageCaptureRepair(entry, candidate, async () => true);
  assert.equal(plan.pending.length, 0);
  assert.equal(plan.promptsChanged, true);
  const repaired = mergePageCaptureRepair(entry, candidate, plan, [], plan.assetIds);
  assert.deepEqual(repaired.mediaPrompts.map(item => item.text), ["My prompt", "A blue portrait"]);
  assert.equal(repaired.text, entry.text);
  assert.equal(repaired.title, entry.title);
  assert.deepEqual(repaired.customLabels, entry.customLabels);
  assert.equal((await planPageCaptureRepair(repaired, candidate, async () => true)).promptsChanged, false);
});

test("capture save and additions cannot enqueue paid analysis as an automatic side effect", async () => {
  const source = await readFile(new URL("../background.js", import.meta.url), "utf8");
  for (const name of ["commitPageCapture", "commitCaptureDraft", "commitCaptureIntoCompound", "addUploadedVisual", "addUploadedMedia"]) {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0);
    const end = source.indexOf("\nasync function ", start + 1);
    assert.doesNotMatch(source.slice(start, end), /queueAutomaticVisionAnalysis|startOrJoinAnalysisTask|analyzeTextDetailedWithDeepSeek/);
  }
  assert.match(source, /async function startOrJoinAnalysisTaskAction/);
});


test("a short original prompt used as the work title still survives preview and selection", () => {
  const prompt = "A cinematic silhouette.";
  const candidate = normalizePageCaptureCandidate({ id: "prompt-title", title: prompt, canonicalUrl: "https://example.com/work",
    pageType: "artwork", contentText: prompt, sourceFacts: { originalPromptAvailable: true },
    textBlocks: [{ id: "prompt", kind: "paragraph", text: prompt, relevance: "explicit-creative" }],
    media: [{ id: "image", kind: "image", url: "https://example.com/image.png", originalPrompt: prompt }] });
  const [selected] = applyPageCaptureSelections({ candidates: [candidate], selections: [{ candidateId: candidate.id,
    includeText: true, selectedMediaIds: ["image"], mediaDecision: "confirmed" }] });
  assert.equal(selected.contentText, prompt);
  assert.equal(selected.media[0].originalPrompt, prompt);
});
