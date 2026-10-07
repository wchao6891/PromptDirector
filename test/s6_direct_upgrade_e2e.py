"""Run historical source directly into current source in one disposable Chrome profile.

Usage: python3 test/s6_direct_upgrade_e2e.py --baseline-ref <release-commit-or-tag>
This verifies data migration and cold-start persistence, not the release installer or Store package.
"""
from __future__ import annotations

import argparse
import copy
import io
import json
import shutil
import subprocess
import tempfile
import zipfile
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from e2e_support import EXTENSION_DIR, SOURCE_EXTENSION_DIR, base_entry, launch_context, record_page_errors, wait_for_async_condition


SEED = """async fixture => {
  const taxonomy = await import('./taxonomy.js');
  const {createDefaultFacetCatalog, createFacetNode} = await import('./facets.js');
  const {ORGANIZER_VERSION} = await import('./organizer.js');
  const {saveMediaBlob} = await import('./media-store.js');
  const {migrateLibraryState} = await import('./migration.js');
  const defaults = createDefaultFacetCatalog();
  const group = defaults.nodes.find(node => !node.parentId && node.status === 'active');
  const catalog = createFacetNode(defaults, {id: 'direct-upgrade:manual-tag', name: '人工创作标签',
    facetId: group.facetId, parentId: group.id, origin: 'manual'});
  const manualNode = catalog.nodes.find(node => node.id === 'direct-upgrade:manual-tag');
  const active = {...fixture.active, schemaVersion: taxonomy.SCHEMA_VERSION,
    facetAssignments: [{facetId: manualNode.facetId, nodeId: manualNode.id, source: 'manual', status: 'confirmed', confidence: 1}],
    mediaPrompts: [{assetId: 'direct-upgrade:image', text: fixture.originalPrompt, source: 'webpage'}],
    sourceFacts: {originalPromptAvailable: true, author: 'Fixture creator', originalSourceUrl: fixture.active.url}};
  const trashed = {...fixture.trashed, schemaVersion: taxonomy.SCHEMA_VERSION};
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), c => c.charCodeAt(0));
  for (const [entry, id, blob, kind, sourceFormat] of [
    [active, 'direct-upgrade:image', new Blob([png], {type: 'image/png'}), 'image', 'png'],
    [trashed, 'direct-upgrade:trash-original', new Blob(['original PSD bytes kept in Trash'], {type: 'image/vnd.adobe.photoshop'}), 'attachment', 'psd']
  ]) {
    await saveMediaBlob(id, blob, {checkCapacity: false});
    entry.primaryMediaId = id;
    entry.mediaAssets = [{id, kind, storageMode: 'managed', mimeType: blob.type, sourceFormat, byteSize: blob.size,
      ...(kind === 'image' ? {width: 1, height: 1} : {})}];
  }
  await chrome.storage.local.clear();
  // Normalize the synthetic records with the historical implementation before saving them.
  await chrome.storage.local.set(migrateLibraryState({schemaVersion: taxonomy.SCHEMA_VERSION,
    entries: [active], taxonomy: taxonomy.createDefaultTaxonomy(), facetCatalog: catalog,
    classificationRules: [], compoundCases: [],
    organizerState: {version: ORGANIZER_VERSION, collections: [{id: 'direct-upgrade:project',
      name: '升级归属项目', parentId: null, order: 0, entryIds: [active.id]}]},
    trashState: {version: 1, items: [{id: 'direct-upgrade:trash', kind: 'entry', targetId: trashed.id,
      deletedAt: '2026-08-26T00:10:00.000Z', snapshot: trashed, relationships: {collections: []}}]}
  }).state);
  const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
  if (!state.ok) throw new Error(state.message);
}"""

SNAPSHOT = """async () => {
  const state = await chrome.runtime.sendMessage({type: 'GET_STATE'});
  if (!state.ok) throw new Error(state.message);
  const {getMediaBlob} = await import('./media-store.js');
  const stripSchema = entry => {const {schemaVersion, ...content} = entry; return content;};
  const media = [];
  for (const entry of [...state.entries, ...state.trashState.items.map(item => item.snapshot)]) {
    for (const asset of entry.mediaAssets) {
      const blob = await getMediaBlob(asset.id);
      if (!blob) throw new Error(`Missing original ${asset.id}`);
      media.push({id: asset.id, type: blob.type, bytes: Array.from(new Uint8Array(await blob.arrayBuffer()))});
    }
  }
  return {schema: state.schemaVersion, version: chrome.runtime.getManifest().version,
    content: {entries: state.entries.map(stripSchema),
      trash: state.trashState.items.map(item => ({...item, snapshot: stripSchema(item.snapshot)})),
      projects: state.organizerState, facets: state.facetCatalog, compounds: state.compoundCases, media}};
}"""


@contextmanager
def opened_library(playwright, profile: Path, installation: Path, *, reload_extension=False):
    context = launch_context(playwright, str(profile), viewport={"width": 1280, "height": 900},
                             accept_downloads=True, extension_dir=installation)
    errors = []
    try:
        worker = context.service_workers[0]
        extension_id = worker.url.split('/')[2]
        if reload_extension:
            # The source build keeps its manifest version; Chrome can retain the previous worker
            # across browser restarts until the user reloads the unpacked extension.
            status_page = context.new_page()
            status_page.goto('chrome://extensions')
            if not status_page.locator('#devMode').evaluate('element => element.checked'):
                status_page.locator('#devMode').click()
            status_page.evaluate("async id => chrome.developerPrivate.reload(id, {failQuietly: false})", extension_id)
            wait_for_async_condition(status_page, """async id =>
              (await chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true}))
                .some(extension => extension.id === id && extension.state === 'ENABLED' && !extension.disableReasons.reloading)
            """, arg=extension_id)
            status_page.close()
        page = context.new_page()
        record_page_errors(page, errors)
        page.goto(f"chrome-extension://{extension_id}/library.html", wait_until="networkidle")
        page.wait_for_selector('body[data-library-state="ready"]')
        yield page, extension_id
        assert not errors, errors
    finally:
        context.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-ref', required=True, help='Historical Git ref containing the pre-S6 extension')
    args = parser.parse_args()
    repo = SOURCE_EXTENSION_DIR.parent
    baseline_commit = subprocess.check_output(['git', 'rev-parse', '--verify', f'{args.baseline_ref}^{{commit}}'], cwd=repo, text=True).strip()
    archive = subprocess.check_output(['git', 'archive', '--format=zip', baseline_commit, 'extension'], cwd=repo)
    active = base_entry('direct-upgrade:active', '直接升级案例', '正文第一段。\n\n正文第二段：标点、空行和完整说明应保留。', 'content:image-case')
    active['customLabels'] = ['人工标签', '导演选材']
    trashed = base_entry('direct-upgrade:trashed', '回收站原件', '回收站正文不丢失', 'content:image-case')
    trashed['customLabels'] = ['回收站人工标签']
    original_prompt = 'Original prompt, line one.\n原始提示词第二行 — 保留完整内容。'
    with tempfile.TemporaryDirectory(prefix='pd-direct-upgrade-') as temporary, sync_playwright() as playwright:
        root = Path(temporary)
        with zipfile.ZipFile(io.BytesIO(archive)) as source:
            source.extractall(root)
        installation, profile = root / 'extension', root / 'profile'
        with opened_library(playwright, profile, installation) as (page, extension_id):
            page.evaluate(SEED, {'active': active, 'trashed': trashed, 'originalPrompt': original_prompt})
            baseline = page.evaluate(SNAPSHOT)
            raw_before = page.evaluate("() => chrome.storage.local.get(['entries', 'caseIndex', 'upgradeBackup'])")
            assert 'caseIndex' not in raw_before, 'The baseline must precede per-case storage'
            assert 'upgradeBackup' not in raw_before, 'This exercise must start without an intermediate guard version'
            entry = baseline['content']['entries'][0]
            assert entry['text'] == active['text'] and entry['customLabels'] == active['customLabels']
            assert entry['mediaPrompts'][0]['text'] == original_prompt
            assert entry['facetAssignments'][0]['source'] == 'manual'
            assert baseline['content']['trash'][0]['snapshot']['text'] == trashed['text']
            assert baseline['content']['projects']['collections'][0]['entryIds'] == [active['id']]

        # Replace only this disposable installation after closing Chromium. No intermediate source runs.
        shutil.rmtree(installation)
        shutil.copytree(EXTENSION_DIR, installation)
        with opened_library(playwright, profile, installation, reload_extension=True) as (page, current_id):
            assert current_id == extension_id, 'Upgrading must keep extension identity and its existing profile'
            upgraded = page.evaluate(SNAPSHOT)
            assert upgraded['schema'] > baseline['schema'], (baseline['schema'], upgraded['schema'])
            assert upgraded['content'] == baseline['content'], {key: {'before': baseline['content'][key], 'after': upgraded['content'][key]} for key in baseline['content'] if upgraded['content'][key] != baseline['content'][key]}
            layout = page.evaluate("() => chrome.storage.local.get(['entries', 'caseIndex', 'legacyEntries', 'upgradeBackup'])")
            assert 'entries' not in layout and layout['caseIndex']['ids'] == [active['id']], layout.keys()
            assert layout['legacyEntries'] == raw_before['entries'], 'The initial recovery copy must preserve the historical records'
            backup = layout['upgradeBackup']
            assert [backup['fromSchemaVersion'], backup['toSchemaVersion']] == [baseline['schema'], upgraded['schema']]
            assert backup['state']['entries'] == raw_before['entries']
            for message in [
                {'type': 'UPDATE_ENTRY_TITLE', 'entryId': active['id'], 'title': '升级后新的标题'},
                {'type': 'UPDATE_ENTRY_CUSTOM_LABELS', 'entryId': active['id'], 'addLabels': ['升级后新增标签'], 'removeLabels': []},
            ]:
                result = page.evaluate('message => chrome.runtime.sendMessage(message)', message)
                assert result.get('ok'), result
            edited = page.evaluate(SNAPSHOT)
            expected_content = copy.deepcopy(baseline['content'])
            expected_content['entries'][0]['title'] = '升级后新的标题'
            expected_content['entries'][0]['customLabels'] = [*active['customLabels'], '升级后新增标签']
            # Edits also advance timestamps/revisions; every unaffected user field stays exact.
            for field, value in expected_content['entries'][0].items():
                if field not in {'updatedAt', 'libraryUpdatedAt'}:
                    assert edited['content']['entries'][0][field] == value, field
            for field in ['trash', 'projects', 'facets', 'compounds', 'media']:
                assert edited['content'][field] == expected_content[field], field
            expect(page.locator('#case-list')).to_contain_text('升级后新的标题')

        with opened_library(playwright, profile, installation) as (page, reopened_id):
            assert reopened_id == extension_id
            assert page.evaluate(SNAPSHOT) == edited, 'New edits must survive a cold browser/background restart'
            expect(page.locator('#case-list')).to_contain_text('升级后新的标题')
            retained = page.evaluate("() => chrome.storage.local.get(['legacyEntries', 'upgradeBackup'])")
            assert retained['legacyEntries'] == raw_before['entries']
            assert retained['upgradeBackup'] == backup
        print(json.dumps({'baselineCommit': baseline_commit, 'versions': [baseline['version'], upgraded['version']],
                          'schemaUpgrade': [baseline['schema'], upgraded['schema']], 'extensionIdentityKept': True,
                          'historicalContentAndOriginalBytesKept': True, 'coldRestartEditReadback': True,
                          'releaseInstallerTested': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
