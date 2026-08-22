import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSET_IMPORT_FAILURE_CODES,
  assetImportError,
  importFailureDetails
} from "../resource-limits.js";

test("asset import failures expose a serializable reason for the UI and background job", () => {
  const error = assetImportError(
    ASSET_IMPORT_FAILURE_CODES.TOO_LARGE,
    "文件超过默认上限",
    { actualBytes: 20, maxBytes: 10, forceAllowed: true, ignored: "private" }
  );

  assert.deepEqual(importFailureDetails(error), {
    code: "too_large",
    message: "文件超过默认上限",
    forceAllowed: true,
    actualBytes: 20,
    maxBytes: 10
  });
});

test("unknown runtime errors become non-forceable read failures", () => {
  assert.deepEqual(importFailureDetails(new Error("decoder stopped")), {
    code: "read_or_decode_failed",
    message: "decoder stopped",
    forceAllowed: false
  });
});
