import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createZipBlob } from '../extension/zip.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'extension/manifest.json'), 'utf8'));
// Ship reviewable source and pinned dependencies, never a maintainer's runtime
// directory, pairing records, downloaded originals or node_modules.
const names = (await readdir(join(root, 'connector'), { withFileTypes: true }))
  .filter(item => item.isFile() && (item.name.endsWith('.mjs') || ['README.md', 'INSTALL.md', 'SKILL.md', 'package.json', 'package-lock.json'].includes(item.name)))
  .map(item => `connector/${item.name}`);
names.push('extension/manifest.json', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md');
const files = await Promise.all(names.sort().map(async name => ({ name, data: await readFile(join(root, name)) })));
const archive = await createZipBlob(files);
await mkdir(join(root, 'dist'), { recursive: true });
const output = join(root, 'dist', `PromptDirector-${manifest.version}-Agent-Connector.zip`);
await writeFile(output, new Uint8Array(await archive.arrayBuffer()));
console.log(`${output}\n${files.length} files, ${archive.size} bytes`);
