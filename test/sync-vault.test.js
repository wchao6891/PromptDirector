import test from "node:test";
import assert from "node:assert/strict";

import {
  createOrUnlockSyncVault,
  listSyncSnapshots,
  readSyncObject,
  writeSyncObject,
  writeSyncSnapshot
} from "../extension/sync-vault.js";
import { createRevisionSnapshot } from "../extension/sync-model.js";

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

test("a complete encrypted library above 32 MiB stays readable instead of being reported as corruption", async () => {
  const root = new MemoryDirectory("root");
  const vault = await createOrUnlockSyncVault(root, "password-123");
  const text = 'x'.repeat(33 * 1024 * 1024) + '完整正文末尾';
  const snapshot = await createRevisionSnapshot({ entries: [{ id: 'large-library', text }] }, { deviceId: 'device:a', logicalClock: 1 });
  await writeSyncSnapshot(vault, snapshot);
  const read = await listSyncSnapshots(vault);
  assert.equal(read.length, 1);
  assert.deepEqual(read[0], snapshot);
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

test('encrypted sync preserves legal empty package files and source MIME while rejecting empty ordinary media', async()=>{
  const root=new MemoryDirectory('root');const vault=await createOrUnlockSyncVault(root,'password-123');
  for (const [id,blob] of [
    ['skill-file:empty',new Blob([],{type:'application/octet-stream'})],
    ['skill-file:python',new Blob(['print(1)'],{type:'text/x-python'})],
    ['skill-file:binary',new Blob(['binary'],{type:'application/octet-stream'})]
  ]) {
    const objectId=await writeSyncObject(vault,blob,{assetId:id});
    const restored=await readSyncObject(vault,objectId,{assetId:id});
    assert.equal(await restored.text(),await blob.text());assert.equal(restored.type,blob.type);assert.equal(restored.size,blob.size);
    if(!blob.size)await assert.rejects(readSyncObject(vault,objectId,{assetId:'ordinary-image'}),/同步媒体无效/);
  }
  await assert.rejects(writeSyncObject(vault,new Blob([]),{assetId:'ordinary-image'}),/同步媒体无效/);
  await assert.rejects(writeSyncObject(vault,new Blob(['print(1)'],{type:'text/x-python'}),{assetId:'ordinary-image'}),/不是受支持/);
});

test('manual sync sends and restores current and historical empty Skill files without salvaging user work', async()=>{
  const {createManualSyncController}=await import('../extension/manual-sync.js');
  const {createCreativeSkill,saveCreativeSkillVersion,normalizeCreativeSkillsState,currentCreativeSkillVersion}=await import('../extension/creative-skills.js');
  const {validatePortableAssetRecord}=await import('../extension/media-store.js');
  const files=[{path:'scripts/__init__.py',assetId:'skill-file:empty',byteSize:0},
    {path:'scripts/tool.py',assetId:'skill-file:python',byteSize:8}];
  const created=createCreativeSkill({}, {callName:'可同步的方法',skillMarkdown:'# 原版',packageFiles:files});
  const skills=saveCreativeSkillVersion(created.state,created.skill.id,{skillMarkdown:'# 人工新版'}).state;
  const vault=await createOrUnlockSyncVault(new MemoryDirectory('roundtrip'),'password-123');
  function client(deviceId,creativeSkills={},blobs=new Map()) {
    let state={entries:[],creativeSkills,settings:{libraryTitle:'PromptDirector'}},meta={};
    const deleted=[];
    const controller=createManualSyncController({readState:async()=>structuredClone(state),readMeta:async()=>structuredClone(meta),
      readMedia:async id=>blobs.get(id),writeMedia:async(id,blob)=>{validatePortableAssetRecord(id,blob);blobs.set(id,blob);},
      deleteMedia:async id=>{deleted.push(id);blobs.delete(id);},commit:async next=>{if(!next.trackingOnly)state=structuredClone(next.state);meta=structuredClone(next.meta);}});
    return {run:()=>controller.start({vault,settings:{enabled:true,vaultId:vault.header.vaultId,deviceId}}),blobs,deleted,get state(){return state;}};
  }
  const source=client('sender',skills,new Map([['skill-file:empty',new Blob([],{type:'application/octet-stream'})],['skill-file:python',new Blob(['print(1)'],{type:'text/x-python'})]]));
  const uploaded=await source.run();assert.equal(uploaded.ok,true);assert.equal(uploaded.skippedMediaCount,0);assert.deepEqual(source.deleted,[]);
  const receiver=client('receiver');const restored=await receiver.run();assert.equal(restored.ok,true);assert.deepEqual(receiver.deleted,[]);
  for(const value of [source,receiver]) {
    const skill=normalizeCreativeSkillsState(value.state.creativeSkills).items[0];assert.equal(currentCreativeSkillVersion(skill).skillMarkdown,'# 人工新版');
    assert(skill.packageFiles.some(f=>f.path==='scripts/__init__.py'));assert(skill.versions.filter(v=>v.id!==skill.currentVersionId).every(v=>v.packageFiles.some(f=>f.path==='scripts/__init__.py')));
    assert.equal(skill.versions.find(v=>v.id!==skill.currentVersionId).skillMarkdown,'# 原版');
    assert.equal(value.blobs.get('skill-file:empty').size,0);assert.equal(await value.blobs.get('skill-file:python').text(),'print(1)');
    assert.equal(value.blobs.get('skill-file:python').type,'text/x-python');
  }
});
