import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function isMain(url) {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(url)); } catch { return false; }
}
