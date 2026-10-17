import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { VIDEO_COMPONENT } from '../../extension/video-component-config.js';
import { createHash } from 'node:crypto';

const directory = resolve(process.argv[2] || 'dist/video-component');
for (const platform of ['mac', 'win']) {
  const report = JSON.parse(await readFile(join(directory, `${platform}-build.json`), 'utf8'));
  if (report.version !== VIDEO_COMPONENT.version || report.distributionReady !== true) {
    throw new Error(`${platform}: a signed, verified installer is required before publication.`);
  }
  const bytes = await readFile(join(directory, VIDEO_COMPONENT.assets[platform]));
  if (createHash('sha256').update(bytes).digest('hex') !== report.sha256) throw new Error(`${platform}: installer differs from its signed build report.`);
}
console.log('Both signed video installers are ready for publication.');
