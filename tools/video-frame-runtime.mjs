import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', import.meta.url);
const target = new URL('../extension/video-frame-runtime.js', import.meta.url);
const bytes = await readFile(source);
if (process.argv.includes('--check')) {
  if (!bytes.equals(await readFile(target))) throw new Error('视频帧运行时与锁定依赖不一致');
} else await writeFile(target, bytes);
process.stdout.write('视频帧运行时与锁定依赖一致\n');
