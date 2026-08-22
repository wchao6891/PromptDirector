import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [html, css, js] = await Promise.all([
  readFile(new URL("library.html", root), "utf8"),
  readFile(new URL("library.css", root), "utf8"),
  readFile(new URL("library.js", root), "utf8")
]);

test("general settings show separate web-capture and clipboard permission status", () => {
  assert.match(html, /id="capture-web-permission-status"/);
  assert.match(html, /id="capture-clipboard-permission-status"/);
  assert.match(html, /id="revoke-capture-web-permission"/);
  assert.match(html, /id="revoke-capture-clipboard-permission"/);
  assert.match(html, /这里不会读取剪贴板/);
  assert.match(css, /\.capture-permission-list\s*\{/);
  assert.match(css, /\.capture-permission-row\s*\{/);
});

test("permission settings inspect grants without requesting or reading clipboard content", () => {
  const renderFlow = js.slice(
    js.indexOf("async function renderCapturePermissionStatus"),
    js.indexOf("async function revokeCapturePermission")
  );
  assert.match(renderFlow, /inspectCapturePermissionBundle\(chrome\.permissions\)/);
  assert.doesNotMatch(renderFlow, /permissions\.request|navigator\.clipboard|readClipboard/);
});

test("revocation removes the matching optional permission and resets first-use disclosure", () => {
  const revokeFlow = js.slice(
    js.indexOf("async function revokeCapturePermission"),
    js.indexOf("async function chooseSyncFolder")
  );
  assert.match(revokeFlow, /origins:\s*\[\.\.\.CONTINUOUS_CAPTURE_ORIGINS\]/);
  assert.match(revokeFlow, /permissions:\s*\[\.\.\.CLIPBOARD_READ_PERMISSIONS\]/);
  assert.match(revokeFlow, /const\s+removed\s*=\s*await\s+chrome\.permissions\.remove\(request\)/);
  assert.match(revokeFlow, /if\s*\(!removed\)\s*throw\s+new Error/);
  assert.match(revokeFlow, /chrome\.storage\.local\.remove\(CAPTURE_PERMISSION_ONBOARDING_STORAGE_KEY\)/);
  assert.doesNotMatch(revokeFlow, /permissions\.request|navigator\.clipboard|readClipboard/);
});
