import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export async function discoverVideoTools({ env = process.env, executable = process.execPath, root } = {}) {
  let configured = {};
  try { if (root) configured = JSON.parse(await readFile(join(root, 'video-tools.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const directories = [...new Set([dirname(executable), ...(env.PATH || '').split(delimiter)].filter(isAbsolute))];
  const find = async (name, override) => {
    const suffixes = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    const candidates = override ? [override] : directories.flatMap(directory => suffixes.map(suffix => join(directory, name + suffix)));
    for (const candidate of candidates) {
      if (!isAbsolute(candidate)) continue;
      try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try the next installed executable. */ }
    }
    return '';
  };
  const ytDlp = await find('yt-dlp', env.PROMPTDIRECTOR_YTDLP || configured.ytDlp);
  const ffmpeg = await find('ffmpeg', env.PROMPTDIRECTOR_FFMPEG || configured.ffmpeg);
  const ffprobe = await find('ffprobe', env.PROMPTDIRECTOR_FFPROBE || configured.ffprobe || (ffmpeg ? join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : ''));
  const deno = await find('deno', env.PROMPTDIRECTOR_DENO || configured.deno);
  return { ytDlp, ffmpeg, ffprobe, deno };
}

export async function videoToolsStatus(tools) {
  const versions = {};
  for (const [name, path] of Object.entries(tools)) {
    if (!path) continue;
    try { versions[name] = (await exec(path, name === 'ytDlp' ? ['--ignore-config', '--version'] : [name === 'deno' ? '--version' : '-version'], { timeout: 10_000, windowsHide: true })).stdout.split('\n')[0]; }
    catch (error) {
      if (process.env.PROMPTDIRECTOR_DEBUG) console.error(`[video-tools] ${name}: ${error.stderr || error.message}`);
    }
  }
  return { available: Boolean(versions.ytDlp && versions.ffmpeg && versions.ffprobe), versions,
    missing: ['ytDlp', 'ffmpeg', 'ffprobe'].filter(name => !versions[name]) };
}
