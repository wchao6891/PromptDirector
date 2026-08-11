import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCreativeExperimentPackage,
  mergeCreativeExperimentPackage,
  parseCreativeExperimentPackage
} from "../creative-experiment-package.js";
import { createComposerSession, normalizeComposerSettings } from "../composer.js";

function state() {
  return {
    composerSettings: normalizeComposerSettings(),
    composerSessions: [createComposerSession({
      id: "session:one",
      messages: [{ role: "user", content: "生成一张猫的电影海报" }],
      promptVersions: [{
        id: "prompt:one",
        text: "cinematic cat poster",
        createdAt: "2026-07-24T10:00:00.000Z"
      }]
    })],
    creativeExperimentSettings: { enabled: true, autoAnalyze: false },
    creativeRuns: [{
      id: "run:one",
      version: 1,
      sessionId: "session:one",
      promptVersionId: "prompt:one",
      targetType: "image",
      promptText: "cinematic cat poster",
      createdAt: "2026-07-24T10:05:00.000Z",
      updatedAt: "2026-07-24T10:05:00.000Z",
      outputs: [{
        visual: { id: "result:one", capturedAt: "2026-07-24T10:05:00.000Z" },
        capturedAt: "2026-07-24T10:05:00.000Z",
        signals: [{ type: "captured", at: "2026-07-24T10:05:00.000Z" }]
      }]
    }]
  };
}

test("experiment packages contain only reproducible composer evidence and no credentials", () => {
  const result = buildCreativeExperimentPackage(state(), {
    "result:one": "results/run-one/result-one.webp"
  });
  const json = JSON.stringify(result);
  assert.equal(result.format, "promptdirector-creative-experiments");
  assert.equal(result.sessions.length, 1);
  assert.equal(result.runs.length, 1);
  assert.match(json, /cinematic cat poster/);
  assert.doesNotMatch(json, /apiKey|visionSettings|aiSettings|entries|organizerState/);
});

test("experiment package parsing validates every result image", () => {
  const data = buildCreativeExperimentPackage(state(), {
    "result:one": "results/run-one/result-one.webp"
  });
  const files = new Map([[
    "results/run-one/result-one.webp",
    new Blob(["image"], { type: "image/webp" })
  ]]);
  const parsed = parseCreativeExperimentPackage(data, files);
  assert.equal(parsed.images.get("result:one").type, "image/webp");
  assert.throws(() => parseCreativeExperimentPackage(data, new Map()), /缺少结果图片/);
});

test("experiment import remaps colliding sessions, runs, and visual ids without changing prompt links", () => {
  const incoming = buildCreativeExperimentPackage(state(), {
    "result:one": "results/run-one/result-one.webp"
  });
  const merged = mergeCreativeExperimentPackage(state(), incoming);
  assert.equal(merged.state.composerSessions.length, 2);
  assert.equal(merged.state.creativeRuns.length, 2);
  const imported = merged.state.creativeRuns.find((item) => item.id !== "run:one");
  assert.notEqual(imported.sessionId, "session:one");
  assert.notEqual(imported.outputs[0].visual.id, "result:one");
  assert.equal(imported.promptVersionId, "prompt:one");
  assert.equal(merged.visualIdMap["result:one"], imported.outputs[0].visual.id);
});

test("experiment packages round-trip frozen Skills, user judgments, and video media", () => {
  const source = state();
  source.creativeRuns[0].appliedSkills = [{
    skillId: "skill:one",
    versionId: "skill-version:one",
    callName: "poster-method",
    portableId: "poster-method",
    description: "Poster method",
    skillMarkdown: "# Poster method\n\nKeep the focal hierarchy.",
    references: [],
    source: "generated",
    textMode: true
  }];
  source.creativeRuns[0].outputs[0].judgment = {
    keep: "保留主体层级",
    improve: "减弱背景反差",
    updatedAt: "2026-08-08T12:00:00.000Z"
  };
  source.creativeRuns[0].targetType = "video";
  source.creativeRuns[0].outputs[0].visual = {
    id: "result:video",
    kind: "video",
    storageMode: "managed",
    mimeType: "video/mp4",
    byteSize: 5,
    capturedAt: "2026-07-24T10:05:00.000Z"
  };
  const packaged = buildCreativeExperimentPackage(source, {
    "result:video": "results/run-one/result-video.mp4"
  });
  const parsed = parseCreativeExperimentPackage(packaged, new Map([[
    "results/run-one/result-video.mp4",
    new Blob(["video"], { type: "video/mp4" })
  ]]));
  assert.equal(packaged.version, 2);
  assert.equal(parsed.assets.get("result:video").type, "video/mp4");
  assert.equal(parsed.images.size, 0);
  assert.equal(parsed.runs[0].appliedSkills[0].versionId, "skill-version:one");
  assert.equal(parsed.runs[0].outputs[0].judgment.improve, "减弱背景反差");
});
