import { readFile, writeFile, mkdir, rename, unlink, open, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';
import { parse as parseJsonc, modify, applyEdits } from 'jsonc-parser';
import { dshConfiguration, editDshConfiguration } from './host-dsh.mjs';

export const HOSTS = ['codex', 'claude', 'workbuddy', 'opencode', 'zcode', 'qoder', 'dsh', 'qwenwork', 'doubao-work', 'generic'];

// Paths and formats follow the host documentation linked in INSTALL.md.
export function hostConfiguration(host, { home = homedir(), env = process.env, profile } = {}) {
  switch (host) {
    case 'codex': return { host, path: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'), format: 'toml', key: 'mcp_servers' };
    case 'claude': return { host, path: env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json'), format: 'json', key: 'mcpServers' };
    case 'workbuddy': return { host, path: join(home, '.workbuddy/mcp.json'), format: 'json', key: 'mcpServers' };
    case 'opencode': return { host, path: env.OPENCODE_CONFIG || join(env.OPENCODE_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode'), 'opencode.json'), format: 'jsonc', key: 'mcp', alternate: !env.OPENCODE_CONFIG };
    case 'zcode': return { host, path: join(home, '.zcode/cli/config.json'), format: 'json', key: ['mcp', 'servers'], fallback: join(home, '.agents/mcp.json') };
    case 'qoder': return { host, path: join(home, '.qoder/settings.json'), format: 'json', key: 'mcpServers' };
    case 'dsh': return dshConfiguration({ home, env, profile });
    case 'qwenwork': return { host, next: '在千问办公桌面端「扩展 → 连接器 → 添加 → 粘贴 JSON 配置」导入 importConfig，再新建对话验证；若当前版本没有本地 STDIO 入口，请停止并核对版本。' };
    case 'doubao-work': return { host, state: 'host_verification_required', next: '豆包工作自定义连接器已知支持网络服务，但本机 STDIO 入口尚未核实。先在当前桌面版本确认本地命令入口，确认支持后使用 generic 导入；只有网址入口时无法直接接入本机连接器。' };
    case 'generic': return { host };
    default: throw new Error(`请由当前 Agent 指定 ${HOSTS.join('、')}；云端会话不能直接安装本机连接器。`);
  }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function decode(text, format) {
  const errors = [];
  const value = format === 'toml' ? parse(text, { integersAsBigInt: true }) : format === 'jsonc' ? parseJsonc(text, errors, { allowTrailingComma: true }) : JSON.parse(text);
  if (errors.length) throw new Error('配置无法解析');
  if (!object(value)) throw new Error('Agent 配置必须是一个对象，原文件未改动。');
  return value;
}
export async function configurationPlan(target, mcp) {
  if (!target.path) return { ...target, changed: false, state: target.state || 'manual_registration_required',
    ...(target.state ? {} : { mcp, ...(mcp.env.PROMPTDIRECTOR_INSTANCE ? { importConfig: { mcpServers: { promptdirector: { type: 'stdio', ...mcp } } } } : {}) }) };
  if (target.alternate) {
    const alternate = target.path.replace(/\.json$/, '.jsonc');
    const exists = async path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
    if (await exists(alternate)) {
      if (await exists(target.path)) throw new Error('同时存在 OpenCode JSON 与 JSONC 配置，请用 OPENCODE_CONFIG 指定实际生效文件；原文件未改动。');
      target = { ...target, path: alternate };
    }
  }
  if (target.profileManifest) await lstat(target.profileManifest).catch(() => { throw new Error('未找到指定 DSH profile，请先在 DSH 中创建或核对正在使用的 profile。'); });
  let original = null; let mode = 0o600;
  try {
    const info = await lstat(target.path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('配置路径不是普通文件，请先确认实际配置位置。');
    mode = info.mode & 0o777;
    original = await readFile(target.path, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (target.format === 'yaml') return { ...target, original, mode, mcp, state: 'configured', ...await editDshConfiguration(original, mcp, target) };
  let config;
  try { config = original === null ? {} : decode(original, target.format); }
  catch { throw new Error('现有 Agent 配置无法解析，已保留原文件；请先修复配置，再重试连接。'); }
  const keys = Array.isArray(target.key) ? target.key : [target.key];
  let parent = config;
  for (const key of keys.slice(0, -1)) {
    if (parent[key] === undefined) parent[key] = {};
    if (!object(parent[key])) throw new Error('现有 MCP 配置结构无效，原文件未改动。');
    parent = parent[key];
  }
  const key = keys.at(-1);
  const servers = parent[key] ?? {};
  if (!object(servers)) throw new Error('现有 MCP 配置结构无效，原文件未改动。');
  if (target.fallback && !Object.keys(servers).length) {
    const fallback = await readFile(target.fallback, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (fallback !== null) {
      let entries;
      try { entries = decode(fallback, 'json').mcpServers; } catch { throw new Error('ZCode 共享配置无法解析，原文件未改动。'); }
      if (entries && Object.keys(entries).length) throw new Error('ZCode 正在使用 .agents 共享配置；请先通过 ZCode 导入这些服务，避免新增原生配置后使原有服务失效。');
    }
  }
  const prior = servers.promptdirector;
  const localArray = target.host === 'opencode';
  if (localArray && object(servers.servers) && !servers.servers.type) throw new Error('检测到不同版本的 OpenCode 配置结构，请按该版本官方入口导入通用配置；原文件未改动。');
  const desired = localArray ? { type: 'local', command: [mcp.command, ...mcp.args], environment: mcp.env } : mcp;
  const envKey = localArray ? 'environment' : 'env';
  if (prior !== undefined) {
    if (!object(prior) || !isDeepStrictEqual(prior.command, desired.command) || (!localArray && !isDeepStrictEqual(prior.args, mcp.args)) || prior.url ||
      (prior.type && prior.type !== (localArray ? 'local' : 'stdio')) ||
      (prior[envKey]?.PROMPTDIRECTOR_INSTANCE && prior[envKey].PROMPTDIRECTOR_INSTANCE !== mcp.env.PROMPTDIRECTOR_INSTANCE)) {
      throw new Error('已有不同的 PromptDirector 连接，未覆盖。请确认要使用的资料库或已有安装。');
    }
  }
  if (prior?.[envKey] !== undefined && !object(prior[envKey])) throw new Error('现有 MCP 环境配置无效，原文件未改动。');
  const entry = { ...prior, ...desired, [envKey]: { ...prior?.[envKey], ...mcp.env } };
  if (target.format === 'json' && target.host !== 'zcode') entry.type = 'stdio';
  const changed = !isDeepStrictEqual(prior, entry);
  parent[key] = { ...servers, promptdirector: entry };
  const content = !changed ? original : target.format === 'toml' ? stringify(config, { numbersAsFloat: true }) :
    target.format === 'jsonc' ? applyEdits(original || '{}\n', modify(original || '{}\n', [...keys, 'promptdirector'], entry, { formattingOptions: { insertSpaces: true, tabSize: 2 } })) : JSON.stringify(config, null, 2) + '\n';
  // Parse the serialized document before writing; preserve all unrelated values.
  if (changed && !isDeepStrictEqual(decode(content, target.format), config)) throw new Error('配置序列化校验失败，原文件未改动。');
  return { ...target, original, content, changed, mode, mcp, state: 'configured', hostEnabled: entry.enabled !== false && entry.enable !== false && entry.disabled !== true };
}
export async function writeConfiguration(plan) {
  if (!plan.changed) return { path: plan.path, changed: false, state: plan.state, hostEnabled: plan.hostEnabled, ...(plan.next ? { next: plan.next } : {}), ...(plan.importConfig ? { importConfig: plan.importConfig } : {}) };
  await mkdir(dirname(plan.path), { recursive: true });
  const lockPath = `${plan.path}.promptdirector-lock`;
  const lock = await open(lockPath, 'wx', 0o600).catch(() => { throw new Error('配置正在被其他安装任务使用；原配置未改动，请稍后重试。'); });
  const temp = `${plan.path}.${randomUUID()}.tmp`;
  let backup;
  try {
    let current = null;
    try { current = await readFile(plan.path, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (current !== plan.original) throw new Error('检查后 Agent 配置发生变化，已停止写入，请重新执行。');
    if (current !== null) {
      backup = `${plan.path}.promptdirector-backup-${randomUUID()}`;
      await writeFile(backup, current, { mode: 0o600, flag: 'wx' });
    }
    await writeFile(temp, plan.content, { mode: plan.mode, flag: 'wx' });
    await rename(temp, plan.path);
    return { path: resolve(plan.path), backup, changed: true, state: 'configured', hostEnabled: plan.hostEnabled };
  } finally {
    await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await lock.close(); await unlink(lockPath);
  }
}
