"""Unadapted multi-section pages: real extension discovery, grouping and save/readback."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session
from article_cases_capture_e2e import image_bytes
from page_capture_e2e import FIXTURE_ORIGIN

PAGE = '''<!doctype html><html><head><meta charset="utf-8"><title>Visual eras</title>
<style>.reveal{opacity:0}img{width:160px;height:120px}.grid{display:flex}</style></head><body>
<header><img src="/logo.png"></header><main><h1>Visual eras</h1><p>Shared introduction</p>
<section id="era-a"><h2>1980s</h2><div>First era description.</div></section>
<div class="grid"><div><img class="reveal" loading="lazy" data-src="/a-original.png" src="/a-preview.png" alt="Film A"></div>
<div><img src="/b.png" alt="Film B"></div></div>
<section id="era-b"><h2>1990s</h2></section><div class="grid"><div><img src="/c.png" alt="Film C"></div>
<div><video controls width="160" height="120" poster="/poster.png"><source src="/clip.mp4" type="video/mp4"></video></div></div>
<section hidden><h2>Hidden template</h2><img loading="lazy" data-src="/hidden.png" src="/placeholder.png"></section>
<div style="display:none"><img loading="lazy" data-src="/hidden-tab.png"></div>
<aside><img src="/ad.png"></aside><nav><a href="#era-a">Repeated navigation</a></nav>
</main><footer>Footer text</footer></body></html>'''


def main():
    video = (Path(__file__).parent / 'fixtures/zhipu-local-video-smoke.mp4').read_bytes()
    with extension_session('pd-generic-grouping-') as run:
        run.context.route(FIXTURE_ORIGIN + '/**', lambda r: r.fulfill(
            body=PAGE if r.request.url.endswith('/group-fixture') else video if r.request.url.endswith('/clip.mp4') else image_bytes(r.request.url),
            content_type='text/html' if r.request.url.endswith('/group-fixture') else 'video/mp4' if r.request.url.endswith('/clip.mp4') else 'image/png'))
        panel = run.open_page('collector.html')
        run.seed_storage(panel, {'entries': [], 'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-09-12T00:00:00Z', 'clipboardIncluded': True}})
        source = run.context.new_page()
        source.goto(FIXTURE_ORIGIN + '/group-fixture')
        source.bring_to_front()
        panel.evaluate('''()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);window.captures=[];
          chrome.runtime.sendMessage=async m=>{const r=await send(m);if(m.type==='START_PAGE_CAPTURE')window.captures.push(r);return r;};}''')
        panel.locator('#start-page-capture').evaluate('e=>e.click()')
        expect(panel.locator('.page-capture-item')).to_have_count(1)
        batch = panel.evaluate('captures.at(-1).batch')
        assert batch['adapter'] == 'generic'
        media = batch['candidates'][0]['media']
        assert len(media) == 4, [(m['url'], m['kind']) for m in media]
        assert any(m['url'].endswith('/a-original.png') for m in media)
        assert any(m['kind'] == 'video' and any(v['url'].endswith('/clip.mp4') for v in m['variants']) for m in media)
        assert all('hidden' not in m['url'] and '/ad.' not in m['url'] and '/logo.' not in m['url'] for m in media)
        assert 'Hidden template' not in batch['candidates'][0]['contentText']
        panel.locator('.page-capture-confirm').click()
        panel.locator('#page-capture-mode').select_option('article')
        expect(panel.locator('.page-capture-item')).to_have_count(3)
        expect(panel.locator('.page-capture-item.confirmed')).to_have_count(2)
        first = panel.locator('.page-capture-item').filter(has=panel.locator('.page-capture-confirm strong', has_text='1980s'))
        expect(first).to_contain_text('First era description.')
        assert first.locator('.page-capture-thumbnail').count() == 2
        # Removing a chosen original must survive changing the grouping mode.
        first.locator('.page-capture-thumbnail-remove').first.click()
        panel.locator('#page-capture-mode').select_option('media')
        expect(panel.locator('.page-capture-item')).to_have_count(5)
        expect(panel.locator('.page-capture-item.confirmed')).to_have_count(3)
        panel.locator('#page-capture-undo-region').click()
        expect(panel.locator('#page-capture-mode')).to_have_value('article')
        panel.locator('#page-capture-undo-region').click()
        expect(first.locator('.page-capture-thumbnail')).to_have_count(2)
        first.get_by_role('button', name='按媒体拆开', exact=True).click()
        expect(panel.locator('.page-capture-item.confirmed')).to_have_count(3)
        panel.locator('#page-capture-undo-region').click()
        panel.locator('#page-capture-merge-groups').click()
        expect(panel.locator('.page-capture-item.confirmed')).to_have_count(1)
        expect(panel.locator('.page-capture-item.confirmed .page-capture-thumbnail')).to_have_count(4)
        panel.locator('#page-capture-undo-region').click()
        # Local regrouping never reloads the source page.
        assert panel.evaluate('captures.length') == 1
        panel.locator('.page-capture-item.confirmed .page-capture-confirm').first.click()
        panel.locator('.page-capture-item.confirmed .page-capture-confirm').first.click()
        panel.locator('#page-capture-mode').select_option('media')
        expect(panel.locator('.page-capture-item.confirmed')).to_have_count(0)
        panel.locator('#page-capture-undo-region').click()
        panel.locator('.page-capture-confirm').nth(0).click()
        panel.locator('.page-capture-confirm').nth(1).click()
        for width in [320, 390, 1100]:
            panel.set_viewport_size({'width': width, 'height': 850})
            assert panel.evaluate('document.documentElement.scrollWidth<=innerWidth')
        panel.set_viewport_size({'width': 390, 'height': 850})
        panel.bring_to_front()
        panel.screenshot(path=str(Path(tempfile.gettempdir()) / 'pd-generic-groups.png'), full_page=True)
        panel.locator('#page-capture-save').click()
        expect(panel.locator('#page-capture')).to_be_hidden(timeout=60000)
        panel.reload()
        entries = panel.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        assert {e['title'] for e in entries} == {'1980s', '1990s'}, [e['title'] for e in entries]
        assert all(len([a for a in e['mediaAssets'] if a.get('usage') != 'poster']) == 2 for e in entries), [(e['title'],len(e['mediaAssets'])) for e in entries]
        assert any(a.get('usage') == 'poster' for e in entries for a in e['mediaAssets'])
        era = next(e for e in entries if e['title'] == '1980s')
        assert 'First era description.' in era['text'] and '1990s' not in era['text']
        assert all(a.get('byteSize', 0) > 0 for e in entries for a in e['mediaAssets'])
        print('PASS: generic lazy media, hidden-template exclusion, sibling grids, source-child video, local modes, selection retention, split/merge/undo, responsive UI and save/reload')

        # A dedicated adapter retains its pre-change HTML and media extraction.
        # The expected originals were recorded by comparing the old and new
        # injected functions on this fixture, rather than depending on Git HEAD.
        current = panel.evaluate("async()=>(await import('./page-capture.js')).collectPageCaptureSnapshot.toString()")
        options = {'adapters': [{'id': 'dedicated-fixture', 'hosts': ['wchao6891.github.io'], 'cardSelectors': [], 'fields': {'content': ['main']}}]}
        dedicated = source.evaluate('options=>(' + current + ')(options)', options)
        assert dedicated['adapter'] == 'dedicated-fixture'
        assert len(dedicated['candidates']) == 1
        assert {m['url'].rsplit('/',1)[-1] for m in dedicated['candidates'][0]['media']} == {'b.png', 'c.png', 'clip.mp4', 'a-original.png', 'hidden.png', 'hidden-tab.png'}, [(m['kind'],m['url']) for m in dedicated['candidates'][0]['media']]
        print('PASS: dedicated adapter retains its pre-change HTML-derived media set')



if __name__ == '__main__':
    main()
