import test from "node:test";
import assert from "node:assert/strict";
import { skillExtractionWorkload } from "../creative-skill-service.js";

test("Skill extraction partitions all source text without sampling or truncation", () => {
  const sources = [
    { prompt: "A".repeat(18_000), analysis: "B".repeat(9_000) },
    { prompt: "C".repeat(17_000), analysis: "" }
  ];
  const workload = skillExtractionWorkload({ sources, maxBatchCharacters: 10_000 });
  assert.equal(workload.overSingleRequest, true);
  assert.equal(workload.requestCount, workload.textBatchCount + 1);
  const reconstructed = workload.batches.flat().map((source) => source.prompt + source.analysis).join("");
  assert.equal(reconstructed, sources.map((source) => source.prompt + source.analysis).join(""));
});
