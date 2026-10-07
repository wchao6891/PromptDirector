"""Reference handoff through real UI and service worker; isolated profile only."""
import json
import tempfile
import time
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session, wait_for_async_condition


def main():
    with tempfile.TemporaryDirectory(prefix='pd-reference-code-') as tmp:
        ext = Path(tmp)
        for path in EXTENSION_DIR.iterdir():
            if path.name != 'background.js':
                (ext / path.name).symlink_to(path, target_is_directory=path.is_dir())
        (ext / 'background.js').write_text((EXTENSION_DIR / 'background.js').read_text() + '\nglobalThis.agentTestDispatch = dispatchAgentOperation;\n')
        with extension_session('pd-reference-profile-', extension_dir=ext) as run:
            page = run.open_page('library.html')
            entries = [{'id': case_id, 'title': '参考' + case_id, 'text': '正文' + case_id,
                        'savedAt': '2026-09-27T00:00:00Z', 'url': 'https://example.com/' + case_id,
                        'mediaAssets': [{'id': asset_id, 'kind': kind, 'storageMode': 'managed', 'mimeType': mime, 'byteSize': 100}],
                        'primaryMediaId': asset_id, 'mediaPrompts': [{'assetId': asset_id, 'text': '独立原词' + case_id, 'source': 'manual'}]}
                       for case_id, asset_id, kind, mime in [('a','image','image','image/png'),('b','video','video','video/mp4')]]
            run.seed_storage(page, {'entries': entries})
            page.reload()
            page.locator('.case-card').first.wait_for()
            worker = run.context.service_workers[0]
            def call(op, data=None):
                return worker.evaluate('([op,input]) => agentTestDispatch(op,input)', [op,data or {}])
            def selection(ids):
                return wait_for_async_condition(page, '''async ids => {
                  const v = await chrome.runtime.sendMessage({type:'GET_REFERENCE_SELECTION'});
                  return JSON.stringify(v.selection.caseIds) === JSON.stringify(ids);
                }''', arg=ids)
            assert call('read_workspace_context')['total'] == 0
            filtered = call('search', {'mediaKind':'video','hasOriginalPrompt':True})
            assert [item['caseId'] for item in filtered['cases']] == ['b'], filtered
            assert call('search', {'mediaKind':'image','countOnly':True})['total'] == 1
            peer = run.open_page('library.html')
            peer.locator('.case-card').first.wait_for()
            peer.locator('#select-cases').click()
            browsing = run.open_page('library.html')
            browsing.locator('.case-card').first.wait_for()
            page.locator('#select-cases').click()
            page.locator('.case-card[data-entry-id="a"]').click()
            page.locator('.case-card[data-entry-id="b"]').click()
            selection(['a','b'])
            peer.locator('.case-card[data-entry-id="a"][aria-pressed="true"]').wait_for()
            peer.locator('.case-card[data-entry-id="b"][aria-pressed="true"]').wait_for()
            assert browsing.locator('#select-cases').is_visible(), 'Selection sync must not take over ordinary browsing'
            browsing.close()
            peer.locator('.case-card[data-entry-id="b"]').click()
            selection(['a'])
            page.locator('.case-card[data-entry-id="b"][aria-pressed="false"]').wait_for()
            peer.locator('.case-card[data-entry-id="b"]').click()
            selection(['a','b'])
            page.locator('.case-card[data-entry-id="b"][aria-pressed="true"]').wait_for()
            peer.close()
            started = time.monotonic()
            selected = call('read_workspace_context')
            elapsed_ms = (time.monotonic() - started) * 1000
            assert [(r['caseId'],r['media'][0]['assetId']) for r in selected['references']] == [('a','image'),('b','video')], selected
            # A device re-pair must not rename the library or invalidate saved references.
            pairing = page.evaluate("async () => (await chrome.storage.local.get('agentConnection')).agentConnection")
            assert selected['libraryId'] == pairing['instanceId']
            page.evaluate("pairing => chrome.storage.local.set({agentConnection:{...pairing,instanceId:'new-device-pairing'}})", pairing)
            assert call('read_workspace_context')['libraryId'] == selected['libraryId']
            for ref in selected['references']:
                content = call('read_workspace_content', {'expectedRevision':selected['revision'], 'part':'reference', 'referenceId':ref['referenceId']})
                assert json.loads(content['content'])['originalText'] == '独立原词' + ref['caseId']
                assert call('resolve_reference', {'reference':ref['reference']})['caseId'] == ref['caseId']
            bundle = call('read_workspace_content', {'part':'selection', 'length':49152})
            assert bundle['revision'] == selected['revision']
            bundle_data = json.loads(bundle['content'])
            assert bundle_data['selectedCaseIds'] == ['a','b']
            assert [r['originalText'] for r in bundle_data['references']] == ['独立原词a','独立原词b']
            assert [r['sourceUrl'] for r in bundle_data['references']] == ['https://example.com/a','https://example.com/b']
            assert selected['selectedCaseCount'] == 2
            assert 'selection' in call('status')['workspaceContentParts']
            # Background-to-page read and show_case must prove a visible detail, not only opening a tab.
            visible = call('read_workspace_context', {'source':'page'})
            assert visible['state'] == 'ready', visible
            with run.context.expect_page() as opened_page:
                opened = call('show_case', {'caseId':'a'})
            shown = opened_page.value
            shown.wait_for_load_state('domcontentloaded')
            shown.locator('#detail-drawer[aria-hidden="false"]').wait_for(state="visible")
            context = call('read_workspace_context', {'tabId':opened['tabId']})
            assert context['viewedCaseId'] == 'a', context
            shown.close()
            page.reload()
            page.locator('.case-card').first.wait_for()
            selection(['a','b'])
            assert call('read_workspace_context')['revision'] == selected['revision']
            page.close()
            assert call('read_workspace_context')['total'] == 2
            page = run.open_page('library.html')
            page.locator('.case-card').first.wait_for()
            page.locator('details:has(#selection-clear) > summary').click()
            page.locator('#selection-clear').click()
            selection([])
            assert call('read_workspace_context')['total'] == 0
            filtered = call('search', {'mediaKind':'video','hasOriginalPrompt':True})
            assert [item['caseId'] for item in filtered['cases']] == ['b'], filtered
            assert call('search', {'mediaKind':'image','countOnly':True})['total'] == 1
            peer = run.open_page('library.html')
            peer.locator('.case-card').first.wait_for()
            peer.locator('#select-cases').click()
            browsing = run.open_page('library.html')
            browsing.locator('.case-card').first.wait_for()
            state = page.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")
            assert [e['text'] for e in state['entries']] == [e['text'] for e in entries]
            # A missing selection must stay explicit while healthy cases remain readable.
            page.locator('.case-card[data-entry-id="a"]').click()
            page.locator('.case-card[data-entry-id="b"]').click()
            selection(['a','b'])
            # Remove a selected case through the current record store, preserving the explicit selection.
            page.evaluate("async entries => {const {getLibraryStorage}=await import('./library-storage.js'); await getLibraryStorage().set({entries});}", [entry for entry in state['entries'] if entry['id'] == 'a'])
            partial = call('read_workspace_context')
            assert partial['completeness'] == 'partial' and partial['selectedCaseCount'] == 2
            assert partial['availableCaseCount'] == 1 and partial['issues'][0]['caseId'] == 'b', partial
            available = call('read_workspace_content', {'part':'selection','expectedRevision':partial['revision'],'length':49152})
            assert json.loads(available['content'])['references'][0]['originalText'] == '独立原词a'
            assert json.loads(available['content'])['issues'][0]['code'] == 'case_not_found'
            selection(['a','b'])
            assert not run.page_errors, run.page_errors
            print(f'PASS: two-page live selection sync without taking over browsing, partial reads preserve missing IDs, batch full references and sources, correct media/prompts, references survive device re-pairing, page context, show detail, reload/close persistence, clear; isolated read {elapsed_ms:.1f} ms')


if __name__ == '__main__':
    main()
