import { mkdir, readFile, writeFile, cp, chmod, rm, readdir, rename, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import { VIDEO_COMPONENT } from '../../extension/video-component-config.js';
import { extensionIdFromPublicKey } from '../release-identity.mjs';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const lock = JSON.parse(await readFile(new URL('./dependencies.json', import.meta.url), 'utf8'));
const target = process.argv.find(value => value.startsWith('--target='))?.slice(9) || (process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : '');
if (!['mac', 'win'].includes(target)) throw new Error('Build the installers on macOS or Windows.');
const output = resolve(process.env.VIDEO_BUILD_DIRECTORY || join(repo, 'dist/video-component'));
const cache = join(output, 'cache'), work = join(output, target), payload = join(work, 'payload');
await mkdir(cache, { recursive: true });
await mkdir(work, { recursive: true });
await rm(join(output, `${target}-build.json`), { force: true });
await rm(payload, { recursive: true, force: true }); await mkdir(payload);
const run = async (command, args, options = {}) => {
  console.log(`${basename(command)} ${args.slice(0, 3).join(' ')}`);
  try { return await exec(command, args, { maxBuffer: 32 * 1024 * 1024, ...options }); }
  catch (error) { console.error(error.stderr || error.stdout || error.message); throw error; }
};
async function artifact(name) {
  const item = lock.artifacts[name], path = join(cache, basename(new URL(item.url).pathname));
  let bytes;
  try { bytes = await readFile(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
    console.log(`Downloading ${name}`);
    const response = await fetch(item.url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Download failed: ${response.status} ${item.url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Build input checksum mismatch: ${name}`);
    await writeFile(path, bytes);
  }
  return path;
}
await mkdir(join(payload, 'connector')); await mkdir(join(payload, 'extension')); await mkdir(join(payload, 'bin')); await mkdir(join(payload, 'licenses'));
for (const name of ['video-host.mjs', 'register-video.mjs', 'video-service.mjs', 'video-tools.mjs', 'framing.mjs', 'is-main.mjs']) {
  await cp(join(repo, 'connector', name), join(payload, 'connector', name));
}
for (const name of ['agent-protocol.js', 'resource-policy.js', 'video-component-config.js']) await cp(join(repo, 'extension', name), join(payload, 'extension', name));
await writeFile(join(payload, 'package.json'), JSON.stringify({ type: 'module' }));
const extensionId = extensionIdFromPublicKey(JSON.parse(await readFile(join(repo, 'extension/manifest.json'), 'utf8')));
await writeFile(join(payload, 'component.json'), JSON.stringify({ version: VIDEO_COMPONENT.version, extensionId, dependencies: lock }, null, 2));
await cp(join(repo, 'LICENSE'), join(payload, 'licenses/PromptDirector.txt'));
// The exact FFmpeg source and build recipe accompany each offline installer.
const ffmpegArchive = await artifact('ffmpeg-source');
await cp(ffmpegArchive, join(payload, 'licenses', basename(ffmpegArchive)));
await cp(fileURLToPath(import.meta.url), join(payload, 'licenses/build.mjs'));
await cp(new URL('./dependencies.json', import.meta.url), join(payload, 'licenses/dependencies.json'));
await writeFile(join(payload, 'licenses/README.txt'), `PromptDirector video component ${VIDEO_COMPONENT.version}\nNode.js: https://nodejs.org/ (MIT and bundled licenses)\nyt-dlp: https://github.com/yt-dlp/yt-dlp/releases/tag/${lock.ytDlpVersion}\nStandalone yt-dlp contains GPLv3+ components; see its third-party notices and corresponding source at that release.\nFFmpeg ${lock.ffmpegVersion}: LGPL 2.1 or later, built without GPL/nonfree/external libraries. Exact source and build recipe included.\nThese programs run as separate processes. No libraries or creative materials are installed in the browser library.\n`);
for (const [name, url] of [
  ['yt-dlp-LICENSE.txt', `https://raw.githubusercontent.com/yt-dlp/yt-dlp/${lock.ytDlpVersion}/LICENSE`],
  ['yt-dlp-THIRD_PARTY_LICENSES.txt', `https://raw.githubusercontent.com/yt-dlp/yt-dlp/${lock.ytDlpVersion}/THIRD_PARTY_LICENSES.txt`],
  ['Node-LICENSE.txt', `https://raw.githubusercontent.com/nodejs/node/v${lock.nodeVersion}/LICENSE`]
]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`License download failed: ${url}`);
  await writeFile(join(payload, 'licenses', name), await response.text());
}
const sourceDirectory = join(work, `ffmpeg-${lock.ffmpegVersion}`);
try { await readFile(join(sourceDirectory, 'configure')); }
catch { await run('tar', ['-xf', ffmpegArchive, '-C', work]); }
await cp(join(sourceDirectory, 'COPYING.LGPLv2.1'), join(payload, 'licenses/FFmpeg-LGPL-2.1.txt'));
const buildRecipe = ['--disable-autodetect', '--disable-shared', '--enable-static', '--disable-doc', '--disable-debug', '--disable-ffplay', '--disable-avdevice', '--disable-encoders', '--disable-filters', '--disable-programs', '--enable-ffmpeg', '--enable-ffprobe', '--disable-x86asm'];
const ffmpegOutputs = [];
for (const arch of target === 'mac' ? ['arm64', 'x64'] : ['x64']) {
  const build = join(work, `ffmpeg-build-${arch}`); await mkdir(build, { recursive: true });
  const suffix = target === 'win' ? '.exe' : '';
  try { await readFile(join(build, `ffprobe${suffix}`)); }
  catch {
    if (target === 'mac') {
      const appleArch = arch === 'x64' ? 'x86_64' : 'arm64';
      await run(join(sourceDirectory, 'configure'), [...buildRecipe, '--enable-securetransport', '--enable-cross-compile', '--target-os=darwin', `--arch=${appleArch}`, `--cc=clang -arch ${appleArch}`, `--extra-cflags=-mmacosx-version-min=11.0`, `--extra-ldflags=-mmacosx-version-min=11.0`], { cwd: build });
      await run('make', [`-j${availableParallelism()}`], { cwd: build });
    } else if (process.platform !== 'win32') {
      await run(join(sourceDirectory, 'configure'), [...buildRecipe, '--enable-cross-compile', '--target-os=mingw32', '--arch=x86_64', '--cross-prefix=x86_64-w64-mingw32-', '--enable-schannel', '--extra-ldflags=-static'], { cwd: build });
      await run('make', [`-j${availableParallelism()}`], { cwd: build });
    } else {
      const bash = process.env.VIDEO_MSYS_BASH;
      if (!bash) throw new Error('VIDEO_MSYS_BASH must point to the MSYS2 bash executable for the Windows build.');
      const posix = value => value.replaceAll('\\', '/').replace(/^([a-z]):/iu, (_, drive) => `/${drive.toLowerCase()}`);
      const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
      const script = `set -eu\nexport PATH=${quote(process.env.VIDEO_MSYS_PREFIX || '/ucrt64')}/bin:/usr/bin:$PATH\ncd ${quote(posix(build))}\n${quote(posix(join(sourceDirectory, 'configure')))} ${buildRecipe.join(' ')} --target-os=mingw32 --arch=x86_64 --enable-schannel --extra-ldflags=-static\nmake -j${availableParallelism()}\n`;
      const scriptPath = join(work, 'build-ffmpeg.sh'); await writeFile(scriptPath, script);
      await run(bash, ['-l', posix(scriptPath)]);
    }
  }
  ffmpegOutputs.push(build);
}
for (const name of ['ffmpeg', 'ffprobe']) {
  const destination = join(payload, 'bin', name + (target === 'win' ? '.exe' : ''));
  if (target === 'mac') await run('lipo', ['-create', ...ffmpegOutputs.map(dir => join(dir, name)), '-output', destination]);
  else await cp(join(ffmpegOutputs[0], `${name}.exe`), destination);
}
const yt = await artifact(`yt-${target}`);
// Official directory builds avoid extracting a Python runtime on every status
// check and video job. All dependencies remain adjacent to the executable.
if (process.platform === 'win32') await run('tar', ['-xf', yt, '-C', join(payload, 'bin')]);
else await run('unzip', ['-q', yt, '-d', join(payload, 'bin')]);
if (target === 'mac') await rename(join(payload, 'bin/yt-dlp_macos'), join(payload, 'bin/yt-dlp'));
if (target === 'mac') {
  const nodes = [];
  for (const arch of ['arm64', 'x64']) {
    const archive = await artifact(`node-mac-${arch}`);
    await run('tar', ['-xf', archive, '-C', work]); nodes.push(join(work, `node-v${lock.nodeVersion}-darwin-${arch}/bin/node`));
  }
  await run('lipo', ['-create', ...nodes, '-output', join(payload, 'bin/node')]);
  for (const file of ['node', 'ffmpeg', 'ffprobe', 'yt-dlp']) await chmod(join(payload, 'bin', file), 0o755);
  const identity = process.env.VIDEO_MAC_APPLICATION_IDENTITY;
  async function signNested(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await signNested(path); continue; }
      if (!entry.isFile()) continue;
      const file = await open(path); const magic = Buffer.alloc(4);
      try { await file.read(magic, 0, 4, 0); } finally { await file.close(); }
      if (['cffaedfe', 'feedfacf', 'cafebabe', 'bebafeca', 'cafebabf'].includes(magic.toString('hex'))) {
        await run('codesign', ['--force', '--sign', identity || '-', ...(identity ? ['--timestamp', '--options', 'runtime'] : []), path]);
      }
    }
  }
  if (identity) await signNested(join(payload, 'bin/_internal'));
  for (const file of ['node', 'ffmpeg', 'ffprobe', 'yt-dlp']) {
    const entitlements = file === 'node' ? 'node-entitlements.plist' : file === 'yt-dlp' ? 'python-entitlements.plist' : '';
    await run('codesign', ['--force', '--sign', identity || '-', ...(identity ? ['--timestamp', '--options', 'runtime', ...(entitlements ? ['--entitlements', join(repo, 'connector/installer', entitlements)] : [])] : []), join(payload, 'bin', file)]);
    await run('codesign', ['--verify', '--strict', join(payload, 'bin', file)]);
  }
  const installLocation = '/Library/Application Support/PromptDirector/VideoComponent';
  await writeFile(join(payload, 'native-host'), `#!/bin/sh\nexec '${installLocation}/bin/node' '${installLocation}/connector/video-host.mjs' "$@"\n`, { mode: 0o755 });
  const tree = join(work, 'package-root'); await rm(tree, { recursive: true, force: true });
  const location = join(tree, installLocation.slice(1)); await mkdir(dirname(location), { recursive: true }); await cp(payload, location, { recursive: true });
  const registration = join(tree, 'Library/Google/Chrome/NativeMessagingHosts'); await mkdir(registration, { recursive: true });
  await writeFile(join(registration, `${VIDEO_COMPONENT.host}.json`), JSON.stringify({ name: VIDEO_COMPONENT.host, description: 'PromptDirector video component', path: `${installLocation}/native-host`, type: 'stdio', allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2));
  const componentPkg = join(work, 'component.pkg');
  await run('pkgbuild', ['--root', tree, '--identifier', VIDEO_COMPONENT.host, '--version', VIDEO_COMPONENT.version, '--install-location', '/', '--ownership', 'recommended', componentPkg]);
  const distribution = join(work, 'distribution.xml');
  await writeFile(distribution, `<?xml version="1.0"?><installer-gui-script minSpecVersion="2"><title>PromptDirector Video</title><options customize="never"/><domains enable_localSystem="true" enable_currentUserHome="false"/><allowed-os-versions><os-version min="11.0"/></allowed-os-versions><choices-outline><line choice="video"/></choices-outline><choice id="video" visible="false"><pkg-ref id="${VIDEO_COMPONENT.host}"/></choice><pkg-ref id="${VIDEO_COMPONENT.host}" version="${VIDEO_COMPONENT.version}">component.pkg</pkg-ref></installer-gui-script>`);
  const installer = join(output, VIDEO_COMPONENT.assets.mac);
  const signing = process.env.VIDEO_MAC_INSTALLER_IDENTITY;
  await run('productbuild', ['--distribution', distribution, '--package-path', work, ...(signing ? ['--sign', signing] : []), installer]);
  if (process.env.VIDEO_MAC_NOTARY_PROFILE) {
    await run('xcrun', ['notarytool', 'submit', installer, '--keychain-profile', process.env.VIDEO_MAC_NOTARY_PROFILE, '--wait']);
    await run('xcrun', ['stapler', 'staple', installer]);
    await run('pkgutil', ['--check-signature', installer]);
    await run('spctl', ['--assess', '--type', 'install', installer]);
  }
  await writeFile(join(output, 'mac-build.json'), JSON.stringify({ version: VIDEO_COMPONENT.version, distributionReady: Boolean(identity && signing && process.env.VIDEO_MAC_NOTARY_PROFILE), installer: basename(installer), sha256: createHash('sha256').update(await readFile(installer)).digest('hex'), source: lock }, null, 2));
} else {
  await cp(await artifact('node-win-x64'), join(payload, 'bin/node.exe'));
  const launcher = `@echo off\r\nsetlocal DisableDelayedExpansion\r\n"%~dp0bin\\node.exe" "%~dp0connector\\video-host.mjs" %*\r\n`;
  await writeFile(join(payload, 'native-host.cmd'), launcher);
  const prefix = process.platform === 'win32' ? '/' : '-';
  await run(process.env.VIDEO_MAKENSIS || 'makensis', [`${prefix}INPUTCHARSET`, 'UTF8', `${prefix}DPayloadFiles=${join(payload, '*')}`, `${prefix}DOutput=${output}`, `${prefix}DComponentVersion=${VIDEO_COMPONENT.version}`, join(repo, 'connector/installer/windows.nsi')]);
  const installer = join(output, VIDEO_COMPONENT.assets.win);
  let distributionReady = false;
  if (process.env.VIDEO_WINDOWS_CERTIFICATE_SHA1) {
    if (process.platform !== 'win32' || !process.env.VIDEO_WINDOWS_TIMESTAMP_URL) throw new Error('Windows signing requires a Windows certificate store and VIDEO_WINDOWS_TIMESTAMP_URL.');
    const tool = process.env.VIDEO_SIGNTOOL || 'signtool';
    await run(tool, ['sign', '/sha1', process.env.VIDEO_WINDOWS_CERTIFICATE_SHA1, '/fd', 'SHA256', '/tr', process.env.VIDEO_WINDOWS_TIMESTAMP_URL, '/td', 'SHA256', installer]);
    await run(tool, ['verify', '/pa', '/all', installer]); distributionReady = true;
  }
  await writeFile(join(output, 'win-build.json'), JSON.stringify({ version: VIDEO_COMPONENT.version, distributionReady, installer: basename(installer), sha256: createHash('sha256').update(await readFile(installer)).digest('hex'), source: lock }, null, 2));
}
console.log(`Built ${target} video component in ${output}`);
