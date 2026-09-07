import test from "node:test";
import assert from "node:assert/strict";
import { usesArticleReader, usesPostReader, mediaFormatLabel } from "../case-presentation.js";

test("creative classifications open existing case details regardless of webpage origin", () => {
  const articleDocument = { blocks: [{ kind: "paragraph", text: "Original prompt" }] };
  for (const id of ["content:prompt:image", "content:prompt:video", "content:image-case", "content:video-case"]) {
    for (const pageType of ["article", "post", "video", "artwork"]) {
      const entry = { classification: { pathIds: [id] }, articleDocument, sourceFacts: { pageType } };
      assert.equal(usesArticleReader(entry), false);
      assert.equal(usesPostReader(entry), false);
      assert.equal(usesPostReader({ ...entry, articleDocument: null }), false);
    }
  }
});

test("article roles retain structured reading including X quotes and media", () => {
  const articleDocument = { blocks: [{ kind: "quote", text: "Quoted context" }] };
  for (const id of ["content:tutorial", "content:reference"]) {
    for (const pageType of ["article", "post", "video", "artwork"]) {
      const entry = { classification: { pathIds: [id] }, articleDocument, sourceFacts: { pageType } };
      assert.equal(usesArticleReader(entry), true);
      assert.equal(usesPostReader(entry), false);
    }
  }
  assert.equal(usesArticleReader({ articleDocument }), true);
  assert.equal(usesPostReader({ sourceFacts: { pageType: "post" } }), true);
  assert.equal(usesArticleReader({ text: "Ordinary text case" }), false);
});

test("renamed and custom categories use their resolved purpose, not their display label", () => {
  const base = { articleDocument: { blocks: [{ kind: "paragraph", text: "text" }] }, sourceFacts: { pageType: "post" } };
  assert.equal(usesArticleReader({ ...base, contentRole: "prompt_video" }), false);
  assert.equal(usesPostReader({ ...base, contentRole: "prompt_video" }), false);
  assert.equal(usesArticleReader({ ...base, contentRole: "reference" }), true);
});

test("media format comes from recognized file metadata, never a creator's title", () => {
  assert.equal(mediaFormatLabel({ sourceTitle: "Community post by @creator", mimeType: "video/mp4" }), "MP4");
  assert.equal(mediaFormatLabel({ sourceTitle: "Test film" }), "FILE");
  assert.equal(mediaFormatLabel({ sourceTitle: "Test animation.mov" }), "MOV");
});
