import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("fieldless confirmations do not render an empty body or permanent status band", async () => {
  const source = await readFile(new URL("../ui-dialogs.js", import.meta.url), "utf8");
  assert.match(source, /if \(controls\.size \|\| body\.childElementCount\) form\.append\(body\)/);
  assert.match(source, /typeof options\.renderBody === "function"/);
  assert.match(source, /const ensureStatus = \(\) =>/);
  assert.doesNotMatch(source, /body\.append\(status\);\s*const footer/);
});

test("video detail sizes from media dimensions and separates native controls from app actions", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../library.js", import.meta.url), "utf8"),
    readFile(new URL("../library.css", import.meta.url), "utf8")
  ]);
  assert.match(source, /localVideo\.videoWidth/);
  assert.match(css, /is-video-detail\.is-immersive \{ height: auto/);
  assert.match(css, /border-top: 16px solid var\(--viewer-bg\)/);
  assert.match(css, /detail-visual-actions button \{ min-height: 36px/);
  const mobile = css.slice(css.lastIndexOf("@media (max-width: 390px)"));
  assert.match(mobile, /detail-visual-actions[\s\S]*min-height:\s*44px/);
  assert.match(css, /button-danger-secondary/);
});
