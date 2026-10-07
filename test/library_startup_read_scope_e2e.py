"""Opening the gallery must not load or rewrite unrelated histories or recovery copies."""
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-library-read-scope-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name not in ['background.js', 'library.js']:
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        source = (EXTENSION_DIR / 'background.js').read_text()
        anchor = 'const libraryStorage = getLibraryStorage();'
        assert anchor in source
        source = source.replace(anchor, '''const pdScopeStorage = getLibraryStorage();
const libraryStorage = {...pdScopeStorage, get: async keys => {
  (globalThis.pdScopeReads ??= []).push(Array.isArray(keys) ? keys : [keys]);
  return pdScopeStorage.get(keys);
}, getSnapshot: async keys => {
  (globalThis.pdScopeReads ??= []).push(Array.isArray(keys) ? keys : [keys]);
  return pdScopeStorage.getSnapshot(keys);
}, getSnapshotBatches: (keys, options) => {
  (globalThis.pdScopeReads ??= []).push(Array.isArray(keys) ? keys : [keys]);
  return pdScopeStorage.getSnapshotBatches(keys, options);
}};''')
        (ext / 'background.js').write_text(source)
        page_source = (EXTENSION_DIR / 'library.js').read_text().replace(anchor, '''const pdScopeStorage = getLibraryStorage();
const libraryStorage = {...pdScopeStorage, get: async keys => {
  (globalThis.pdScopeReads ??= []).push(Array.isArray(keys) ? keys : [keys]);
  return pdScopeStorage.get(keys);
}, getSnapshot: async keys => {
  (globalThis.pdScopeReads ??= []).push(Array.isArray(keys) ? keys : [keys]);
  return pdScopeStorage.getSnapshot(keys);
}, getSnapshotBatches: (keys, options) => {
  (globalThis.pdScopeReads ??= []).push(Array.isArray(keys) ? keys : [keys]);
  return pdScopeStorage.getSnapshotBatches(keys, options);
}};''')
        (ext / 'library.js').write_text(page_source)
        with extension_session('pd-library-read-scope-profile-', extension_dir=ext) as run:
            setup = run.open_page('collector.html')
            run.seed_storage(setup, {'entries': [
                {'id': 'public', 'title': '可见案例', 'text': '保留原词',
                 'classification': {'pathIds': ['content:image-case'], 'status': 'confirmed'},
                 'mediaAssets': [{'id': 'original', 'kind': 'image', 'usage': 'content',
                                  'storageMode': 'managed', 'mimeType': 'image/png'}],
                 'primaryMediaId': 'original'},
                {'id': 'hidden', 'title': '仅项目内案例', 'text': '人工正文',
                 'classification': {'pathIds': ['content:image-case'], 'status': 'confirmed'}}],
                'organizerState': {'collections': [
                    {'id': 'private', 'name': '私有项目', 'visibility': 'project-only', 'entryIds': ['hidden']}]
                }})
            histories = ['migrationBackup', 'folderOwnershipBackup', 'classificationResetBackup',
                         'creativeFacetMigrationBackupV5', 'composerSessions', 'creativeRuns',
                         'creativeJobs', 'creativeSkills', 'activeCreativeResult', 'importStaging',
                         'analysisTasks', 'libraryImportTransactions', 'libraryReplacementRecoveryPoint']
            preserved = {key: {'marker': key, 'retainedText': '原有历史资料' * 1000} for key in histories}
            protected_keys = [*histories, 'legacyEntries', 'upgradeBackup']
            setup.evaluate('async payload => chrome.storage.local.set(payload)', preserved)
            setup.evaluate("""async () => {
              const {completeLibraryViewSummary}=await import('./library-view-summary.js');
              const state=await chrome.storage.local.get(['facetUndo','trashState','analysisBatchUndo','analysisRebuildStaging']);
              await chrome.storage.local.set({libraryViewSummary:completeLibraryViewSummary(state)});
            }""")
            before = setup.evaluate("async () => chrome.storage.local.get(null)")
            before_entries = setup.evaluate("async () => (await (await import('./library-storage.js')).getLibraryStorage().get('entries')).entries")
            worker = run.context.service_workers[0]
            worker.evaluate('globalThis.pdScopeReads=[]')
            page = run.open_page('library.html')
            page.wait_for_selector('body[data-library-state="ready"]')
            page.locator('.case-card[data-entry-id="public"]').wait_for()
            assert page.locator('.case-card[data-entry-id="hidden"]').count() == 0
            page.locator('.project-filter').filter(has_text='私有项目').click()
            page.locator('.case-card[data-entry-id="hidden"]').wait_for()
            page.reload()
            page.wait_for_selector('body[data-library-state="ready"]')
            assert page.locator('.case-card').count() > 0
            reads = worker.evaluate('globalThis.pdScopeReads') + page.evaluate('globalThis.pdScopeReads')
            for keys in reads:
                assert None not in keys, f'Gallery opening loaded every storage key: {keys}'
                assert not set(keys).intersection(protected_keys), f'Gallery opening loaded unrelated records: {keys}'
            after = setup.evaluate('async () => chrome.storage.local.get(null)')
            case_keys = {key for key in before.keys() | after.keys() if key.startswith('case:') or key == 'caseIndex'}
            for key in [*protected_keys, *case_keys, 'entries', 'organizerState', 'compoundCases', 'trashState']:
                assert after.get(key) == before.get(key), f'Opening must preserve {key} byte-for-byte as stored'
            print('PASS: gallery opening/reload/project switch preserve cases and histories; unrelated recovery/session/task records are not read')
            # An obsolete library still needs the established full repair path,
            # including its original backup; a partial projection cannot migrate it.
            setup.evaluate("async () => chrome.storage.local.set({schemaVersion: 27})")
            worker.evaluate('globalThis.pdScopeReads=[]')
            result = setup.evaluate("async () => (await import('./library-view-state.js')).createLibraryViewReader({storage:(await import('./library-storage.js')).getLibraryStorage(),prepare:()=>chrome.runtime.sendMessage({type:'PREPARE_LIBRARY_VIEW_STATE'}),uiLanguage:chrome.i18n.getUILanguage()})()")
            assert result['ok'] and result['entries'][0]['text'] == '保留原词'
            assert any('migrationBackup' in keys and 'composerSessions' in keys
                       for keys in worker.evaluate('globalThis.pdScopeReads')), 'Legacy repair must use a complete snapshot'
            backup = setup.evaluate("async () => (await chrome.storage.local.get('migrationBackup')).migrationBackup")
            assert backup == preserved['migrationBackup'], 'Existing recovery material must survive legacy repair'
            print('PASS: obsolete schema falls back to full repair and retains the existing recovery copy')
            # More than one runtime message can carry; retain complete bodies in
            # every workspace without sending the whole library through runtime.
            counts = setup.evaluate("""async () => {
              const {getLibraryStorage}=await import('./library-storage.js');
              const stored = await getLibraryStorage().get('entries');
              const entries = stored.entries.map(entry => ({...entry,text:'x'.repeat(34*1024*1024)+entry.id}));
              await getLibraryStorage().set({entries});
              const {createLibraryViewReader}=await import('./library-view-state.js');
              const reader=createLibraryViewReader({storage:(await import('./library-storage.js')).getLibraryStorage(),
                prepare:()=>chrome.runtime.sendMessage({type:'PREPARE_LIBRARY_VIEW_STATE'}),includeCreativeState:true});
              const read=await reader();
              return {count:read.entries.length,first:read.entries[0].text.length,last:read.entries.at(-1).text.slice(-6)};
            }""")
            assert counts == {'count':2,'first':34*1024*1024+6,'last':'hidden'}, counts
            page.reload()
            page.wait_for_selector('body[data-library-state="ready"]')
            assert page.locator('.case-card').count() > 0
            skills=run.open_page('skills.html')
            skills.wait_for_function("() => document.querySelector('#skill-summary')?.textContent.includes('0')")
            composer=run.open_page('composer.html')
            composer.wait_for_function("() => document.querySelector('#composer-send-note')?.textContent.includes('字符')")
            assert not run.page_errors, run.page_errors
            print('PASS: gallery, Skill and Composer pages load over 64 MiB of full case text; complete first/last bodies remain readable')
            # A populated PDF cache must still trigger the later search-index
            # update; skipping an empty cache must not skip real document text.
            setup.evaluate("""async entries => {
              const {saveDerivedMedia,saveMediaBlob}=await import('./media-store.js');
              const thumbnail=await(await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')).blob();
              await saveMediaBlob('cached-pdf',new Blob(['%PDF fixture'],{type:'application/pdf'}));
              await saveDerivedMedia('cached-pdf',{thumbnail,pageCount:2,searchText:'PDF缓存末尾可搜索'});
              const {getLibraryStorage}=await import('./library-storage.js');
              await getLibraryStorage().set({entries:[...entries,{id:'pdf-cache-case',title:'缓存文档',text:'正文中没有检索词',
                classification:{pathIds:['content:reference'],status:'confirmed'},
                mediaAssets:[{id:'cached-pdf',kind:'document',usage:'content',storageMode:'managed',mimeType:'application/pdf'}],
                primaryMediaId:'cached-pdf'}]});
            }""", before_entries)
            page.reload()
            page.wait_for_selector('body[data-library-state="ready"]')
            page.locator('#workspace-library').click()
            page.locator('#search-input').fill('PDF缓存末尾可搜索')
            page.wait_for_function('() => document.querySelectorAll(".case-card").length === 1')
            page.locator('.case-card[data-entry-id="pdf-cache-case"]').wait_for()
            assert page.locator('.case-card').count()==1
            assert not run.page_errors, run.page_errors
            print('PASS: populated PDF derived cache rebuilds search after opening and returns the complete cached document match')



if __name__ == '__main__':
    main()
