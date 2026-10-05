import { accessSync, constants, realpathSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

// Prefer an existing launch path for the exact running executable. A symlink
// can survive a package-manager upgrade; never select a different PATH runtime.
export function nodeCommand({ executable = process.execPath, invoked = process.argv0, path = process.env.PATH || '', platform = process.platform } = {}) {
  const candidates = [isAbsolute(invoked) ? invoked : null,
    ...path.split(delimiter).filter(isAbsolute).map(directory => join(directory, platform === 'win32' ? 'node.exe' : 'node'))];
  const target = realpathSync(executable);
  for (const candidate of candidates.filter(Boolean)) {
    try {
      accessSync(candidate, constants.X_OK);
      if (candidate !== executable && realpathSync(candidate) === target) return candidate;
    } catch { /* Missing PATH entries are not an alternative runtime. */ }
  }
  return executable;
}
