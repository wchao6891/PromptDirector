"""Stale saved references must not block opening the library or erase user intent."""
from e2e_support import extension_session, wait_for_async_condition


def main():
    with extension_session('pd-selection-startup-') as run:
        setup = run.open_page('collector.html')
        saved_selection = {'version': 1, 'revision': 71, 'caseIds': ['missing-a', 'missing-b']}
        run.seed_storage(setup, {
            'entries': [{'id': 'available-image', 'title': '仍可用的图片案例', 'text': '人工保存的正文',
                         'savedAt': '2026-10-01T00:00:00Z', 'primaryMediaId': 'original-image',
                         'mediaAssets': [{'id': 'original-image', 'kind': 'image',
                                          'storageMode': 'managed', 'mimeType': 'image/png'}]}],
            'agentReferenceSelection': saved_selection,
        })
        setup.evaluate('''async () => {
          const {saveMediaBlob}=await import('./media-store.js');
          const blob=await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==')).blob();
          await saveMediaBlob('original-image',blob);
        }''')
        before = setup.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        page = run.open_page('library.html')

        def assert_ready():
            page.wait_for_function('''() => document.body.dataset.libraryState === 'ready'
              || document.querySelector('#library-loading strong')?.textContent.includes('无法打开资料库')''')
            state = page.locator('body').get_attribute('data-library-state')
            assert state == 'ready', page.locator('#library-loading strong').inner_text()
            page.locator('.case-card[data-entry-id="available-image"]').wait_for()

        def selection():
            return page.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_REFERENCE_SELECTION'})).selection")

        assert_ready()
        assert selection() == saved_selection, 'Opening must not silently discard unavailable references'
        assert page.locator('#selection-analyze').is_disabled(), 'Missing cases cannot be analyzed as images'
        assert page.locator('#selection-video-analyze').is_disabled()
        page.reload()
        assert_ready()
        assert selection() == saved_selection, 'A second opening must preserve the same selection revision'
        page.locator('.case-card[data-entry-id="available-image"]').click()
        wait_for_async_condition(page, '''async () => {
          const {selection}=await chrome.runtime.sendMessage({type:'GET_REFERENCE_SELECTION'});
          return selection.caseIds.includes('available-image');
        }''')
        mixed = selection()
        assert mixed['caseIds'] == ['missing-a', 'missing-b', 'available-image'], mixed
        assert mixed['revision'] == saved_selection['revision'] + 1, mixed
        assert page.locator('#selection-analyze').is_enabled(), 'Healthy selected images must remain analyzable'
        page.reload()
        assert_ready()
        assert selection() == mixed
        assert page.locator('#selection-analyze').is_enabled()
        after = setup.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        assert after == before, 'Opening and selecting must preserve case content and media identities'
        print('PASS: missing-only and mixed saved selections survive repeated opening; correct image controls; cases unchanged')


if __name__ == '__main__':
    main()
