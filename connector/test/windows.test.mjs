import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { instancePaths, ensurePrivateRoot } from '../paths.mjs';
import { windowsLauncher, windowsCommand, registerWindowsHost, windowsRuntimeEnvironment } from '../windows.mjs';
const execute = promisify(execFile);

test('Windows pipes distinguish private roots without imposing Unix path limits', () => {
  const id = randomUUID();
  const a = instancePaths(join(tmpdir(), 'a'.repeat(180)), id, 'win32');
  assert(a.socket.startsWith('\\\\.\\pipe\\promptdirector-'));
  assert.notEqual(a.socket, instancePaths(join(tmpdir(), 'b'), id, 'win32').socket);
  assert.equal(a.socket, instancePaths(join(tmpdir(), 'a'.repeat(180)), id, 'win32').socket);
});

test('Windows launcher preserves Unicode, spaces, percent and literal exclamation paths', () => {
  const text = windowsLauncher({ root: 'C:\\Users\\案例 100% !\\库', node: 'C:\\Program Files\\nodejs\\node.exe', runtime: 'C:\\Users\\案例 100% !\\库\\runtime' });
  assert(text.includes('DisableDelayedExpansion\r\nchcp 65001 >nul'));
  assert(text.includes('案例 100%% !'));
  assert(text.includes('"C:\\Program Files\\nodejs\\node.exe"'));
  assert.throws(() => windowsLauncher({ root: 'bad\npath' }), /路径/);
  assert.throws(() => windowsCommand('reg.exe', {}), /系统目录/);
});

test('Windows registration preserves Chinese manifest paths and private ACL in real OS', { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pd 注册 ! 100% '));
  const key = `HKCU\\Software\\PromptDirector-Test-${randomUUID()}`;
  const registration = join(root, '注册文件.json');
  try {
    await ensurePrivateRoot(root);
    await ensurePrivateRoot(root);
    // Each call performs registry readback. The test never touches Chrome's real key.
    await registerWindowsHost(registration, { key });
    await registerWindowsHost(registration, { key });
  } finally {
    const script = `$ErrorActionPreference='Stop'; Remove-Item -LiteralPath ('Registry::'+$env:PROMPTDIRECTOR_TEST_KEY.Replace('HKCU\\','HKEY_CURRENT_USER\\')) -Recurse -Force -ErrorAction SilentlyContinue`;
    await execute(windowsCommand('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { env: { ...process.env, PROMPTDIRECTOR_TEST_KEY: key }, windowsHide: true });
    await rm(root, { recursive: true, force: true });
  }
});

test('MCP Windows runtime environment preserves OS discovery without copying credentials', () => {
  assert.deepEqual(windowsRuntimeEnvironment({ SystemRoot: 'C:\\Windows', PSMODULEPATH: 'system-module-path', USERDOMAIN: 'fixture-domain', API_KEY: 'test-only-secret', TOKEN: 'test-only-token' }), {
    SystemRoot: 'C:\\Windows', PSMODULEPATH: 'system-module-path', USERDOMAIN: 'fixture-domain'
  });
});
