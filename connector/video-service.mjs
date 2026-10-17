import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat, statfs, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AGENT_CHUNK_BYTES } from '../extension/agent-protocol.js';
import { operationBudget } from '../extension/resource-policy.js';
import { discoverVideoTools, videoToolsStatus } from './video-tools.mjs';
import { videoComponentRequired } from '../extension/video-component-config.js';

export function canonicalVideoUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('视频解析只接受 HTTPS 作品地址');
  const host = url.hostname.replace(/^www\./u, '');
  if (host === 'douyin.com') {
    const id = url.searchParams.get('modal_id') || url.pathname.match(/^\/video\/(\d+)\/?$/u)?.[1];
    if (/^\d+$/u.test(id || '')) return `https://www.douyin.com/video/${id}`;
  }
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live)\/([^/]+)\/?$/u)?.[1];
    if (/^[\w-]+$/u.test(id || '')) return `https://www.youtube.com/watch?v=${id}`;
  }
  if (host === 'bilibili.com') {
    const id = url.pathname.match(/^\/video\/(BV\w+|av\d+)\/?$/u)?.[1];
    if (id) return `https://www.bilibili.com/video/${id}/${Number(url.searchParams.get('p')) > 1 ? `?p=${Number(url.searchParams.get('p'))}` : ''}`;
  }
  throw new Error('本机视频解析仅支持抖音、YouTube 和 Bilibili 的单个作品');
}

// Only scoped streams from the platform's own CDN can be handed to FFmpeg.
export function validateVideoStreams(streams, workUrl) {
  if (!streams) return null;
  const host = new URL(workUrl).hostname;
  const suffixes = host.endsWith('bilibili.com') ? ['bilivideo.com', 'bilivideo.cn'] : host.endsWith('douyin.com') ? ['douyinvod.com'] : ['googlevideo.com'];
  const urls = [streams.videoUrl, streams.audioUrl].filter(Boolean).map(value => {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !suffixes.some(suffix => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) throw new Error('视频流与所选平台不匹配');
    return url.href;
  });
  if (!urls.length || !streams.videoUrl) throw new Error('缺少视频流');
  return { videoUrl: urls[0], ...(streams.audioUrl ? { audioUrl: urls[1] } : {}) };
}

const safeFailure = value => String(value).replace(/https?:\/\/\S+/gu, '[媒体地址]').trim();

export function createVideoService({ root, resolveTools = discoverVideoTools, spawnImpl = spawn, sendProgress = () => {} } = {}) {
  const records = new Map();
  const jobs = new Map();
  const cancelled = new Set();
  let closed = false;
  let toolsPromise;
  const run = (path, args, job, onLine) => new Promise((resolve, reject) => {
    job.controller.signal.throwIfAborted();
    const child = spawnImpl(path, args, { windowsHide: true, signal: job.controller.signal, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const pendingLines = { stdout: '', stderr: '' };
    const lines = (name, bytes) => {
      pendingLines[name] += bytes.toString();
      const values = pendingLines[name].split(/[\r\n]+/u); pendingLines[name] = values.pop();
      for (const value of values) onLine?.(value);
    };
    const diagnosticBudget = Math.floor(1024 * 1024 / 8); // Fits well inside one Native Messaging response.
    child.stdout.on('data', bytes => {
      lines('stdout', bytes);
      stdout = (stdout + bytes).slice(-diagnosticBudget);
    });
    child.stderr.on('data', bytes => { lines('stderr', bytes); stderr = (stderr + bytes).slice(-diagnosticBudget); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(safeFailure(stderr) || '视频解析进程未完成')));
  });
  async function release(token) {
    const record = records.get(token);
    if (!record) return false;
    records.delete(token);
    await rm(record.directory, { recursive: true, force: true });
    return true;
  }
  return {
    async request(operation, input = {}, id = randomUUID()) {
      if (closed) throw new Error('本机视频会话已关闭');
      if (operation === 'release') return { released: await release(input.token) };
      if (operation === 'cancel') { cancelled.add(input.requestId); jobs.get(input.requestId)?.controller.abort(); return { cancelled: true }; }
      if (operation === 'read') {
        const record = records.get(input.token);
        if (!record || !Number.isSafeInteger(input.index) || input.index < 0 || input.index * AGENT_CHUNK_BYTES >= record.size) throw new Error('视频暂存分块不存在');
        const file = await open(record.path, 'r');
        try {
          const buffer = Buffer.alloc(Math.min(AGENT_CHUNK_BYTES, record.size - input.index * AGENT_CHUNK_BYTES));
          const { bytesRead } = await file.read(buffer, 0, buffer.length, input.index * AGENT_CHUNK_BYTES);
          return { data: buffer.subarray(0, bytesRead).toString('base64') };
        } finally { await file.close(); }
      }
      const tools = await (toolsPromise ??= resolveTools({ root }));
      if (closed || cancelled.has(id)) throw new Error('视频解析已取消');
      if (operation === 'status') return videoToolsStatus(tools);
      if (operation !== 'download') throw new Error('不支持的视频解析操作');
      const url = canonicalVideoUrl(input.url);
      const streams = validateVideoStreams(input.streams, url);
      if (!tools.ytDlp || !tools.ffmpeg || !tools.ffprobe) throw videoComponentRequired('视频组件未完整安装，请重新安装');
      if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) throw new Error('没有可用的视频暂存空间');
      const disk = await statfs(tmpdir());
      if (closed || cancelled.has(id)) throw new Error('视频解析已取消');
      // Merge temporarily holds the downloaded tracks and the combined file.
      const maxBytes = Math.min(input.maxBytes, Math.floor(disk.bavail * disk.bsize / 2));
      if (maxBytes <= 0) throw new Error('本机没有足够的视频暂存空间');
      const controller = new AbortController();
      const job = { controller, directory: '' };
      jobs.set(id, job);
      const timer = setTimeout(() => controller.abort(new Error('视频解析超出本次时间预算')), operationBudget(input.budget).maxDurationMs);
      try {
        job.directory = await mkdtemp(join(tmpdir(), 'promptdirector-video-'));
        controller.signal.throwIfAborted();
        sendProgress(id, { phase: 'resolve' });
        if (streams) {
          const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-xerror', '-protocol_whitelist', 'https,http,tcp,tls', '-referer', url, '-i', streams.videoUrl];
          if (streams.audioUrl) args.push('-protocol_whitelist', 'https,http,tcp,tls', '-referer', url, '-i', streams.audioUrl, '-map', '0:v:0', '-map', '1:a:0');
          else args.push('-map', '0:v:0', '-map', '0:a?');
          args.push('-c', 'copy', '-progress', 'pipe:1', '-nostats', '-y', join(job.directory, 'original.mp4'));
          sendProgress(id, { phase: 'download' });
          await run(tools.ffmpeg, args, job, line => {
            const match = /^total_size=(\d+)$/u.exec(line);
            if (match) { const bytes = Number(match[1]); if (bytes > maxBytes) controller.abort(new Error('视频超出本机可用暂存空间')); sendProgress(id, { phase: 'download', receivedBytes: bytes }); }
          });
        } else {
          const args = ['--ignore-config', '--no-playlist', '--no-warnings', '--no-colors', '--newline', '--progress', '--no-simulate', '--abort-on-unavailable-fragments',
            '--format', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4/mkv', '--ffmpeg-location', dirname(tools.ffmpeg),
            '--max-filesize', String(maxBytes), '--write-info-json', '--output', join(job.directory, 'original.%(ext)s'),
            '--progress-template', 'download:PD_PROGRESS:%(progress.downloaded_bytes)s:%(progress.total_bytes)s:%(progress.total_bytes_estimate)s',
            '--print', 'after_move:PD_FILE:%(filepath)j'];
          if (tools.deno) args.push('--js-runtimes', `deno:${tools.deno}`);
          else args.push('--js-runtimes', `node:${process.execPath}`);
          args.push('--', url);
          await run(tools.ytDlp, args, job, line => {
            const match = /^PD_PROGRESS:(\d+):([^:]+):/u.exec(line);
            if (match) sendProgress(id, { phase: 'download', receivedBytes: Number(match[1]),
              ...(Number(match[2]) > 0 ? { totalBytes: Number(match[2]) } : {}) });
            else if (/\[Merger\]/u.test(line)) sendProgress(id, { phase: 'merge' });
          });
        }
        const files = await readdir(job.directory);
        const name = files.find(name => /^original\.(mp4|mkv|webm|mov)$/u.test(name));
        if (!name) throw new Error('平台没有返回可保存的完整视频');
        const path = join(job.directory, name);
        const info = await stat(path);
        if (!info.size || info.size > maxBytes) throw new Error('视频为空或超出本机可用暂存空间');
        sendProgress(id, { phase: 'verify' });
        const metadata = JSON.parse(await run(tools.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', path], job));
        const video = metadata.streams?.find(stream => stream.codec_type === 'video');
        if (!video || !(Number(metadata.format?.duration) > 0)) throw new Error('解析结果没有完整视频轨或有效时长');
        if (streams?.audioUrl && !metadata.streams.some(stream => stream.codec_type === 'audio')) throw new Error('音视频合并结果缺少音轨');
        const token = randomUUID();
        records.set(token, { directory: job.directory, path, size: info.size });
        return { token, byteSize: info.size, chunkCount: Math.ceil(info.size / AGENT_CHUNK_BYTES),
          mimeType: name.endsWith('.webm') ? 'video/webm' : name.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4',
          width: video.width, height: video.height, durationMs: Math.round(Number(metadata.format.duration) * 1000),
          hasAudio: metadata.streams.some(stream => stream.codec_type === 'audio'), sourceUrl: url };
      } catch (error) {
        if (job.directory) await rm(job.directory, { recursive: true, force: true });
        throw error;
      } finally { clearTimeout(timer); jobs.delete(id); cancelled.delete(id); }
    },
    async close() {
      closed = true;
      for (const job of jobs.values()) job.controller.abort();
      await Promise.all([...records.keys()].map(release));
    }
  };
}
