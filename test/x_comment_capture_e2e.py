"""Reconstructed X comment layouts; production reader and sidebar save, isolated storage."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session

MAIN = 'https://x.com/director/status/123'
REPLY = 'https://x.com/director/status/124'
FULL = 'Character prompt:\n\n' + '\n'.join(f'Shot {i}: preserve identity, lighting and continuous motion.' for i in range(180))


def html(public=False):
    article = '' if public else ' data-testid="tweet"'
    text = 'dir="auto" class="whitespace-pre-wrap"' if public else 'data-testid="tweetText"'
    more = '' if public else ' data-testid="tweet-text-show-more-link"'
    date = 'Today' if public else '<time>Today</time>'
    return f'''<html><head><link rel="canonical" href="{REPLY}"></head><body>
    <article{article}><div data-testid="User-Name"><a href="/other">Other</a></div>
    <div {text}>Unrelated text must never be used.</div><a href="/other/status/999">{date}</a></article>
    <article{article}><div data-testid="User-Name"><a href="/director">Director</a></div>
    <div {text}><span>Character prompt: short preview</span><button{more} onclick="this.parentElement.textContent=window.fullPrompt">Show more</button></div>
    <a href="/director/status/124">{date}</a></article></body></html>'''


def main():
    with extension_session('pd-x-comment-') as run:
        setup = run.open_page('collector.html')
        scanner = setup.evaluate("""async()=>({fn:(await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),
          adapters:(await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS})""")
        page = run.context.new_page()
        run.context.route('https://x.com/**', lambda r: r.fulfill(body=html(), content_type='text/html'))
        page.goto(REPLY)
        for public in (False, True):
            page.set_content(html(public))
            page.evaluate('(text)=>window.fullPrompt=text', FULL)
            result = page.evaluate('async options=>('+scanner['fn']+')(options)',
                {'adapters': scanner['adapters'], 'xSupplementUrl': REPLY, 'mediaTimeoutMs': 1000})
            assert result.get('supplement', {}).get('text') == FULL, result
            assert result['supplement']['partial'] is False
            snapshot = page.evaluate('async options=>('+scanner['fn']+')(options)', {'adapters': scanner['adapters']})
            assert len(snapshot['candidates']) == 1
            assert snapshot['candidates'][0]['contentText'] == FULL
            assert snapshot['candidates'][0]['canonicalUrl'] == REPLY
        page.set_content(html())
        page.locator('button').evaluate('(b)=>b.removeAttribute("onclick")')
        failed = page.evaluate('async options=>{try{return await ('+scanner['fn']+')(options)}catch(e){return {error:e.message}}}',
            {'xSupplementUrl': REPLY, 'mediaTimeoutMs': 100})
        assert '未能取得评论全文' in failed.get('error', ''), failed
        print({'classic_and_public_full_comment': True, 'characters': len(FULL)})


def sidebar_journey():
    with tempfile.TemporaryDirectory(prefix='x-comment-runtime-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name != 'manifest.json':
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += ['https://x.com/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-x-comment-save-', extension_dir=extension) as run:
            failure = [True]
            worker = run.context.service_workers[0]
            # Extension-created initial navigations bypass Playwright context routes in this runtime.
            # Pause only that navigation boundary until the harness has attached and loaded its fixture.
            worker.evaluate('''() => {
              const create = chrome.tabs.create.bind(chrome.tabs);
              chrome.tabs.create = async options => {
                const tab = await create({...options, url:'about:blank'});
                await new Promise(resolve => globalThis.fixtureTabReady = resolve);
                return tab;
              };
            }''')
            def add_comment():
                with run.context.expect_page() as opened:
                    collector.get_by_role('button', name='补入当前案例', exact=True).click()
                opened.value.goto(REPLY)
                worker.evaluate('() => globalThis.fixtureTabReady()')
            def route(r):
                if r.request.url == REPLY and failure[0]:
                    r.fulfill(body="<script>history.replaceState({}, '', '/login')</script>Login required", content_type='text/html')
                    return
                body = html().replace('https://x.com/director/status/124', r.request.url)
                if r.request.url == MAIN:
                    body = body.replace('/other/status/999', '/director/status/123').replace('href="/other"', 'href="/director"').replace('Other</a>', 'Director</a>').replace('Unrelated text must never be used.', 'Main case text stays unchanged.')
                body += '<script>window.fullPrompt=' + json.dumps(FULL) + '</script>'
                r.fulfill(body=body, content_type='text/html')
            run.context.route('https://x.com/**', route)
            collector = run.open_page('collector.html')
            run.seed_storage(collector, {'entries': [], 'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-09-19T00:00:00Z', 'clipboardIncluded': True}})
            source = run.context.new_page()
            source.goto(MAIN)
            source.bring_to_front()
            collector.evaluate("()=>document.querySelector('#start-page-capture').click()")
            expect(collector.locator('.page-capture-confirm')).to_have_count(1)
            collector.locator('.page-capture-confirm').click()
            collector.locator('.page-capture-supplements > summary').click()
            add_comment()
            expect(collector.locator('#feedback')).to_contain_text('当前草稿已保留')
            expect(collector.locator('.page-capture-supplements')).to_have_count(1)
            expect(collector.locator('.page-capture-excerpt')).not_to_contain_text('Shot 179:')
            assert source.url == MAIN
            assert not any(p.url == 'https://x.com/login' for p in run.context.pages), 'temporary failed tab leaked'
            failure[0] = False
            collector.locator('.page-capture-supplements > summary').click()
            add_comment()
            expect(collector.locator('.page-capture-supplements')).to_have_count(0)
            expect(collector.locator('.page-capture-excerpt')).to_contain_text('Shot 179:')
            collector.locator('#page-capture-undo-region').click()
            expect(collector.locator('.page-capture-supplements')).to_have_count(1)
            expect(collector.locator('.page-capture-excerpt')).not_to_contain_text('Shot 179:')
            collector.locator('.page-capture-supplements > summary').click()
            add_comment()
            expect(collector.locator('.page-capture-supplements')).to_have_count(0)
            evidence = Path(os.environ.get('PROMPTDIRECTOR_LAB_EVIDENCE_DIR') or tempfile.mkdtemp(prefix='x-comment-visual-'))
            evidence.mkdir(parents=True, exist_ok=True)
            for theme in ('light', 'dark'):
                collector.evaluate("async theme=>{const {initializeUi}=await import('./i18n.js');await initializeUi({theme,locale:'zh-CN',motion:'reduced'})}", theme)
                for width in (1280, 390):
                    collector.set_viewport_size({'width': width, 'height': 900})
                    assert collector.locator('#page-capture').evaluate('e=>e.scrollWidth<=e.clientWidth'), (theme, width)
                    collector.screenshot(path=str(evidence / f'comment-{theme}-{width}.png'))
            collector.locator('#page-capture-save').click()
            expect(collector.locator('#page-capture')).to_be_hidden(timeout=15000)
            entries = collector.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries) == 1
            entry = entries[0]
            assert FULL in entry['text'] and entry['text'].count('Shot 179:') == 1, entry['text']
            assert 'short preview' not in entry['text']
            assert any(b.get('sourceUrl') == REPLY for b in entry['articleDocument']['blocks'])
            assert entry['sourceFacts']['status'] == 'complete'
            assert source.url == MAIN
            assert not any(p.url == REPLY for p in run.context.pages), 'temporary success tab leaked'
            library = run.open_page('library.html')
            library.locator('.case-card').first.click()
            expect(library.locator('#detail-drawer')).to_contain_text('Shot 179:')
            print({'failed_read_preserves_draft': True, 'retry_and_undo': True, 'full_saved_once': len(FULL), 'library_readback': True, 'source_page_unchanged': True, 'temporary_tabs_closed': True, 'screenshots': str(evidence)})


if __name__ == '__main__':
    main()
    sidebar_journey()
