import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { encodeFrame, frameDecoder } from '../../connector/framing.mjs';

const directory = resolve(process.argv[2]);
const config = JSON.parse(await readFile(join(directory, 'component.json'), 'utf8'));
// Exercise the installed Chrome entrypoint, not just its underlying Node script.
const origin = `chrome-extension://${config.extensionId}/`;
const launcher = join(directory, process.platform === 'win32' ? 'native-host.cmd' : 'native-host');
const command = process.platform === 'win32' ? process.env.ComSpec : launcher;
const args = process.platform === 'win32' ? ['/d', '/s', '/c', `""${launcher}" ${origin}"`] : [origin];
const child = spawn(command, args, { env: { ...process.env, PATH: '' }, windowsVerbatimArguments: process.platform === 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
child.stderr.on('data', bytes => { stderr += bytes; });
await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { child.kill(); reject(new Error('Packaged component did not respond.')); }, 60_000);
  child.on('error', reject);
  child.on('close', code => { clearTimeout(timeout); reject(new Error(`Packaged component exited: ${code} ${stderr}`)); });
  child.stdout.on('data', frameDecoder(message => {
    if (message.type === 'video_ready') child.stdin.write(encodeFrame({ type: 'video_request', id: 'status', operation: 'status', input: {} }));
    if (message.id === 'status') {
      clearTimeout(timeout); child.stdin.end();
      if (!message.result?.available) reject(new Error(JSON.stringify(message)));
      else { console.log(JSON.stringify(message.result)); resolve(); }
    }
  }));
  child.stdin.write(encodeFrame({ type: 'video_hello', protocolVersion: 1, extensionId: config.extensionId }));
});
