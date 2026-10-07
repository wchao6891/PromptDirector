"""Long articles paint before reading offscreen originals; visited covers survive navigation."""
import os
import sys
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def main(mode='all'):
    if mode == 'all':
        for step in ['article', 'cache', 'placeholder']: main(step)
        return
    with extension_session('pd-session-preview-') as run:
        setup = run.open_page('collector.html')
        assets = [{'id': f'image-{i}', 'kind': 'image', 'storageMode': 'managed',
                   'mimeType': 'image/png', 'width': 400, 'height': 300} for i in range(120)]
        article = {'id': 'article', 'title': 'Long visual article', 'text': 'Source stays intact',
                   'contentRole': 'reference', 'classification': {'pathIds': ['content:reference'], 'status': 'confirmed'},
                   'mediaAssets': assets[1:2], 'primaryMediaId': 'image-1',
                   'articleDocument': {'version': 1, 'blocks': [
                       {'id': 'intro', 'kind': 'paragraph', 'text': 'Read before decoding offscreen originals'},
                       {'id': 'spacer', 'kind': 'paragraph', 'text': '\n'.join(['Body retained'] * 160)},
                       {'id': 'figure', 'kind': 'image', 'assetId': 'image-1'}]}}
        entries = [article] if mode == 'article' else [
            {'id': f'case-{i}', 'title': f'Cover {i}', 'text': 'Original',
             'mediaAssets': [a], 'primaryMediaId': a['id']} for i, a in enumerate(assets)]
        run.seed_storage(setup, {'entries': entries, 'uiPreferences': {'locale': 'zh-CN', 'motion': 'reduced'}})
        setup.evaluate("""async (assets) => {
            const {saveMediaBlob,saveDerivedMedia} = await import('./media-store.js');
            const c=document.createElement('canvas');c.width=400;c.height=300;
            const x=c.getContext('2d');x.fillStyle='#526b75';x.fillRect(0,0,400,300);
            const b=await new Promise(r=>c.toBlob(r,'image/png'));
            for(const a of assets){await saveMediaBlob(a.id,b);await saveDerivedMedia(a.id,{thumbnail:b});}
        }""", assets)
        p = run.context.new_page()
        p.add_init_script("""Object.defineProperty(performance,'memory',{value:{jsHeapSizeLimit:16*1024*1024}});
            const original=Blob.prototype.arrayBuffer;
            window.decodeCalls=0;window.blockDecode=false;
            Blob.prototype.arrayBuffer=async function(...args){window.decodeCalls++;
                if(window.blockDecode) await new Promise(r=>window.releaseDecode=r);
                return original.apply(this,args);};""")
        if mode == 'placeholder': p.add_init_script('window.blockDecode=true')
        p.goto(f'chrome-extension://{run.extension_id}/library.html')
        first = p.locator('.case-card').first
        expect(first).to_be_visible()
        if mode == 'placeholder':
            expect(first.locator('.preview-placeholder')).to_be_visible()
            assert first.locator('img').evaluate("i=>getComputedStyle(i).opacity==='0'")
            folder = os.environ.get('PD_E2E_ARTIFACT_DIR')
            if folder:
                Path(folder).mkdir(parents=True, exist_ok=True)
                p.screenshot(path=str(Path(folder)/'cover-placeholders.png'))
            p.evaluate('()=>{window.blockDecode=false;window.releaseDecode?.()}')
            print('PASS: delayed covers show an icon placeholder without broken-image text')
            return
        p.wait_for_function("()=>[...document.querySelectorAll('.case-card img')].some(i=>i.complete&&i.naturalWidth)")
        if mode == 'article':
            original = p.evaluate("async()=> (await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries")
            p.evaluate('()=>{window.blockDecode=true;window.decodeCalls=0}')
            first.dispatch_event("click")
            expect(p.locator('.article-document-reader')).to_contain_text('Read before decoding offscreen originals', timeout=2000)
            assert p.evaluate('()=>window.decodeCalls') == 0, 'Offscreen originals are decoded before they are viewed'
            p.evaluate('()=>{window.blockDecode=false;window.releaseDecode?.()}')
            image = p.locator('.article-document-image')
            image.scroll_into_view_if_needed()
            p.wait_for_function("()=>{const i=document.querySelector('.article-document-image');return i.complete&&i.naturalWidth}")
            assert p.evaluate("async()=> (await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries") == original
            p.locator('#detail-close').click()
            first.dispatch_event('click')
            expect(p.locator('.article-document-reader')).to_contain_text('Read before decoding offscreen originals')
            print('PASS: article paints before offscreen reads, images load when viewed, reopen and source retention')
        else:
            initial = p.locator('.case-card[data-entry-id="case-0"] img').get_attribute('src')
            # Visit every page through the actual scroll and virtual mounting path.
            for i in range(1, 120):
                p.evaluate("()=>{window.scrollBy(0,innerHeight-150)}")
                p.wait_for_timeout(60)
                if p.locator('.case-card[data-entry-id="case-119"]').count():
                    break
            expect(p.locator('.case-card[data-entry-id="case-119"]')).to_be_visible(timeout=10000)
            p.locator('.case-card[data-entry-id="case-119"]').scroll_into_view_if_needed()
            p.wait_for_function("()=>{const i=document.querySelector('[data-entry-id=\"case-119\"] img');return i?.complete&&i.naturalWidth}")
            p.evaluate("()=>{window.scrollTo(0,0)}")
            cover = p.locator('.case-card[data-entry-id="case-0"] img')
            expect(cover).to_be_visible()
            p.wait_for_function("()=>{const i=document.querySelector('[data-entry-id=\"case-0\"] img');return i?.complete&&i.naturalWidth}")
            assert cover.get_attribute('src') == initial, 'Visited small cover was evicted during the same library session'
            p.locator('.case-card[data-entry-id="case-0"]').click()
            expect(p.locator('#detail-drawer')).to_have_attribute('data-entry-id', 'case-0')
            p.locator('#detail-close').click()
            expect(cover).to_have_attribute('src', initial)
            print('PASS: visited small covers retained across virtual scrolling')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv)>1 else 'all')
