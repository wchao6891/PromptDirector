import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../video-hover-preview.js", import.meta.url), "utf8");

test("video hover preview loads one local blob only after pointer entry", () => {
  const beforeStart = source.slice(0, source.indexOf("const start"));
  const start = source.slice(source.indexOf("const start"), source.indexOf("const stop"));
  assert.doesNotMatch(beforeStart, /loadBlob\(\)/);
  assert.match(start, /await options\.loadBlob\(\)/);
  assert.match(start, /video\.muted = true/);
  assert.match(start, /video\.loop = true/);
  assert.match(start, /video\.playsInline = true/);
  assert.match(start, /await video\.play\(\)/);
});

test("video hover preview respects pointer and motion preferences", () => {
  assert.match(source, /dataset\.motion === "reduced"/);
  assert.match(source, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(source, /pointerenter/);
  assert.match(source, /pointerleave/);
});

test("video hover preview releases playback and object URLs on every exit", () => {
  const destroy = source.slice(source.indexOf("const destroyPlayer"), source.indexOf("const start"));
  assert.match(destroy, /video\.pause\(\)/);
  assert.match(destroy, /video\.removeAttribute\("src"\)/);
  assert.match(destroy, /video\.remove\(\)/);
  assert.match(destroy, /URL\.revokeObjectURL\(objectUrl\)/);
});
