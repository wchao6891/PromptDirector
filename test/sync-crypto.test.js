import test from "node:test";
import assert from "node:assert/strict";

import {
  createVaultHeader,
  decryptVaultValue,
  encryptVaultValue,
  unlockVaultHeader
} from "../sync-crypto.js";

test("vault encryption round-trips structured data with a different IV for every file", async () => {
  const { header, key } = await createVaultHeader("correct horse battery staple");
  const first = await encryptVaultValue({ entries: [{ id: "one" }] }, key);
  const second = await encryptVaultValue({ entries: [{ id: "one" }] }, key);

  assert.notEqual(first.iv, second.iv);
  assert.deepEqual(await decryptVaultValue(first, key), { entries: [{ id: "one" }] });
  assert.deepEqual(await decryptVaultValue(second, key), { entries: [{ id: "one" }] });
  assert.equal(header.kdf.iterations, 600_000);
  assert.equal(header.cipher.name, "AES-GCM");
});

test("a wrong password cannot unlock or partially decrypt a vault", async () => {
  const { header, key } = await createVaultHeader("right password");
  const encrypted = await encryptVaultValue({ valuable: true }, key);

  await assert.rejects(() => unlockVaultHeader(header, "wrong password"), /密码不正确|同步库已损坏/);
  const wrong = await createVaultHeader("wrong password");
  await assert.rejects(() => decryptVaultValue(encrypted, wrong.key), /无法解密/);
});

test("vault passwords and keys are not embedded in the serialized header", async () => {
  const password = "never-write-this-password";
  const { header } = await createVaultHeader(password);
  const serialized = JSON.stringify(header);

  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes("CryptoKey"), false);
});
