import test from "node:test";
import assert from "node:assert/strict";
import { collectPageCaptureSitePayload, normalizePageCaptureSitePayload } from "../extension/page-capture-site-adapters.js";

// Reduced regression fixtures mirror the public page schemas observed on 2026-09-05.
// Text/IDs are test data, not snapshots or live-site acceptance evidence.
const publicationUrl = "https://higgsfield.ai/publications/test-publication";
const projectUrl = "https://higgsfield.ai/@test-creator/projects/test-project";
const videoUrl = "https://d8j0ntlcm91z4.cloudfront.net/test/movie.mp4";
const imageUrls = ["https://d2ol7oe51mr4n9.cloudfront.net/test/first.png", "https://d2ol7oe51mr4n9.cloudfront.net/test/second.png"];
const work = {
  "@type": "CreativeWork", url: publicationUrl, name: "Test publication", description: "Test original prompt",
  author: { "@type": "ProfilePage", mainEntity: { "@type": "Person", name: "Test creator", identifier: "test-creator", privateToken: "must-not-survive" } },
  video: { "@type": "VideoObject", contentUrl: videoUrl, thumbnailUrl: imageUrls[0] }
};

function readPayload(url, nodes, brief = "") {
  const previous = { location: globalThis.location, document: globalThis.document };
  globalThis.location = new URL(url);
  globalThis.document = {
    querySelectorAll: (selector) => selector === 'script[type="application/ld+json"]' ? nodes.map(node => ({textContent: JSON.stringify(node)})) : [],
    querySelector: (selector) => selector === '[aria-label^="Project brief:"]' && brief ? {innerText: brief} : null
  };
  try { return (0, eval)(`(${collectPageCaptureSitePayload.toString()})`)({maxCandidates: 20, maxMedia: 24, maxTextCharacters: 10000}); }
  finally { Object.assign(globalThis, previous); }
}

test("publication detail retains nested video and creator instead of returning an image-only feed", () => {
  const payload = readPayload(publicationUrl, [work]);
  const result = normalizePageCaptureSitePayload(payload, publicationUrl);
  assert.equal(result.pageKind, "detail");
  assert.equal(result.contentText, work.description);
  assert.equal(result.media.find(item => item.kind === "video")?.url, videoUrl);
  assert.equal(result.sourceFacts.author, "Test creator");
  assert.equal(result.sourceFacts.handle, "test-creator");
  assert.equal(JSON.stringify(payload).includes("must-not-survive"), false);
});

test("image publications keep the complete declared image group", () => {
  const result = normalizePageCaptureSitePayload(readPayload(publicationUrl, [{...work, video: undefined, image: imageUrls}]), publicationUrl);
  assert.deepEqual(result.media.filter(item => item.kind === "image").map(item => item.url), imageUrls);
});

test("project briefs are articles and keep their own identity alongside standalone video metadata", () => {
  const brief = "Test production breakdown\n\nA chapter with code and embedded reference images.";
  const result = normalizePageCaptureSitePayload(readPayload(projectUrl, [
    {...work, video: undefined, url: projectUrl, image: imageUrls[0]},
    {"@type": "VideoObject", url: projectUrl, contentUrl: videoUrl, thumbnailUrl: imageUrls[0]}
  ], brief), projectUrl);
  assert.equal(result.pageType, "article");
  assert.equal(result.contentText, brief);
  assert.equal(result.media.find(item => item.kind === "video")?.url, videoUrl);
});

test("unrecognized Higgsfield content cannot suppress generic extraction with an empty feed", () => {
  const url = "https://higgsfield.ai/academy/test-tutorial";
  assert.equal(normalizePageCaptureSitePayload(readPayload(url, []), url), null);
});

test("detail pages never substitute a recommended project's structured data", () => {
  const result = normalizePageCaptureSitePayload(readPayload(projectUrl, [{...work, url: "https://higgsfield.ai/@someone/projects/recommended"}]), projectUrl);
  assert.equal(result, null);
});

test("recognized articles preserve every chapter and short conclusion through repeated normalization", async () => {
  const { normalizePageCaptureCandidate } = await import('../extension/page-capture.js');
  const chapters = Array.from({length: 12}, (_, index) => [
    {kind: 'heading', text: `Chapter ${index + 1}`, sourceOrder: index * 2},
    {kind: 'paragraph', text: `Short observation ${index + 1}.`, sourceOrder: index * 2 + 1}
  ]).flat();
  const candidate = normalizePageCaptureCandidate(normalizePageCaptureCandidate({canonicalUrl: projectUrl, title: 'Test tutorial', pageType: 'article', textBlocks: chapters}));
  for (const block of chapters) assert.ok(candidate.contentText.includes(block.text));
  assert.equal(candidate.textBlocks.length, 12);
});

test("pending embedded media remains visible to the save path after batch normalization", async () => {
  const { normalizePageCaptureBatch, applyPageCaptureSelections } = await import('../extension/page-capture.js');
  const candidate = {id:'pending-test', canonicalUrl:projectUrl,title:'Test article',contentText:'Test text',pageType:'article',media:[{id:'image',kind:'image',url:imageUrls[0],placement:'inline'}],extraction:{pendingMediaCount:1},completeness:'partial'};
  const batch = normalizePageCaptureBatch({candidates:[candidate],selections:[{candidateId:candidate.id,includeText:true,selectedMediaIds:['image'],mediaDecision:'confirmed'}]});
  assert.equal(applyPageCaptureSelections(batch)[0].extraction.pendingMediaCount,1);
  assert.equal(applyPageCaptureSelections(batch)[0].completeness,'partial');
});

test("a changed detail route is identified by its own published schema, with the complete article body", () => {
  const url='https://higgsfield.ai/academy/new-tutorial-layout';
  const result=normalizePageCaptureSitePayload(readPayload(url,[{'@type':'Article',url,name:'Test article',description:'Short test summary',articleBody:'Full test article with its last paragraph.',image:imageUrls}]),url);
  assert.equal(result.pageKind,'detail');
  assert.equal(result.pageType,'article');
  assert.equal(result.contentText,'Full test article with its last paragraph.');
  assert.equal(result.media.length,2);
});
