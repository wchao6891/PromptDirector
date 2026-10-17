import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isMain } from './is-main.mjs';

export async function registerPackagedVideo(directory = dirname(dirname(fileURLToPath(import.meta.url)))) {
  const config = JSON.parse(await readFile(join(directory, 'component.json'), 'utf8'));
  if (!/^[a-p]{32}$/u.test(config.extensionId)) throw new Error('Invalid extension identity.');
  const exec = promisify(execFile);
  for (const [name, args] of [['yt-dlp', ['--ignore-config', '--version']], ['ffmpeg', ['-version']], ['ffprobe', ['-version']]]) {
    await exec(join(directory, 'bin', name + (process.platform === 'win32' ? '.exe' : '')), args, { windowsHide: true, timeout: 30_000 });
  }
  const manifest = { name: 'com.promptdirector.video', description: 'PromptDirector video component',
    path: join(directory, process.platform === 'win32' ? 'native-host.cmd' : 'native-host'), type: 'stdio',
    allowed_origins: [`chrome-extension://${config.extensionId}/`] };
  await writeFile(join(directory, 'native-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}
if (isMain(import.meta.url)) registerPackagedVideo().catch(error => { console.error(error.message); process.exitCode = 1; });
