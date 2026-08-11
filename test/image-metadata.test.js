import test from "node:test";
import assert from "node:assert/strict";

import { readImageDimensions } from "../image-metadata.js";

test("image dimensions are read from headers before browser decoding", async () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  png.set([73, 72, 68, 82], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 9000, false);
  view.setUint32(20, 5000, false);
  assert.deepEqual(
    await readImageDimensions(new Blob([png], { type: "image/png" })),
    { width: 9000, height: 5000 }
  );
  await assert.rejects(
    () => readImageDimensions(new Blob(["not an image"], { type: "image/png" })),
    /无法读取图片尺寸/
  );
});
