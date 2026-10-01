import { isMain } from './is-main.mjs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

// The CLI is a client of the same MCP server, not a second set of operations.
export async function callFromCli(action, input = {}) {
  const client = new Client({ name: 'promptdirector-cli', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))], env: process.env }));
    if (action === 'list') return await client.listTools();
    const result = await client.callTool({ name: action.startsWith('promptdirector_') ? action : `promptdirector_${action}`, arguments: input });
    if (result.isError) throw new Error(result.content.filter(item => item.type === 'text').map(item => item.text).join('\n'));
    const content = result.content.filter(item => item.type === 'text').map(item => item.text).join('');
    return JSON.parse(content);
  } finally { await client.close(); }
}

if (isMain(import.meta.url)) {
  try {
    const [action, ...extra] = process.argv.slice(2);
    if (!action || extra.length) throw new Error('用法：node call.mjs list|工具名；参数从标准输入读取 JSON。');
    let input = '';
    if (!process.stdin.isTTY && action !== 'list') for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.stringify(await callFromCli(action, input.trim() ? JSON.parse(input) : {})));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, message: error.message }));
    process.exitCode = 1;
  }
}
