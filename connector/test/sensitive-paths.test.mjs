import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSensitivePath, readablePath } from '../sensitive-paths.mjs';
import { stageFiles } from '../transfers.mjs';

// An agent outside the connector's sandbox must not be able to exfiltrate
// credentials by naming them (or a symlink to them) as attachments.
test('credential stores, secret files and the pairing directory are refused even through symlinks', async t => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'pd-home-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, '.promptdirector');
  const options = { home, root };
  for (const dir of ['.ssh', '.aws', 'Library/Keychains', '.promptdirector/files', 'work']) await mkdir(join(home, dir), { recursive: true });
  const secrets = [join(home, '.ssh', 'notes.txt'), join(home, '.aws', 'credentials'), join(home, 'Library/Keychains', 'login.keychain-db'),
    join(root, 'pairing.json'), join(home, 'work', '.env'), join(home, 'work', '.env.local'), join(home, 'work', 'server.pem'), join(home, 'work', 'id_ed25519.pub')];
  for (const path of secrets) await writeFile(path, 'secret');
  const allowed = [join(home, 'work', 'frame.png'), join(root, 'files', 'download.png')];
  for (const path of allowed) await writeFile(path, 'image');
  for (const path of secrets) await assert.rejects(readablePath(path, options), { code: 'sensitive_path', message: /凭据或系统敏感位置/ }, path);
  for (const path of allowed) assert.equal(await readablePath(path, options), path);
  const link = join(home, 'work', 'innocent.png');
  await symlink(join(home, '.aws', 'credentials'), link);
  await assert.rejects(readablePath(link, options), { code: 'sensitive_path' });
  assert.equal(await isSensitivePath('/etc/passwd', { ...options, platform: 'linux' }), true);
  assert.equal(await isSensitivePath(join(home, '.SSH', 'x'), { ...options, platform: 'darwin' }), true);
});

test('attachment staging refuses secret files before contacting the library', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pd-stage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, '.env'); await writeFile(path, 'TOKEN=1');
  const call = async () => assert.fail('must not upload');
  await assert.rejects(stageFiles([{ path, mimeType: 'text/plain' }], undefined, 'secret', call), /凭据或系统敏感位置/);
  await assert.rejects(stageFiles([{ path, packagePath: 'refs/.env' }], undefined, 'secret', call,
    { purpose: 'skill-file', limits: { maxFileCount: 5, maxFileBytes: 100, maxArchiveBytes: 100 } }), /凭据或系统敏感位置/);
});

test('Skill package without SKILL.md reaches the limit checks instead of crashing', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'pd-noskill-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'notes.md'); await writeFile(path, '12345');
  await assert.rejects(stageFiles([{ path, packagePath: 'notes.md' }], undefined, 'noskill', async () => assert.fail('must not upload'),
    { purpose: 'skill-file', limits: { maxFileCount: 5, maxFileBytes: 4, maxArchiveBytes: 100 } }), /单文件/);
});
