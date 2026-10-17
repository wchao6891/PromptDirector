import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFrame, frameDecoder } from './framing.mjs';
import { createVideoService } from './video-service.mjs';
import { isMain } from './is-main.mjs';

// The packaged video host exposes only video operations. It does not create an
// Agent endpoint, pairing record, library configuration or persistent service.
export async function startVideoHost({ origin, directory = dirname(dirname(fileURLToPath(import.meta.url))),
  input = process.stdin, output = process.stdout, serviceFactory = createVideoService } = {}) {
  const config = JSON.parse(await readFile(join(directory, 'component.json'), 'utf8'));
  const trace = message => { if (process.env.PROMPTDIRECTOR_DEBUG) console.error(`[video-host] ${message}`); };
  trace('start');
  if (origin !== `chrome-extension://${config.extensionId}/`) throw new Error('Video component extension identity mismatch.');
  const bin = join(directory, 'bin');
  const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
  const service = serviceFactory({ resolveTools: async () => ({ ytDlp: executable('yt-dlp'), ffmpeg: executable('ffmpeg'), ffprobe: executable('ffprobe'), deno: '' }),
    sendProgress: (id, progress) => send({ type: 'video_progress', id, progress }) });
  let ready = false, closed = false;
  function send(message) { if (!closed) { trace(`send ${message.type}`); output.write(encodeFrame(message)); } }
  async function close() { if (closed) return; closed = true; await service.close(); }
  const decode = frameDecoder(message => {
    trace(`receive ${message?.type}`);
    if (!ready) {
      if (message?.type !== 'video_hello' || message.protocolVersion !== 1 || message.extensionId !== config.extensionId) throw new Error('Invalid video handshake.');
      ready = true; send({ type: 'video_ready', protocolVersion: 1, componentVersion: config.version }); return;
    }
    if (message?.type !== 'video_request' || typeof message.id !== 'string') throw new Error('Invalid video request.');
    void service.request(message.operation, message.input, message.id).then(result => {
      send({ type: 'video_response', id: message.id, result: message.operation === 'status' ? { ...result, componentVersion: config.version } : result });
    }, error => send({ type: 'video_response', id: message.id, error: { message: error.message, code: error.code } }));
  });
  input.on('data', data => { try { decode(data); } catch (error) { console.error(error.message); void close().finally(() => input.destroy()); } });
  input.on('end', () => void close()); input.on('error', () => void close());
  return { close };
}

if (isMain(import.meta.url)) {
  startVideoHost({ origin: process.argv[2] }).then(host => {
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => void host.close().finally(() => process.exit(0)));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
