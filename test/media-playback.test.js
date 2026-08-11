import test from "node:test";
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
