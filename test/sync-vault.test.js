import test from "node:test";
import assert from "node:assert/strict";

import {
  createOrUnlockSyncVault,
  listSyncSnapshots,
  readSyncObject,
  writeSyncObject,
  writeSyncSnapshot
} from "../sync-vault.js";
import { createRevisionSnapshot } from "../sync-model.js";

test("vault stores immutable per-device states and encrypted deduplicated image objects", async () => {
  const root = new MemoryDirectory("root");
  const vault = await createOrUnlockSyncVault(root, "password-123");
  const first = await createRevisionSnapshot({ entries: [] }, { deviceId: "device:a", logicalClock: 1 });
  const second = await createRevisionSnapshot({ entries: [] }, { deviceId: "device:a", logicalClock: 2, baseSnapshot: first });

  await writeSyncSnapshot(vault, first);
  await writeSyncSnapshot(vault, second);
  const snapshots = await listSyncSnapshots(vault);
  assert.deepEqual(snapshots.map((item) => item.logicalClock), [1, 2]);

  const blob = new Blob(["image bytes"], { type: "image/webp" });
  const objectId = await writeSyncObject(vault, blob);
  assert.equal(await writeSyncObject(vault, blob), objectId);
  const restored = await readSyncObject(vault, objectId);
  assert.equal(await restored.text(), "image bytes");

  const rootDump = JSON.stringify(root.dump());
  assert.equal(rootDump.includes("image bytes"), false);
  assert.equal(rootDump.includes("password-123"), false);
});

test("large video objects are chunked deduplicated and reject one damaged chunk", async () => {
  const root = new MemoryDirectory("root");
  const vault = await createOrUnlockSyncVault(root, "password-123");
  const video = new Blob(["abcdefghijklmno"], { type: "video/mp4" });
  const objectId = await writeSyncObject(vault, video, { chunkBytes: 5 });
  assert.equal(await writeSyncObject(vault, video, { chunkBytes: 5 }), objectId);
  const objects = await root.getDirectoryHandle("PromptDirector-Sync").then((directory) => directory.getDirectoryHandle("objects"));
  const chunkNames = [...objects.entries.keys()].filter((name) => name.endsWith(".pdc"));
  assert.equal(chunkNames.length, 3);
  assert.equal(await (await readSyncObject(vault, objectId)).text(), "abcdefghijklmno");
  await writeText(objects, chunkNames[1], "{damaged");
  await assert.rejects(() => readSyncObject(vault, objectId), /JSON|损坏|解密|Unexpected/);
});

test("a damaged formal state blocks silent success while an incomplete atomic file is ignored", async () => {
  const root = new MemoryDirectory("root");
  const vault = await createOrUnlockSyncVault(root, "password-123");
  const snapshot = await createRevisionSnapshot({ entries: [] }, { deviceId: "device:a", logicalClock: 1 });
  await writeSyncSnapshot(vault, snapshot);

  const device = await root
    .getDirectoryHandle("PromptDirector-Sync")
    .then((directory) => directory.getDirectoryHandle("devices"))
    .then((directory) => directory.getDirectoryHandle("device-a"));
  await writeText(device, "999-broken.pds", "{broken");
  await writeText(device, "1000-unfinished.partial", "incomplete");

  await assert.rejects(
    () => listSyncSnapshots(vault),
    (error) => error?.code === "sync_snapshot_corrupt" && /999-broken\.pds/.test(error.message)
  );

  device.entries.delete("999-broken.pds");
  const snapshots = await listSyncSnapshots(vault);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].snapshotId, snapshot.snapshotId);
});

test("vault object operations honor cancellation before publishing a manifest", async () => {
  const root = new MemoryDirectory("root");
  const vault = await createOrUnlockSyncVault(root, "password-123");
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => writeSyncObject(vault, new Blob(["audio"], { type: "audio/mpeg" }), { signal: controller.signal }),
    (error) => error?.name === "AbortError"
  );
  const objects = await root.getDirectoryHandle("PromptDirector-Sync").then((directory) => directory.getDirectoryHandle("objects"));
  assert.equal(objects.entries.size, 0);
});

test("encrypted sync keeps supported audio and inert external Skill files", async () => {
  const root = new MemoryDirectory("root");
  const vault = await createOrUnlockSyncVault(root, "password-123");
  for (const blob of [
    new Blob(["audio"], { type: "audio/mpeg" }),
    new Blob(["binary asset"], { type: "application/octet-stream" })
  ]) {
    const objectId = await writeSyncObject(vault, blob);
    const restored = await readSyncObject(vault, objectId);
    assert.equal(await restored.text(), await blob.text());
    assert.equal(restored.type, blob.type);
  }
});

test("a second profile can unlock the same folder but a wrong password cannot read it", async () => {
  const root = new MemoryDirectory("root");
  const first = await createOrUnlockSyncVault(root, "password-123");
  const snapshot = await createRevisionSnapshot({ entries: [] }, { deviceId: "device:a", logicalClock: 1 });
  await writeSyncSnapshot(first, snapshot);

  const second = await createOrUnlockSyncVault(root, "password-123");
  assert.equal((await listSyncSnapshots(second)).length, 1);
  await assert.rejects(() => createOrUnlockSyncVault(root, "wrong-password"), /密码不正确|同步库已损坏/);
});

test("an existing partial vault without its header is never replaced by a new empty vault", async () => {
  const root = new MemoryDirectory("root");
  const directory = await root.getDirectoryHandle("PromptDirector-Sync", { create: true });
  const devices = await directory.getDirectoryHandle("devices", { create: true });
  await writeText(devices, "remote-state.partial", "still synchronizing");

  await assert.rejects(
    () => createOrUnlockSyncVault(root, "password-123"),
    /缺少加密文件头/
  );
  assert.equal(directory.entries.has("vault.json"), false);
});

class MemoryDirectory {
  constructor(name) {
    this.kind = "directory";
    this.name = name;
    this.entries = new Map();
  }

  async getDirectoryHandle(name, options = {}) {
    const existing = this.entries.get(name);
    if (existing?.kind === "directory") return existing;
    if (existing || !options.create) throw new DOMException("Not found", "NotFoundError");
    const directory = new MemoryDirectory(name);
    this.entries.set(name, directory);
    return directory;
  }

  async getFileHandle(name, options = {}) {
    const existing = this.entries.get(name);
    if (existing?.kind === "file") return existing;
    if (existing || !options.create) throw new DOMException("Not found", "NotFoundError");
    const file = new MemoryFile(name);
    this.entries.set(name, file);
    return file;
  }

  async removeEntry(name) {
    this.entries.delete(name);
  }

  async *values() {
    yield* this.entries.values();
  }

  dump() {
    return Object.fromEntries([...this.entries].map(([name, value]) => [name, value.dump()]));
  }
}

class MemoryFile {
  constructor(name) {
    this.kind = "file";
    this.name = name;
    this.bytes = new Uint8Array();
  }

  async getFile() {
    return new File([this.bytes], this.name);
  }

  async createWritable() {
    return {
      write: async (value) => {
        const blob = value instanceof Blob ? value : new Blob([value]);
        this.bytes = new Uint8Array(await blob.arrayBuffer());
      },
      close: async () => undefined
    };
  }

  dump() {
    return new TextDecoder().decode(this.bytes);
  }
}

async function writeText(directory, name, value) {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(value);
  await writable.close();
}
