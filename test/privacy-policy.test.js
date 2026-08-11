import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

async function privacyPolicy() {
  return readFile(new URL("store/PRIVACY_POLICY.md", root), "utf8");
}

test("privacy policy discloses the current seven AI tasks and their external-media boundary", async () => {
  const policy = await privacyPolicy();
  for (const task of ["文字标签", "Skill 提炼", "创作规划", "图片分析", "视频分析", "图片生成", "视频生成"]) {
    assert.match(policy, new RegExp(task));
  }
  assert.match(policy, /用户选择的第三方 AI 服务/);
  assert.match(policy, /自定义兼容接口/);
  assert.match(policy, /图片、视频/);
  assert.match(policy, /只发送完成当前任务所必需、且由用户明确选择或提交的内容/);
  assert.match(policy, /不会自动发送整库、全部案例、未选择案例/);
});

test("privacy policy makes the two independent execution confirmations explicit", async () => {
  const policy = await privacyPolicy();
  assert.match(policy, /发送授权.*所有真实外部请求.*前置条件/);
  assert.match(policy, /单次付费确认.*当前操作/);
  assert.match(policy, /两者不能互相替代/);
});

test("privacy policy accurately declares local-first handling and manifest permissions", async () => {
  const [policy, manifestSource] = await Promise.all([
    privacyPolicy(),
    readFile(new URL("manifest.json", root), "utf8")
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.match(policy, /本地优先/);
  assert.match(policy, /不提供开发者服务器/);
  assert.match(policy, /不出售用户数据/);
  for (const permission of [...manifest.permissions, ...manifest.optional_permissions]) {
    assert.match(policy, new RegExp("`" + permission + "`"), `policy must disclose ${permission}`);
  }
  assert.match(policy, /`https:\/\/api\.deepseek\.com\/\*`/);
  assert.match(policy, /`<all_urls>`/);
});
