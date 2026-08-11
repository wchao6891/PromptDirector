import test from "node:test";
import assert from "node:assert/strict";

import {
  addMaskStroke,
  clearMaskStrokes,
  createMaskDocument,
  maskAlphaAt,
  scalePointerToImage,
  undoMaskStroke
} from "../composer-image-workspace.js";

test("mask coordinates follow the displayed image while transparent pixels mean edit", () => {
  const point = scalePointerToImage({
    clientX: 150,
    clientY: 100,
    rect: { left: 50, top: 50, width: 200, height: 100 },
    imageWidth: 1000,
    imageHeight: 500
  });
  assert.deepEqual(point, { x: 500, y: 250 });

  const mask = addMaskStroke(createMaskDocument(1000, 500), {
    tool: "brush",
    size: 80,
    points: [point]
  });
  assert.equal(maskAlphaAt(mask, 500, 250), 0);
  assert.equal(maskAlphaAt(mask, 100, 100), 255);
});

test("mask eraser restores opacity and undo or clear never mutates prior state", () => {
  const empty = createMaskDocument(400, 300);
  const painted = addMaskStroke(empty, { tool: "brush", size: 50, points: [{ x: 100, y: 100 }] });
  const erased = addMaskStroke(painted, { tool: "eraser", size: 30, points: [{ x: 100, y: 100 }] });
  assert.equal(maskAlphaAt(painted, 100, 100), 0);
  assert.equal(maskAlphaAt(erased, 100, 100), 255);
  assert.equal(undoMaskStroke(erased).strokes.length, 1);
  assert.equal(clearMaskStrokes(erased).strokes.length, 0);
  assert.equal(empty.strokes.length, 0);
});
