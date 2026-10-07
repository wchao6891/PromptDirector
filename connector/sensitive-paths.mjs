import { homedir } from 'node:os';
import { realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { connectorRoot } from './paths.mjs';

// Credential stores, secret configs and browser profiles, relative to the user's home.
const HOME_SECRETS = [
  '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.password-store', '.config/gcloud', '.config/gh',
  '.docker/config.json', '.netrc', '.npmrc', '.pypirc', '.git-credentials',
  'Library/Keychains', 'Library/Cookies', 'Library/Safari', 'Library/Application Support/Google/Chrome',
  'Library/Application Support/Microsoft Edge', 'Library/Application Support/BraveSoftware', 'Library/Application Support/Firefox',
  '.mozilla', '.config/google-chrome', '.config/chromium', '.config/microsoft-edge', '.config/BraveSoftware',
  'AppData/Roaming/Microsoft/Credentials', 'AppData/Roaming/Microsoft/Protect', 'AppData/Local/Microsoft/Credentials',
  'AppData/Local/Google/Chrome/User Data', 'AppData/Local/Microsoft/Edge/User Data', 'AppData/Local/BraveSoftware',
  'AppData/Roaming/Mozilla/Firefox'
];
const SECRET_NAME = /^(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\..*)?|.*\.pem)$/iu;
const inside = (base, path, fold) => {
  const rel = relative(fold(base), fold(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};
const real = path => realpath(path).catch(() => path);

// True when an already-resolved real path is a credential/secret location the
// connector must never read on behalf of an agent.
export async function isSensitivePath(path, { home = homedir(), root = connectorRoot(), platform = process.platform, env = process.env } = {}) {
  const fold = platform === 'win32' || platform === 'darwin' ? value => value.toLowerCase() : value => value;
  if (SECRET_NAME.test(basename(path))) return true;
  const [realHome, realRoot] = await Promise.all([real(home), real(root)]);
  const system = platform === 'win32' ? (env.SystemRoot ? [join(env.SystemRoot, 'System32', 'config')] : []) : ['/etc', '/private/etc', '/Library/Keychains'];
  const denied = [...system, ...HOME_SECRETS.flatMap(entry => [join(home, entry), join(realHome, entry)])];
  if (denied.some(base => inside(base, path, fold))) return true;
  return [root, realRoot].some(base => inside(base, path, fold) && !inside(join(base, 'files'), path, fold));
}

// Resolves symlinks before checking so a link cannot point the connector at a secret.
export async function readablePath(path, options) {
  const resolved = await realpath(path);
  if (await isSensitivePath(resolved, options)) throw Object.assign(new Error('附件路径位于凭据或系统敏感位置，已拒绝读取。'), { code: 'sensitive_path' });
  return resolved;
}
