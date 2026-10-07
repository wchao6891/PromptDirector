"""A real gallery selection can compose cases from separate projects without moving/copying them."""
import base64
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, wait_for_async_condition


def main():
    evidence = Path(tempfile.mkdtemp(prefix='pd-cross-project-compound-evidence-'))
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW6kAAAAASUVORK5CYII=')
    with extension_session('pd-cross-project-compound-', viewport={'width': 1440, 'height': 900}) as run:
        setup = run.open_page('collector.html')
        entries = [{'id': name, 'title': '成员 ' + name, 'text': '原词不能改变 ' + name,
                    'sourceFacts': {'originalPromptAvailable': True}, 'url': 'https://example.com/' + name,
                    'customLabels': ['人工标签 ' + name], 'primaryMediaId': 'original-' + name,
                    'mediaAssets': [{'id': 'original-' + name, 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png', 'byteSize': len(png)}],
                    'mediaPrompts': [{'assetId': 'original-' + name, 'source': 'manual', 'text': '逐图原词 ' + name}]}
                   for name in ['a', 'b', 'unassigned']]
        run.seed_storage(setup, {'entries': entries, 'organizerState': {'collections': [
            {'id': 'p', 'name': '原项目 A', 'entryIds': ['a']}, {'id': 'q', 'name': '原项目 B', 'entryIds': ['b']}]},
            'dataSafetyOnboardingSeen': True, 'uiPreferences': {'locale': 'zh-CN', 'motion': 'reduced'}})
        setup.evaluate('''async bytes=>{
          const {saveMediaBlob}=await import('./media-store.js');
          for(const id of ['a','b','unassigned'])await saveMediaBlob('original-'+id,new Blob([new Uint8Array(bytes)],{type:'image/png'}));
        }''', list(png))

        def state():
            # Exercise the real preparation/migration path, then inspect formal storage values.
            setup.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
            return setup.evaluate("async()=> (await import('./library-storage.js')).getLibraryStorage().get(['entries','organizerState','compoundCases'])")

        before = state()
        page = run.open_page('library.html')
        expect(page.locator('body')).to_have_attribute('data-library-state', 'ready')
        page.locator('#select-cases').click()
        for case_id in ['a', 'b']:
            page.locator(f'.case-card[data-entry-id="{case_id}"]').click()
        page.locator('#selection-more-menu > summary').click()
        page.locator('#selection-combine').click()
        dialog = page.locator('#promptdirector-app-dialog')
        dialog.get_by_role('button', name='取消', exact=True).click()
        selection = wait_for_async_condition(setup, "async()=>{const r=await chrome.runtime.sendMessage({type:'GET_REFERENCE_SELECTION'});return r.selection.caseIds.length===2&&r.selection;}")
        assert selection['caseIds'] == ['a', 'b'], 'cancelled composition retains the selected references'
        assert state()['compoundCases'] == []
        page.locator('#selection-more-menu > summary').click()
        page.locator('#selection-combine').click()
        dialog.locator('input').first.fill('跨项目参考组合')
        dialog.get_by_role('button', name='创建组合', exact=True).click()
        try:
            expect(page.locator('#case-list .case-card')).to_have_count(2, timeout=3000)
        except AssertionError:
            page.screenshot(path=str(evidence / 'cross-project-create-failed.png'))
            print(json.dumps({'feedback': page.locator('#feedback').inner_text(), 'evidence': str(evidence)}, ensure_ascii=False), flush=True)
            raise
        expect(page.locator('#share-cancel')).to_be_hidden()
        wait_for_async_condition(setup, "async()=>{const r=await chrome.runtime.sendMessage({type:'GET_REFERENCE_SELECTION'});return r.selection.caseIds.length===0;}", timeout=3000)
        combined = state()
        assert len(combined['compoundCases']) == 1
        group_id = combined['compoundCases'][0]['id']
        assert combined['entries'] == before['entries'], 'combining must not copy or rewrite original cases'
        assert combined['organizerState'] == before['organizerState'], 'combining must not move original project memberships'
        page.reload()
        expect(page.locator('body')).to_have_attribute('data-library-state', 'ready')
        assert state() == combined, 'reload/GET_STATE must not run legacy ownership copying on this valid composition'
        expect(page.locator('#share-cancel')).to_be_hidden()

        # Adding an unassigned member to the existing cross-project group must also preserve ownership.
        updated = setup.evaluate('''id=>chrome.runtime.sendMessage({type:'UPDATE_COMPOUND_CASE',compoundCaseId:id,
          memberEntryIds:['a','b','unassigned']})''', group_id)
        assert updated['ok'], updated
        for project_id in ['p', 'q']:
            page.locator(f'.project-row[data-collection-id="{project_id}"] .project-filter').click()
            expect(page.locator('#case-list .case-card')).to_have_count(1)
            expect(page.locator(f'.case-card[data-entry-id="{group_id}"]')).to_be_visible()
            page.screenshot(path=str(evidence / f'combined-in-{project_id}.png'))
        page.locator(f'.case-card[data-entry-id="{group_id}"]').click()
        try:
            expect(page.locator('.compound-part')).to_have_count(3)
        except AssertionError:
            page.screenshot(path=str(evidence / 'cross-project-detail-failed.png'))
            print(json.dumps({'drawer': page.locator('#detail-drawer').inner_text(), 'feedback': page.locator('#feedback').inner_text(), 'evidence': str(evidence)}, ensure_ascii=False), flush=True)
            raise
        for case_id in ['a', 'b', 'unassigned']:
            expect(page.locator(f'.compound-part[data-member-entry-id="{case_id}"]')).to_contain_text('逐图原词 ' + case_id)
        page.screenshot(path=str(evidence / 'cross-project-complete-detail.png'))
        page.get_by_role('button', name='拆分为独立案例', exact=True).click()
        page.locator('#promptdirector-app-dialog').get_by_role('button', name='拆分', exact=True).click()
        expect(page.locator('#detail-drawer')).to_have_attribute('aria-hidden', 'true')
        page.reload()
        expect(page.locator('body')).to_have_attribute('data-library-state', 'ready')
        after = state()
        assert after['compoundCases'] == []
        assert after['entries'] == before['entries'], 'split retains exact original IDs/text/source/media/annotations and no copies'
        assert after['organizerState'] == before['organizerState'], 'split retains original project owners and the unassigned member'
        for project_id, case_id in [('p', 'a'), ('q', 'b')]:
            page.locator(f'.project-row[data-collection-id="{project_id}"] .project-filter').click()
            expect(page.locator('#case-list .case-card')).to_have_count(1)
            expect(page.locator(f'.case-card[data-entry-id="{case_id}"]')).to_be_visible()
        originals = setup.evaluate('''async()=>{const {getMediaBlob}=await import('./media-store.js');
          return Promise.all(['a','b','unassigned'].map(async id=>Array.from(new Uint8Array(await (await getMediaBlob('original-'+id)).arrayBuffer()))));}''')
        assert originals == [list(png)] * 3, 'original bytes must remain exact without copies or replacements'
        assert not run.page_errors, run.page_errors
        print(json.dumps({'passed': True, 'cross_project_ui_create': True, 'reload_no_copies': True,
                          'update_keeps_unassigned': True, 'both_projects_show_group': True,
                          'split_preserves_original_memberships_and_bytes': True, 'evidence': str(evidence)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
