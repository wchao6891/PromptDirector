"""Real card/media lifetimes and selection in an isolated extension profile.

Instrumentation is appended only to a temporary source copy. DOM/cache counts
do not constitute a JS heap or long-running disk growth measurement.
"""
import json
import os
import tempfile
from pathlib import Path

from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session


def main():
    with tempfile.TemporaryDirectory(prefix='pd-window-source-') as folder:
        extension = Path(folder)
        for source in EXTENSION_DIR.iterdir():
            if source.name != 'library.js':
                (extension / source.name).symlink_to(source, target_is_directory=source.is_dir())
        (extension / 'library.js').write_text((EXTENSION_DIR / 'library.js').read_text() + '''
window.pdWindowStats = () => ({loaded: renderedCount, cards: elements.caseList.children.length,
  cardCache: caseCardCache.size, thumbnails: thumbnailUrls.size, originals: originalUrls.size,
  selected: selectedCaseIds.size, previewBudget: previewCacheEntries});
''')
        with extension_session('pd-window-profile-', extension_dir=extension,
                               viewport={'width': 1440, 'height': 900}) as run:
            setup = run.open_page('collector.html')
            setup.evaluate('''async () => {
              const [{SCHEMA_VERSION}, {getLibraryStorage}, {savePortableAssetBlobs}] = await Promise.all([
                import('./taxonomy.js'), import('./library-storage.js'), import('./media-store.js')]);
              const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180;
              const paint=canvas.getContext('2d'); paint.fillStyle='#8668a6'; paint.fillRect(0,0,320,180);
              const blob = await new Promise(resolve=>canvas.toBlob(resolve));
              const entries=Array.from({length:1000}, (_,i)=>({id:`window-${i}`,title:`资源案例 ${i}`,
                text:'完整创作正文，任何未挂载案例仍参与选择与检索。', schemaVersion:SCHEMA_VERSION,
                classification:{pathIds:['content:image-case'],status:'confirmed',source:'manual'},
                savedAt:new Date(Date.UTC(2026,8,1,0,0,i)).toISOString(),
                mediaAssets:[{id:`window-image-${i}`,kind:'image',usage:'content',storageMode:'managed',
                  mimeType:'image/png',width:320,height:180,byteSize:blob.size}],primaryMediaId:`window-image-${i}`}));
              await savePortableAssetBlobs(entries.map(e=>({assetId:e.primaryMediaId,blob})));
              await getLibraryStorage().set({schemaVersion:SCHEMA_VERSION,entries,compoundCases:[],
                trashState:{version:1,items:[]}});
            }''')
            page = run.open_page('library.html', wait_until='networkidle')
            page.wait_for_selector('body[data-library-state="ready"]')
            page.locator('#select-cases').click()
            first = page.locator('#case-list > .case-card').first
            first_id = first.get_attribute('data-entry-id')
            first.click()
            expect(page.locator('#share-count')).to_have_text('已选 1')

            def scroll_batches(steps):
                results = []
                for _ in range(steps):
                    previous = page.evaluate('pdWindowStats().loaded')
                    page.locator('#case-list > .case-card').last.scroll_into_view_if_needed()
                    if previous < 1000:
                        page.wait_for_function('n=>pdWindowStats().loaded>n', arg=previous)
                    page.wait_for_timeout(100)
                    results.append(page.evaluate('pdWindowStats()'))
                return results

            samples = scroll_batches(12)
            assert samples[-1]['loaded'] > 200, samples
            assert max(s['cards'] for s in samples) < 120, samples
            assert max(s['cardCache'] for s in samples) < 140, samples
            visible = page.locator('#case-list > .case-card').last
            second_id = visible.get_attribute('data-entry-id')
            assert second_id != first_id
            visible.click()
            expect(page.locator('#share-count')).to_have_text('已选 2')
            page.evaluate('scrollTo(0,0)')
            expect(page.locator(f'[data-entry-id="{first_id}"]')).to_have_attribute('aria-pressed', 'true')
            page.locator('#selection-more-menu > summary').click()
            page.locator('#selection-clear').click()
            expect(page.locator('#share-count')).to_have_text('已选 0')
            page.locator('#selection-select-filtered').click()
            expect(page.locator('#share-count')).to_have_text('已选 1000')
            assert page.evaluate('pdWindowStats().selected') == 1000
            page.locator('#share-cancel').click()

            # A long gesture pins its source, not every card traversed.
            page.evaluate('''() => {
              const card=document.querySelector('#case-list > .case-card'); window.pdDragSource=card.dataset.entryId;
              card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:new DataTransfer()}));
            }''')
            gesture_samples = scroll_batches(12)
            assert max(s['cards'] for s in gesture_samples) < 125, gesture_samples
            assert max(s['thumbnails'] for s in gesture_samples) <= gesture_samples[-1]['previewBudget'] + 1, gesture_samples
            assert page.evaluate('document.querySelector(`[data-entry-id="${pdDragSource}"]`) !== null')
            page.evaluate('document.dispatchEvent(new DragEvent("dragend",{bubbles:true}))')
            page.evaluate('scrollBy(0,2)')
            page.wait_for_function('() => document.querySelector(`[data-entry-id="${pdDragSource}"]`) === null')
            screenshots = Path(os.environ.get('PD_RESOURCE_SCREENSHOT_DIR', '/private/tmp/pd-resource-window'))
            screenshots.mkdir(parents=True, exist_ok=True)
            for mode in ['list', 'waterfall']:
                page.locator(f'[data-gallery-view="{mode}"]').click()
                for width in [700, 1440]:
                    page.set_viewport_size({'width': width, 'height': 900})
                    page.wait_for_timeout(180)
                    result = page.evaluate('''() => {
                      const visible=[...document.querySelectorAll('#case-list > .case-card')]
                        .map(node=>({id:node.dataset.entryId,r:node.getBoundingClientRect()}))
                        .filter(({r})=>r.bottom>0&&r.top<innerHeight);
                      return {visible:visible.length, overflow:document.documentElement.scrollWidth>innerWidth,
                        overlap:visible.some((a,i)=>visible.slice(i+1).some(b=>Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1
                          && Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1))};
                    }''')
                    assert result['visible'] > 0 and not result['overflow'] and not result['overlap'], (mode,width,result)
                page.screenshot(path=str(screenshots / f'{mode}.png'))
            print(json.dumps({'selectionAcrossUnmount': True, 'selectAll1000': True,
                              'cardWindow': samples, 'gestureWindow': gesture_samples,
                              'resizeAndBothViews': True, 'screenshots': str(screenshots)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
