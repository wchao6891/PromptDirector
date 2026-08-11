import test from "node:test";
import assert from "node:assert/strict";
import { filterEntries } from "../library-model.js";
import { parseSearchQuery } from "../search-query.js";

const catalog = {
  facets: [{ id: "style", name: "风格", color: "#000", status: "active", order: 0 }],
  nodes: [{ id: "style:film", facetId: "style", name: "电影感", aliases: ["cinematic"], parentId: null, status: "active", order: 0 }]
};
const entry = {
  id: "case-1", title: "动作参考", text: "雨夜追逐", url: "https://x.com/example", savedAt: "2026-08-01T10:00:00Z",
  mediaAssets: [{ id: "video-1", kind: "video", storageMode: "managed", mimeType: "video/mp4", palette: { colors: ["#123456"] } }],
  primaryMediaId: "video-1", timeNotes: [{ id: "note-1", assetId: "video-1", startMs: 1200, text: "镜头突然加速", createdAt: "2026-08-01T10:01:00Z" }],
  facetAssignments: [{ facetId: "style", nodeId: "style:film", status: "confirmed", source: "manual" }], customLabels: ["追车"]
};

test("search query parses quoted terms and explicit operators", () => {
  assert.deepEqual(parseSearchQuery('rain type:video note:"镜头 加速"'), {
    terms: ["rain"], filters: [{ name: "type", value: "video" }, { name: "note", value: "镜头 加速" }]
  });
});

test("combined media source tag color date and note filters are ANDed", () => {
  const query = "type:video source:x.com tag:cinematic color:123 date:2026-08 note:加速 has:video";
  assert.deepEqual(filterEntries([entry], { query }, catalog).map((item) => item.id), ["case-1"]);
  assert.equal(filterEntries([entry], { query: `${query} note:静止` }, catalog).length, 0);
});

test("free words remain local full-text search alongside operators", () => {
  assert.equal(filterEntries([entry], { query: "雨夜 type:video" }, catalog).length, 1);
  assert.equal(filterEntries([entry], { query: "晴天 type:video" }, catalog).length, 0);
});
