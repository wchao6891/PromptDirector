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

test("privacy policy discloses that composer text-only mode reads and sends zero images", async () => {
  const policy = await privacyPolicy();
  assert.match(policy, /全程只用案例\/分析文字/);
  assert.match(policy, /不会读取、分析或发送图片/);
  assert.match(policy, /图片载荷为零/);
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

test("privacy policy explains corrected article regions and safe download handling", async () => {
  const policy = await privacyPolicy();
  assert.match(policy, /添加遗漏内容、排除错误内容、整组修正、撤销或恢复自动识别/);
  assert.match(policy, /正文在主体确认后默认纳入/);
  assert.match(policy, /正文内已定位媒体默认进入保存方案/);
  assert.match(policy, /无法确认文章位置的媒体默认不选/);
  assert.match(policy, /“保存案例”按钮是当前媒体方案的最终授权/);
  assert.match(policy, /“只保存正文”/);
  assert.match(policy, /PDF、Markdown、SKILL\.md、TXT、HTML 和 RTF/);
  assert.match(policy, /只有属于用户最终保存方案时/);
  assert.match(policy, /真实文件类型和容量限制/);
  assert.match(policy, /压缩包、程序和未知类型文件不会自动下载/);
  assert.match(policy, /失败时只保留原始来源链接/);
});
