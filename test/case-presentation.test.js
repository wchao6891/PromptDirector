import test from "node:test";
import assert from "node:assert/strict";
import { usesArticleReader, mediaFormatLabel } from "../case-presentation.js";

test("captured prompt works use the media stage even when capture retains structured text", () => {
  const articleDocument = { blocks: [{ kind: "paragraph", text: "Original prompt" }] };
  for (const pageType of ["video", "artwork", "post"]) {
    assert.equal(usesArticleReader({ articleDocument, sourceFacts: { pageType } }), false);
  }
  assert.equal(usesArticleReader({ articleDocument, sourceFacts: { pageType: "article" } }), true);
  assert.equal(usesArticleReader({ articleDocument }), true);
});

test("media format comes from recognized file metadata, never a creator's title", () => {
  assert.equal(mediaFormatLabel({ sourceTitle: "Community post by @creator", mimeType: "video/mp4" }), "MP4");
  assert.equal(mediaFormatLabel({ sourceTitle: "Test film" }), "FILE");
  assert.equal(mediaFormatLabel({ sourceTitle: "Test animation.mov" }), "MOV");
});
