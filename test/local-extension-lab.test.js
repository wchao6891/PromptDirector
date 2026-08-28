import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLabReceipt,
  hashRuntimeFiles,
  parseE2eOutput,
  REQUIRED_MODEL_CHAIN_SCRIPTS
} from "../tools/local-extension-lab.mjs";

test("local extension lab hashes packaged files independent of archive order", async () => {
  const left = new Map([
    ["manifest.json", new Blob(["manifest"])],
    ["background.js", new Blob(["background"])]
  ]);
  const right = new Map([...left.entries()].reverse());
  assert.equal(await hashRuntimeFiles(left), await hashRuntimeFiles(right));
});

test("local extension lab parses every browser scenario instead of stopping at the first failure", () => {
  const summary = parseE2eOutput([
    "[PASS] first_e2e.py (1.0s)",
    "[FAIL] second_e2e.py (2.0s)",
    "[PASS] third_e2e.py (3.0s)"
  ].join("\n"));
  assert.deepEqual({ total: summary.total, passed: summary.passed, failed: summary.failed }, {
    total: 3, passed: 2, failed: 1
  });
});

test("local extension receipt requires model analysis and Composer generation chains", () => {
  const modelChainOutput = REQUIRED_MODEL_CHAIN_SCRIPTS
    .map((script) => `[PASS] ${script} (1.0s)`)
    .join("\n");
  const receipt = buildLabReceipt({
    startedAt: "2026-08-28T00:00:00.000Z",
    finishedAt: "2026-08-28T00:01:00.000Z",
    manifest: { version: "1.19.3" },
    archive: { name: "PromptDirector-1.19.3-FIXED-ID-DEV.zip", sha256: "archive", fileCount: 10 },
    runtimeHash: "runtime",
    extensionId: "fixed-extension-id",
    channel: "chromium",
    preflight: { code: 0, output: "ok" },
    preflightFacts: {
      extensionId: "fixed-extension-id",
      manifestVersion: "1.19.3",
      serviceWorker: "chrome-extension://fixed-extension-id/background.js",
      pages: [
        "chrome-extension://fixed-extension-id/collector.html",
        "chrome-extension://fixed-extension-id/library.html",
        "chrome-extension://fixed-extension-id/composer.html"
      ],
      userAgent: "Chrome for Testing",
      screenshots: ["collector.png", "library.png", "composer.png"]
    },
    e2e: { code: 0, output: modelChainOutput },
    source: { commit: "abc", dirty: false }
  });
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.checks.modelChainPassed, true);
  assert.equal(receipt.proofBoundary.localPackagedChromeForTesting, true);
  assert.equal(receipt.proofBoundary.userInstalledChrome, false);
  assert.equal(receipt.proofBoundary.liveProvider, false);
  assert.equal(receipt.proofBoundary.chromeWebStore, false);
});

test("local extension receipt fails when a required model-chain scenario disappears", () => {
  const receipt = buildLabReceipt({
    startedAt: "2026-08-28T00:00:00.000Z",
    finishedAt: "2026-08-28T00:01:00.000Z",
    manifest: { version: "1.19.3" },
    archive: { name: "extension.zip", sha256: "archive", fileCount: 10 },
    runtimeHash: "runtime",
    extensionId: "fixed-extension-id",
    channel: "chromium",
    preflight: { code: 0, output: "ok" },
    preflightFacts: null,
    e2e: { code: 0, output: "[PASS] text_and_image_analysis_e2e.py (1.0s)" },
    source: { commit: "abc", dirty: false }
  });
  assert.equal(receipt.status, "failed");
  assert.ok(receipt.checks.modelChain.missing.includes("composer_video_generation_e2e.py"));
});
