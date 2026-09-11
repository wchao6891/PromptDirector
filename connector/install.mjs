import { isMain } from "./is-main.mjs";
import { mkdir, writeFile, readFile, readdir, cp, rename, lstat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectorRoot, ensurePrivateRoot, instancePaths, readJson } from './paths.mjs';
const source = dirname(fileURLToPath(import.meta.url));
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
export async function installationPlan({ root = connectorRoot(), nativeDirectory = join(homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts'), extensionId } = {}) {
  if (!extensionId) {
    const manifest = await readJson(resolve(source, '../extension/manifest.json'));
    extensionId = [...createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16)]
      .map(byte => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15))).join('');
  }
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('无效的 Chrome 扩展编号。');
  return { root: resolve(root), nativeDirectory: resolve(nativeDirectory), extensionId,
    runtime: join(resolve(root), 'runtime'), launcher: join(resolve(root), 'native-host'),
    registration: join(resolve(nativeDirectory), 'com.promptdirector.connector.json'), node: process.execPath };
}
async function atomicWrite(path, text, mode = 0o600) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, text, { mode, flag: 'wx' }); await rename(temp, path);
}
export async function install(plan) {
  await ensurePrivateRoot(plan.root);
  // A stable private runtime survives moving the development checkout. Copy
  // dependencies without install scripts; the lockfile identifies their source.
  await mkdir(plan.runtime, { recursive: true, mode: 0o700 });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.name.endsWith('.mjs') || ['node_modules', 'package.json', 'package-lock.json', 'SKILL.md'].includes(entry.name)) {
      await cp(join(source, entry.name), join(plan.runtime, entry.name), { recursive: true, dereference: true });
    }
  }
  await atomicWrite(join(plan.root, 'config.json'), JSON.stringify({ extensionId: plan.extensionId }));
  await atomicWrite(plan.launcher, `#!/bin/sh\nexport PROMPTDIRECTOR_CONNECTOR_HOME=${shellQuote(plan.root)}\nexec ${shellQuote(plan.node)} ${shellQuote(join(plan.runtime, 'native-host.mjs'))} "$@"\n`, 0o700);
  await mkdir(plan.nativeDirectory, { recursive: true });
  await atomicWrite(plan.registration, JSON.stringify({ name: 'com.promptdirector.connector', description: 'PromptDirector local Agent connector',
    path: plan.launcher, type: 'stdio', allowed_origins: [`chrome-extension://${plan.extensionId}/`] }, null, 2));
  return { ...plan, next: '在插件设置启用 Agent 连接，再用配对编号运行 pair。' };
}
export async function pair(instanceId, root = connectorRoot()) {
  await ensurePrivateRoot(root);
  const { record } = instancePaths(root, instanceId);
  const value = await readJson(record);
  if (value.instanceId !== instanceId || !/^[a-f0-9]{64}$/.test(value.secret)) throw new Error('未找到有效的资料库配对记录。');
  await atomicWrite(join(root, 'selected.json'), JSON.stringify({ instanceId }));
  return { instanceId, mcp: { command: process.execPath, args: [join(root, 'runtime/mcp.mjs')], env: { PROMPTDIRECTOR_CONNECTOR_HOME: root } } };
}
if (isMain(import.meta.url)) {
  const [command = 'plan', instanceId] = process.argv.slice(2);
  if (command === 'plan') console.log(JSON.stringify(await installationPlan(), null, 2));
  else if (command === 'install') console.log(JSON.stringify(await install(await installationPlan()), null, 2));
  else if (command === 'pair') console.log(JSON.stringify(await pair(instanceId), null, 2));
  else throw new Error('用法：node connector/install.mjs plan | install | pair <配对编号>');
}
