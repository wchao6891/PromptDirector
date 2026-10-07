import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { parseDocument, isSeq, isMap } from 'yaml';

const plugin = '@deepseek-ai/dsh-mcp-client';
const entryId = 'promptdirector-mcp';

export function dshConfiguration({ home, env, profile }) {
  if (!profile || profile === '.' || profile === '..' || /[\\/\0]/.test(profile)) throw new Error('请由当前 Agent 读取正在使用的 DSH profile，并通过 --profile 指定；不自动选择或新建配置。');
  const root = env.DSH_HOME || join(home, '.dsh');
  return { host: 'dsh', path: join(root, 'profiles', profile, 'cordis.patch.yml'), format: 'yaml',
    profileManifest: join(root, 'profiles', profile, 'package.json'), overlay: join(root, 'cordis.patch.yml') };
}

function document(text) {
  const doc = parseDocument(text || '[]\n', { strict: true });
  if (doc.contents === null) doc.contents = doc.createNode([]);
  if (doc.errors.length || !isSeq(doc.contents)) throw new Error('DSH patch 配置无法解析，原文件未改动。');
  return doc;
}

// Only edit the user-owned insert row. Keep unrelated patches, tags and comments.
export async function editDshConfiguration(original, mcp, target) {
  const doc = document(original);
  const matches = [];
  function scan(node, path = [], found = matches) {
    if (isSeq(node)) node.items.forEach((item, index) => scan(item, [...path, index], found));
    else if (isMap(node)) {
      if (node.get('id') === entryId || node.getIn(['config', 'serverName']) === 'promptdirector') found.push({ node, path });
      for (const pair of node.items) scan(pair.value, [...path, pair.key.value], found);
    }
  }
  scan(doc.contents);
  const overlay = await readFile(target.overlay, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (overlay !== null) {
    const overrides = [];
    scan(document(overlay).contents, [], overrides);
    if (overrides.length) throw new Error('DSH 全局覆盖层也包含 PromptDirector，请通过 DSH 核对生效配置后接入，避免重复连接。');
  }
  if (matches.length > 1) throw new Error('DSH 中存在多条 PromptDirector 配置，请先核对生效连接；原文件未改动。');
  const match = matches[0];
  if (match && (match.path.length !== 3 || match.path[1] !== 'insert' || match.node.get('name') !== plugin || match.node.get('id') !== entryId)) {
    throw new Error('DSH 已有自定义 PromptDirector 覆盖配置，请通过宿主核对；原文件未改动。');
  }
  const prior = match?.node.get('config')?.toJSON();
  if (match && (!prior || prior.serverName !== 'promptdirector' || prior.transport !== 'stdio' || prior.command !== mcp.command ||
    !isDeepStrictEqual(prior.args, mcp.args) || (prior.env?.PROMPTDIRECTOR_INSTANCE && prior.env.PROMPTDIRECTOR_INSTANCE !== mcp.env.PROMPTDIRECTOR_INSTANCE))) {
    throw new Error('已有不同的 PromptDirector 连接，未覆盖。请确认要使用的资料库或已有安装。');
  }
  if (prior?.env !== undefined && (!prior.env || typeof prior.env !== 'object' || Array.isArray(prior.env))) throw new Error('DSH MCP 环境配置无效，原文件未改动。');
  const config = { ...prior, serverName: 'promptdirector', transport: 'stdio', ...mcp, env: { ...prior?.env, ...mcp.env } };
  const changed = !isDeepStrictEqual(prior, config);
  if (changed) {
    if (match) {
      for (const [key, value] of Object.entries(mcp.env)) doc.setIn([...match.path, 'config', 'env', key], value);
    } else doc.add({ insert: [{ id: entryId, name: plugin, config }] });
  }
  const content = changed ? doc.toString() : original;
  if (changed && !isDeepStrictEqual(document(content).toJS(), doc.toJS())) throw new Error('DSH 配置序列化校验失败，原文件未改动。');
  return { content, changed, hostEnabled: match?.node.get('disabled') !== true };
}
