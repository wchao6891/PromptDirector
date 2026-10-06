import test from "node:test";
import assert from "node:assert/strict";

import { readImageDimensions } from "../extension/image-metadata.js";

test("image dimensions are read from headers before browser decoding", async () => {
  const png = new Uint8Array(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  png.set([73, 72, 68, 82], 12);
  const view = new DataView(png.buffer);
  view.setUint32(16, 9000, false);
  view.setUint32(20, 5000, false);
  assert.deepEqual(
    await readImageDimensions(new Blob([png], { type: "image/png" })),
    { width: 9000, height: 5000 }
  );
  await assert.rejects(
    () => readImageDimensions(new Blob(["not an image"], { type: "image/png" })),
    /无法读取图片尺寸/
  );
});

test('animation previews use container declarations without decoding or reading all frames', async () => {
  const { imageNeedsOriginalPlayback } = await import('../extension/image-metadata.js');
  const webp = new Uint8Array(30);
  webp.set(new TextEncoder().encode('RIFF'),0); webp.set(new TextEncoder().encode('WEBPVP8X'),8);
  assert.equal(await imageNeedsOriginalPlayback(new Blob([webp],{type:'image/webp'})),false);
  webp[20]=2;
  let bytesRead=0;
  const animated=new Blob([webp,new Uint8Array(1024*1024)],{type:'image/webp'});
  const slice=animated.slice.bind(animated);
  animated.slice=(start,end)=>{bytesRead+=end-start;return slice(start,end);};
  assert.equal(await imageNeedsOriginalPlayback(animated),true);
  assert.equal(bytesRead,32,'do not scan every frame to show an animation');
  const png=new Uint8Array(53);png.set([137,80,78,71,13,10,26,10]);
  new DataView(png.buffer).setUint32(8,13);png.set(new TextEncoder().encode('IHDR'),12);
  new DataView(png.buffer).setUint32(33,8);png.set(new TextEncoder().encode('acTL'),37);
  assert.equal(await imageNeedsOriginalPlayback(new Blob([png],{type:'image/png'})),true);
  png.set(new TextEncoder().encode('IDAT'),37);
  assert.equal(await imageNeedsOriginalPlayback(new Blob([png],{type:'image/png'})),false);
  const avif=new Uint8Array(24);new DataView(avif.buffer).setUint32(0,24);avif.set(new TextEncoder().encode('ftypavis'),4);
  assert.equal(await imageNeedsOriginalPlayback(new Blob([avif],{type:'image/avif'})),true);
  avif.set(new TextEncoder().encode('avif'),8);
  assert.equal(await imageNeedsOriginalPlayback(new Blob([avif],{type:'image/avif'})),false);
  assert.equal(await imageNeedsOriginalPlayback(new Blob(['GIF89a'],{type:'image/gif'})),true);
  assert.equal(await imageNeedsOriginalPlayback(new Blob(['JPEG'],{type:'image/jpeg'})),false);
});
