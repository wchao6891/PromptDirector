import test from "node:test";
import assert from "node:assert/strict";

import { normalizePortableMediaDescriptor } from "../library-package-contract.js";

test("jpeg and jpg aliases normalize to the actual portable path without changing the image format", () => {
  const normalized = normalizePortableMediaDescriptor({
    id: "asset:legacy-jpeg",
    kind: "image",
    storageMode: "managed",
    assetPath: "images/case-one/asset-one.jpg",
    sourceFormat: "jpeg",
    mimeType: "image/jpg",
    byteSize: 12
  });

  assert.equal(normalized.assetPath, "images/case-one/asset-one.jpg");
  assert.equal(normalized.sourceFormat, "jpg");
  assert.equal(normalized.mimeType, "image/jpg");
  assert.equal(normalized.byteSize, 12);
});
