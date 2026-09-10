import test from "node:test";
import assert from "node:assert/strict";
import { applyLibraryImportWithReceipt } from "../extension/library-import-client.js";
const message = { operationId: "fixture-operation", planToken: "fixture-plan" };
const result = { ok: true, recoveryPointCreatedAt: "fixture-date" };
const receipt = { ...message, status: "completed", result };
const readReceipts = async () => ({ libraryImportTransactions: { items: [receipt] } });
test("a completed restore whose reply was lost returns its durable result without applying again", async () => {
  let calls = 0;
  assert.deepEqual(await applyLibraryImportWithReceipt(message, {
    send: async () => { calls++; throw new Error("channel closed"); }, readReceipts
  }), result);
  assert.equal(calls, 1);
});
test("a pre-commit disconnection resumes the same operation and confirmed plan", async () => {
  let calls = 0;
  assert.deepEqual(await applyLibraryImportWithReceipt(message, {
    send: async request => { assert.equal(request, message); if (!calls++) throw new Error("channel closed"); return result; },
    readReceipts: async () => ({})
  }), result);
  assert.equal(calls, 2);
});
test("unconfirmed outcomes preserve staged media and are never reported as a failed commit", async () => {
  await assert.rejects(applyLibraryImportWithReceipt(message, {
    send: async () => { throw new Error("channel closed"); },
    readReceipts: async () => ({ libraryImportTransactions: { items: [{ ...receipt, planToken: "other-plan" }] } })
  }), { code: "IMPORT_OUTCOME_UNKNOWN" });
});
