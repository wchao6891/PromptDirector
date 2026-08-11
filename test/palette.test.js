import test from "node:test";
import assert from "node:assert/strict";

import { extractPalette, PALETTE_VERSION } from "../palette.js";

test("screenshot pixels produce compact HEX swatches without inventing semantic tags", () => {
  const colors = [
    [230, 92, 42], [240, 170, 70], [16, 84, 96], [30, 130, 150],
    [18, 20, 24], [224, 220, 205], [120, 48, 90]
  ];
  const data = new Uint8ClampedArray(colors.flatMap((color) => [
    ...color, 255, ...color, 255, ...color, 255, ...color, 255
  ]));
  const palette = extractPalette({ data, width: colors.length * 4, height: 1 });

  assert.ok(palette.length >= 5 && palette.length <= 7);
  assert.ok(palette.every((color) => /^#[0-9A-F]{6}$/.test(color)));
});

test("palette v2 ignores near-white and near-black colors that only come from screenshot borders", () => {
  const width = 40;
  const height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const whiteBorder = (y < 2 || y >= height - 2) && x >= 2 && x < width - 2;
      const blackBorder = x < 2 || x >= width - 2;
      const color = whiteBorder ? [255, 255, 255] : blackBorder ? [0, 0, 0] : [184, 40, 24];
      data.set([...color, 255], (y * width + x) * 4);
    }
  }

  const palette = extractPalette({ data, width, height });
  assert.equal(PALETTE_VERSION, 2);
  assert.ok(palette.includes("#B82818"));
  assert.ok(!palette.includes("#F8F8F8"));
  assert.ok(!palette.includes("#080808"));
});

test("palette v2 keeps intentional black and white subjects away from the border", () => {
  const width = 40;
  const height = 30;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const centerBlack = x >= 10 && x < 20 && y >= 8 && y < 22;
      const centerWhite = x >= 20 && x < 30 && y >= 8 && y < 22;
      const color = centerBlack ? [0, 0, 0] : centerWhite ? [255, 255, 255] : [72, 104, 136];
      data.set([...color, 255], (y * width + x) * 4);
    }
  }

  const palette = extractPalette({ data, width, height });
  assert.ok(palette.includes("#080808"));
  assert.ok(palette.includes("#F8F8F8"));
});

test("palette v2 keeps a usable swatch for intentional monochrome images", () => {
  for (const value of [0, 255]) {
    const width = 20;
    const height = 20;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      data.set([value, value, value, 255], pixel * 4);
    }
    assert.deepEqual(extractPalette({ data, width, height }), [value ? "#F8F8F8" : "#080808"]);
  }
});
