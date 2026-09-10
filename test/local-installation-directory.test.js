import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directory, served } from './helpers/local-upgrade-directory.mjs';
import { extensionIdForKey } from '../extension/local-extension-upgrade.js';
import { resolveLocalInstallationDirectory } from '../extension/local-installation-directory.js';
const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url)));
const id = await extensionIdForKey(manifest.key);
const runtime = { id, getManifest:()=>manifest, getURL:path=>`chrome-extension://${id}/${path}` };
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(),'pd-retained-install-'));
  t.after(()=>rm(path,{recursive:true,force:true}));
  await writeFile(join(path,'manifest.json'),JSON.stringify(manifest));
  const root = directory(path);
  root.queryPermission = async()=> 'granted';
  return { root, fetchFn:served(path), runtime };
}
test('verified installation handle is reused regardless of its version-like folder name',async t=>{
  const f=await fixture(t); f.root.name='PromptDirector-1.20.1';
  let remembered;
  const selected=await resolveLocalInstallationDirectory(f.root,{...f,pickDirectory:()=>{throw Error('must not ask again');},remember:async root=>{remembered=root;}});
  assert.equal(selected,f.root); assert.equal(remembered,f.root);
});
test('first installation selection is remembered only after proving it is the running directory',async t=>{
  const f=await fixture(t);let remembered;let picks=0;
  assert.equal(await resolveLocalInstallationDirectory(null,{...f,pickDirectory:async()=>{picks++;return f.root;},remember:async root=>{remembered=root;}}),f.root);
  assert.equal(picks,1); assert.equal(remembered,f.root);
});
test('revoked permission is requested again without replacing the installation or its library',async t=>{
  const f=await fixture(t);let requested=0;let remembered;
  f.root.queryPermission=async()=> 'prompt';f.root.requestPermission=async()=>{requested++;return 'granted';};
  await resolveLocalInstallationDirectory(f.root,{...f,remember:async root=>{remembered=root;}});
  assert.equal(requested,1);assert.equal(remembered,f.root);
});
test('denied permission does not silently choose a different directory',async t=>{
  const f=await fixture(t);f.root.queryPermission=async()=> 'denied';f.root.requestPermission=async()=> 'denied';
  await assert.rejects(resolveLocalInstallationDirectory(f.root,{...f,pickDirectory:()=>{throw Error('wrong path');},remember:()=>{throw Error('must not replace');}}),/写入授权/);
});
test('an inactive remembered copy is cleared without writing program files',async t=>{
  const f=await fixture(t);const copy=await fixture(t);let remembered='unset';
  await assert.rejects(resolveLocalInstallationDirectory(copy.root,{...f,remember:async root=>{remembered=root;}}),/实际加载/);
  assert.equal(remembered,null);
  assert.deepEqual(JSON.parse(await (await copy.root.getFileHandle('manifest.json')).getFile().then(blob=>blob.text())),manifest);
});
