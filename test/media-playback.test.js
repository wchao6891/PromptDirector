import test from "node:test";
import { tiktokMediaController } from "../media-playback.js";
import assert from "node:assert/strict";

import {
  YOUTUBE_PLAYBACK_HOSTS,
  buildYouTubePlaybackRule,
  ensureYouTubePlaybackPermission,
  youtubePlaybackError
} from "../media-playback.js";

test("YouTube playback permission is requested only on demand and installs a scoped session rule", async () => {
  const calls = [];
  const chromeApi = {
    runtime: {
      id: "abcdefghijklmnopabcdefghijklmnop",
      getManifest: () => ({ homepage_url: "https://github.com/example/promptdirector" })
    },
    permissions: {
      contains: async () => false,
      request: async (request) => { calls.push(["request", request]); return true; }
    },
    declarativeNetRequest: {
      updateSessionRules: async (request) => calls.push(["rules", request])
    }
  };
  assert.equal(await ensureYouTubePlaybackPermission(chromeApi, { request: false }), false);
  assert.deepEqual(calls, []);
  assert.equal(await ensureYouTubePlaybackPermission(chromeApi, { request: true }), true);
  assert.deepEqual(calls[0], ["request", {
    permissions: ["declarativeNetRequestWithHostAccess"],
    origins: YOUTUBE_PLAYBACK_HOSTS
  }]);
  const rule = calls[1][1].addRules[0];
  assert.deepEqual(rule, buildYouTubePlaybackRule({
    extensionId: chromeApi.runtime.id,
    homepageUrl: chromeApi.runtime.getManifest().homepage_url
  }));
  assert.deepEqual(rule.condition.resourceTypes, ["sub_frame"]);
  assert.deepEqual(rule.condition.initiatorDomains, [chromeApi.runtime.id]);
  assert.equal(rule.action.requestHeaders[0].header, "Referer");
});

test("YouTube playback permission refuses an unidentifiable extension", () => {
  assert.throws(() => buildYouTubePlaybackRule({ extensionId: "id", homepageUrl: "chrome-extension://id/" }), /公开项目地址/);
});

test("YouTube player errors distinguish author blocks, missing videos and client identity failures", () => {
  assert.deepEqual(youtubePlaybackError(101), { status: "blocked", blockReason: "作者禁止在其他页面内嵌播放" });
  assert.deepEqual(youtubePlaybackError(150), youtubePlaybackError(101));
  assert.match(youtubePlaybackError(100).blockReason, /不存在|私密/);
  assert.match(youtubePlaybackError(153).blockReason, /客户端身份/);
});
test("TikTok player messages require the matching frame and report real playback state", async () => {
  let listener;
  let removed = false;
  const statuses = [];
  const sent = [];
  const frame = { contentWindow: { postMessage: (...args) => sent.push(args) }, addEventListener: () => {}, removeEventListener: () => {} };
  const events = { addEventListener: (_, fn) => { listener = fn; }, removeEventListener: (_, fn) => { removed = fn === listener; } };
  const controller = tiktokMediaController(frame, (...args) => statuses.push(args), events);
  const event = (type, value, overrides = {}) => ({ origin: "https://www.tiktok.com", source: frame.contentWindow,
    data: { "x-tiktok-player": true, type, value }, ...overrides });
  listener(event("onPlayerReady", undefined, { origin: "https://evil.example" }));
  listener(event("onPlayerReady", undefined, { source: {} }));
  assert.deepEqual(statuses, []);
  await assert.rejects(controller.getCurrentTimeMs(), /尚未报告/);
  listener(event("onPlayerReady"));
  listener(event("onStateChange", 1));
  listener(event("onCurrentTime", { currentTime: 3.25 }));
  assert.equal(await controller.getCurrentTimeMs(), 3250);
  assert.deepEqual(statuses, [["播放器已加载", false], ["正在播放", false]]);
  await controller.seekToMs(2000);
  assert.deepEqual(sent, [[{ type: "seekTo", value: 2, "x-tiktok-player": true }, "https://www.tiktok.com"]]);
  listener(event("onPlayerError", { errorCode: 1001 }));
  assert.deepEqual(statuses.at(-1), ["视频不存在、已删除或设为私密", true]);
  controller.destroy();
  assert.equal(removed, true);
});
