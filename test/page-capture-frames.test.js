import test from "node:test";
import assert from "node:assert/strict";
import { readPageCaptureVideoFrame, resolvePageCaptureVideoFrames } from "../page-capture-frames.js";
import { normalizePageCaptureCandidate } from "../page-capture.js";

const frameUrl = "https://www.artstation.com/api/v2/animation/video_clips/fixture/embed.html?s=fixture";
const videoUrl = "https://cdn.artstation.com/p/video_sources/fixture.mp4";
const snapshot = () => ({ candidates: [{
  id: "work", canonicalUrl: "https://artist.artstation.com/projects/fixture", title: "Mixed artwork",
  completeness: "complete", sourceFacts: { status: "complete" },
  media: [{ id: "image", kind: "image", url: "https://cdn.artstation.com/fixture.jpg" },
    { id: "film", kind: "video", url: frameUrl }],
  articleDocument: { version: 1, blocks: [{ id: "film-block", kind: "video", assetId: "film", sourceUrl: frameUrl }] }
}] });

test("a loaded project player becomes a downloadable video without changing media identity or order", async () => {
  const result = await resolvePageCaptureVideoFrames(snapshot(), 42, {
    executeScript: async request => {
      assert.deepEqual(request.target, { tabId: 42, allFrames: true });
      assert.deepEqual(request.args, [[frameUrl]]);
      return [{ frameId: 0, result: null }, { frameId: 8, result: {
        frameUrl, url: videoUrl, posterUrl: "https://cdn.artstation.com/thumb.jpg", width: 360, height: 400
      } }];
    }
  });
  const candidate = normalizePageCaptureCandidate(result.candidates[0]);
  assert.deepEqual(candidate.media.map(item => item.id), ["image", "film"]);
  assert.equal(candidate.media[1].url, videoUrl);
  assert.equal(candidate.media[1].sourceKind, "video-element");
  assert.equal(candidate.articleDocument.blocks[0].assetId, "film");
  assert.equal(candidate.articleDocument.blocks[0].sourceUrl, videoUrl);
  assert.equal(candidate.completeness, "complete");
});

test("inaccessible or unloaded players keep their place and report an incomplete capture", async () => {
  for (const scripting of [{ executeScript: async () => { throw new Error("Missing host permission"); } },
    { executeScript: async () => [{ result: null }] }]) {
    const result = await resolvePageCaptureVideoFrames(snapshot(), 42, scripting);
    const candidate = normalizePageCaptureCandidate(result.candidates[0]);
    assert.equal(candidate.media.length, 2);
    assert.equal(candidate.media[1].url, frameUrl);
    assert.equal(candidate.completeness, "partial");
    assert.equal(candidate.sourceFacts.status, "partial");
    assert.equal(candidate.extraction.pendingMediaCount, 1);
  }
});

test("ordinary pages and unrelated or spoofed frames do not trigger the player reader", async () => {
  for (const url of ["https://www.artstation.com/account", frameUrl.replace(".com/", ".com.evil.test/"), "https://example.com/player"]) {
    const input = snapshot();
    input.candidates[0].media[1].url = url;
    assert.equal(await resolvePageCaptureVideoFrames(input, 42, {
      executeScript: () => assert.fail("unselected and unsupported frames must not be read")
    }), input);
  }
});

test("the serialized frame reader inspects only the selected frame and uses the active media source", () => {
  const original = { location: globalThis.location, document: globalThis.document };
  const reader = (0, eval)(`(${readPageCaptureVideoFrame.toString()})`);
  try {
    globalThis.location = { href: "https://example.com/advert" };
    globalThis.document = { querySelectorAll: () => assert.fail("unselected frames must not be inspected") };
    assert.equal(reader([frameUrl]), null);
    globalThis.location = { href: frameUrl };
    globalThis.document = { querySelectorAll: () => [{ currentSrc: videoUrl, poster: "", videoWidth: 360, videoHeight: 400 }] };
    assert.equal(reader([frameUrl]).url, videoUrl);
    globalThis.document = { querySelectorAll: () => [{ currentSrc: "blob:https://www.artstation.com/fixture" }] };
    assert.equal(reader([frameUrl]), null);
  } finally {
    Object.assign(globalThis, original);
  }
});
