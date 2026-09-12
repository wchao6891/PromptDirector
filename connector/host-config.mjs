import { readFile, writeFile, mkdir, rename, unlink, open, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';

// Paths and formats follow the host documentation linked in INSTALL.md.
export function hostConfiguration(host, { home = homedir(), env = process.env } = {}) {
  switch (host) {
    case 'codex': return { host, path: join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'), format: 'toml', key: 'mcp_servers' };
    case 'claude': return { host, path: env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json'), format: 'json', key: 'mcpServers' };
    case 'workbuddy': return { host, path: join(home, '.workbuddy/mcp.json'), format: 'json', key: 'mcpServers' };
    case 'generic': return { host };
    default: throw new Error('请由当前 Agent 指定 codex、claude、workbuddy 或 generic；云端会话不能直接安装本机连接器。');
  }
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function decode(text, format) {
  const value = format === 'toml' ? parse(text, { integersAsBigInt: true }) : JSON.parse(text);
  if (!object(value)) throw new Error('Agent 配置必须是一个对象，原文件未改动。');
  return value;
}
export async function configurationPlan(target, mcp) {
  if (!target.path) return { ...target, mcp, changed: false, state: 'manual_registration_required' };
  let original = null; let mode = 0o600;
  try {
    const info = await lstat(target.path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('配置路径不是普通文件，请先确认实际配置位置。');
    mode = info.mode & 0o777;
    original = await readFile(target.path, 'utf8');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let config;
  try { config = original === null ? {} : decode(original, target.format); }
  catch { throw new Error('现有 Agent 配置无法解析，已保留原文件；请先修复配置，再重试连接。'); }
  const servers = config[target.key] ?? {};
  if (!object(servers)) throw new Error('现有 MCP 配置结构无效，原文件未改动。');
  const prior = servers.promptdirector;
  if (prior !== undefined) {
    if (!object(prior) || prior.command !== mcp.command || !isDeepStrictEqual(prior.args, mcp.args) || prior.url ||
      (prior.env?.PROMPTDIRECTOR_INSTANCE && prior.env.PROMPTDIRECTOR_INSTANCE !== mcp.env.PROMPTDIRECTOR_INSTANCE)) {
      throw new Error('已有不同的 PromptDirector 连接，未覆盖。请确认要使用的资料库或已有安装。');
    }
  }
  const entry = { ...prior, ...mcp, env: { ...prior?.env, ...mcp.env } };
  if (target.format === 'json') entry.type = 'stdio';
  const changed = !isDeepStrictEqual(prior, entry);
  config[target.key] = { ...servers, promptdirector: entry };
  const content = changed ? (target.format === 'toml' ? stringify(config, { numbersAsFloat: true }) : JSON.stringify(config, null, 2) + '\n') : original;
  // Parse the serialized document before writing; preserve all unrelated values.
  if (changed && !isDeepStrictEqual(decode(content, target.format), config)) throw new Error('配置序列化校验失败，原文件未改动。');
  return { ...target, original, content, changed, mode, mcp, state: 'configured', hostEnabled: entry.enabled !== false && entry.disabled !== true };
}
export async function writeConfiguration(plan) {
  if (!plan.changed) return { path: plan.path, changed: false, state: plan.state, hostEnabled: plan.hostEnabled };
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
