import test from "node:test";
import assert from "node:assert/strict";

import {
  extensionArchiveName,
  hasStableExtensionIdentity,
  requireStableExtensionIdentity
} from "../tools/release-identity.mjs";

const examplePublicKey = Buffer.alloc(128, 7).toString("base64");

test("development packages are visibly marked until the Web Store public key exists", () => {
  const manifest = { version: "1.14.0" };
  assert.equal(hasStableExtensionIdentity(manifest), false);
  assert.equal(extensionArchiveName(manifest), "PromptDirector-1.14.0-UNFIXED-ID-DEV.zip");
  assert.throws(() => requireStableExtensionIdentity(manifest), /正式安装包已阻止/);
});

test("release packages keep the normal name only with a stable manifest public key", () => {
  const manifest = { version: "1.14.0", key: examplePublicKey };
  assert.equal(hasStableExtensionIdentity(manifest), true);
  assert.equal(extensionArchiveName(manifest, { release: true }), "PromptDirector-1.14.0.zip");
});
