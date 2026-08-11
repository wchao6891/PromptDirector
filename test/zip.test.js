import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { createZipBlob, readZipBlob } from "../zip.js";

test("createZipBlob produces a UTF-8 ZIP containing markdown and image paths", async () => {
  const archive = await createZipBlob([
    { name: "优秀提示词案例.md", data: "# 案例库\n" },
    { name: "library.json", data: '{"format":"prompt-case-library"}\n' },
    {
      name: "images/case-1.webp",
      data: new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" })
    }
  ]);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const decoded = new TextDecoder().decode(bytes);

  assert.equal(archive.type, "application/zip");
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [80, 75, 3, 4]);
  assert.ok(decoded.includes("优秀提示词案例.md"));
  assert.ok(decoded.includes("library.json"));
  assert.ok(decoded.includes("images/case-1.webp"));
  assert.deepEqual(Array.from(bytes.slice(-22, -18)), [80, 75, 5, 6]);
});

test("readZipBlob restores every file written by the local ZIP exporter", async () => {
  const archive = await createZipBlob([
    { name: "library.json", data: '{"format":"prompt-case-library"}\n' },
    { name: "images/case-1.webp", data: new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" }) }
  ]);

  const files = await readZipBlob(archive);

  assert.deepEqual([...files.keys()], ["library.json", "images/case-1.webp"]);
  assert.equal(await files.get("library.json").text(), '{"format":"prompt-case-library"}\n');
  assert.deepEqual(
    [...new Uint8Array(await files.get("images/case-1.webp").arrayBuffer())],
    [82, 73, 70, 70]
  );
});

test("readZipBlob restores MP4 assets with their video MIME type", async () => {
  const archive = await createZipBlob([
    { name: "library.json", data: "{}" },
    { name: "videos/case-1.mp4", data: new Blob([new Uint8Array([0, 0, 0, 20])], { type: "video/mp4" }) }
  ]);

  const files = await readZipBlob(archive);

  assert.equal(files.get("videos/case-1.mp4").type, "video/mp4");
});

test("readZipBlob rejects unsupported or damaged archives", async () => {
  await assert.rejects(() => readZipBlob(new Blob(["not a zip"])), /不是有效的 ZIP/);
  const archive = await createZipBlob([{ name: "library.json", data: "valid" }]);
  const bytes = new Uint8Array(await archive.arrayBuffer());
  bytes[bytes.indexOf("v".charCodeAt(0))] = "x".charCodeAt(0);
  await assert.rejects(() => readZipBlob(new Blob([bytes])), /文件已损坏/);
});

test("readZipBlob rejects archives and file counts above the configured safety envelope", async () => {
  const archive = await createZipBlob([
    { name: "library.json", data: "{}" },
    { name: "images/one.webp", data: "image" }
  ]);
  await assert.rejects(
    () => readZipBlob(archive, { maxArchiveBytes: archive.size - 1, maxFileCount: 10, maxFileBytes: 100 }),
    /ZIP 超过.*上限/
  );
  await assert.rejects(
    () => readZipBlob(archive, { maxArchiveBytes: archive.size, maxFileCount: 1, maxFileBytes: 100 }),
    /文件数量超过.*上限/
  );
  await assert.rejects(
    () => readZipBlob(archive, { maxArchiveBytes: archive.size, maxFileCount: 10, maxFileBytes: 4 }),
    /单个文件超过.*上限/
  );
});

test("readZipBlob stops deflate expansion as soon as it exceeds the declared file size", async () => {
  const expanded = new Uint8Array(1024 * 1024).fill("A".charCodeAt(0));
  const archive = deflatedZipWithDeclaredSize({
    name: "library.json",
    data: expanded,
    declaredSize: 4
  });

  await assert.rejects(
    () => readZipBlob(archive, {
      maxArchiveBytes: 2 * 1024 * 1024,
      maxFileCount: 1,
      maxFileBytes: 2 * 1024 * 1024
    }),
    /解压内容超过声明大小：library\.json/
  );
});

function deflatedZipWithDeclaredSize({ name, data, declaredSize }) {
  const nameBytes = new TextEncoder().encode(name);
  const compressed = new Uint8Array(deflateRawSync(data));
  const local = new Uint8Array(30);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint16(6, 0x0800, true);
  localView.setUint16(8, 8, true);
  localView.setUint32(18, compressed.byteLength, true);
  localView.setUint32(22, declaredSize, true);
  localView.setUint16(26, nameBytes.byteLength, true);

  const centralOffset = local.byteLength + nameBytes.byteLength + compressed.byteLength;
  const central = new Uint8Array(46);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint16(8, 0x0800, true);
  centralView.setUint16(10, 8, true);
  centralView.setUint32(20, compressed.byteLength, true);
  centralView.setUint32(24, declaredSize, true);
  centralView.setUint16(28, nameBytes.byteLength, true);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, central.byteLength + nameBytes.byteLength, true);
  endView.setUint32(16, centralOffset, true);

  return new Blob([local, nameBytes, compressed, central, nameBytes, end], { type: "application/zip" });
}
