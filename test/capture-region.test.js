import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  capturePermissionMessage,
  captureVisibleTabWithRecovery
} from "../capture-region.js";

const sourceUrl = new URL("../capture-region.js", import.meta.url);

test("expired activeTab access becomes a recovery instruction instead of a Chrome permission error", () => {
  const message = capturePermissionMessage(
    new Error("Either the '<all_urls>' or 'activeTab' permission is required.")
  );

  assert.equal(
    message,
    "跨网页截图权限没有生效，请返回侧边栏重新授权；当前草稿没有改变。"
  );
});

test("visible-tab capture preserves unrelated failures but translates an expired activeTab grant", async () => {
  await assert.rejects(
    () => captureVisibleTabWithRecovery(
      async () => {
        throw new Error("Either the '<all_urls>' or 'activeTab' permission is required.");
      },
      7,
      { format: "png" },
      "Click the toolbar icon once, then select the area again."
    ),
    {
      message: "Click the toolbar icon once, then select the area again."
    }
  );

  const unrelated = new Error("截图服务暂时不可用");
  await assert.rejects(
    () => captureVisibleTabWithRecovery(async () => {
      throw unrelated;
    }, 7),
    (error) => error === unrelated
  );
});

test("capture region saves a valid drag immediately without a confirmation step", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const manualCaptureSource = source.slice(
    source.indexOf("export function selectCaptureRegion"),
    source.indexOf("export function selectPageVisuals")
  );

  assert.match(manualCaptureSource, /finish\(\{\s*rect:/);
  assert.match(manualCaptureSource, /event\.key === "Escape"/);
  assert.doesNotMatch(manualCaptureSource, /confirmButton/);
  assert.doesNotMatch(manualCaptureSource, /adjustButton/);
  assert.doesNotMatch(manualCaptureSource, /cancelButton/);
  assert.doesNotMatch(manualCaptureSource, /is-reviewing/);
  assert.doesNotMatch(manualCaptureSource, /is-adjusting/);
  assert.doesNotMatch(manualCaptureSource, /隐藏小型悬浮控件/);
});

test("smart visual bounds exclude borders, contain padding, rounded corners, and outward pixel rounding", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const smartCaptureSource = source.slice(source.indexOf("export function selectPageVisuals"));
  assert.match(smartCaptureSource, /function visualContentBounds/);
  assert.match(smartCaptureSource, /style\.borderLeftWidth/);
  assert.match(smartCaptureSource, /\["contain", "scale-down", "none"\]\.includes\(fit\)/);
  assert.match(smartCaptureSource, /radius \* \(1 - Math\.SQRT1_2\)/);
  assert.match(smartCaptureSource, /x:\s*Math\.ceil\(left\)/);
  assert.match(smartCaptureSource, /Math\.floor\(right\) - Math\.ceil\(left\)/);
});
