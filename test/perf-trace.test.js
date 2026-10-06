import test from "node:test";
import assert from "node:assert/strict";
import { jsonBytes, resetTiming, setTimingEnabled, startPhase, timingSummary, tracePhase } from "../extension/perf-trace.js";

test("phase timing stays off by default and never evaluates byte sizes while off", () => {
  setTimingEnabled(false);
  let measured = 0;
  startPhase("background", "write")({ bytes: () => { measured++; return 1; } });
  assert.equal(measured, 0);
  assert.deepEqual(timingSummary(), []);
});

test("enabled timing reports P50/P95 per phase and separates external waits from local work", async () => {
  setTimingEnabled(true);
  try {
    resetTiming();
    for (let index = 0; index < 20; index++) startPhase("library", "derive")({ bytes: () => jsonBytes({ index }) });
    await tracePhase("capture", "wait:download", async () => {});
    const summary = timingSummary();
    const derive = summary.find((item) => item.phase === "library/derive");
    assert.equal(derive.count, 20);
    assert.equal(derive.kind, "local");
    assert.ok(derive.p95Ms >= derive.p50Ms);
    assert.ok(derive.maxBytes > 0);
    assert.equal(summary.find((item) => item.phase === "capture/wait:download").kind, "external");
    assert.ok(Object.keys(derive).every((key) => ["phase", "kind", "count", "p50Ms", "p95Ms", "maxMs", "totalMs", "p50Bytes", "maxBytes"].includes(key)),
      "samples hold only names, durations and sizes");
  } finally {
    setTimingEnabled(false);
  }
});
