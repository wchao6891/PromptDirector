"""Reconstructed X comment layouts; production reader and sidebar save, isolated storage."""
import json
import base64
import hashlib
import os
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session

MAIN = 'https://x.com/director/status/123'
REPLY = 'https://x.com/director/status/124'
FULL = 'Character prompt:\n\n' + '\n'.join(f'Shot {i}: preserve identity, lighting and continuous motion.' for i in range(180))


def html(public=False, attachments=False, public_video=False):
    article = '' if public else ' data-testid="tweet"'
    text = 'dir="auto" class="whitespace-pre-wrap"' if public else 'data-testid="tweetText"'
    more = '' if public else ' data-testid="tweet-text-show-more-link"'
    date = 'Today' if public else '<time>Today</time>'
    media = ''
    if attachments:
        media = ''.join(f'<a href="{REPLY}/photo/{i}"><img src="https://pbs.twimg.com/media/reply-{i}.png" style="width:200px;height:150px"></a>' for i in range(1, 5))
        media += '<video '+('' if public_video else 'src="https://video.twimg.com/reply.mp4" ')+ 'poster="https://pbs.twimg.com/media/poster.png" style="width:200px;height:150px"></video>'
    metadata=''
    if public_video:
        metadata='<script type="application/x-fixture">($R=>$R[1]={media_entities:$R[2]=[$R[3]={expanded_url:"'+REPLY+'/video/1",id_str:"555",media_url_https:"https://pbs.twimg.com/media/poster.png",video_info:$R[4]={variants:$R[5]=[$R[6]={bitrate:10,content_type:"video/mp4",url:"https://video.twimg.com/reply.mp4"}]}}],rest_id:"124"})($R["tsr"])</script>'
    return f'''<html><head><link rel="canonical" href="{REPLY}"></head><body>
    <article{article}><div data-testid="User-Name"><a href="/other">Other</a></div>
    <div {text}>Unrelated text must never be used.</div><a href="/other/status/999">{date}</a></article>
    <article{article}><div data-testid="User-Name"><a href="/director">Director</a></div>
    <div {text}><span>Character prompt: short preview</span><button{more} onclick="this.parentElement.textContent=window.fullPrompt">Show more</button></div>
    {media}<a href="/director/status/124">{date}</a></article>{metadata}</body></html>'''


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


def sidebar_journey(public_video=False):
    with tempfile.TemporaryDirectory(prefix='x-comment-runtime-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name != 'manifest.json':
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += ['https://x.com/*', 'https://pbs.twimg.com/*', 'https://video.twimg.com/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-x-comment-save-', extension_dir=extension) as run:
            failure = [True]
            worker = run.context.service_workers[0]
            if public_video:
                worker.evaluate('''body=>{const original=fetch;globalThis.fetch=(url,options)=>String(url)==='https://x.com/director/status/124'?Promise.resolve(new Response(body,{headers:{'content-type':'text/html'}})):original(url,options)}''',html(public=True,attachments=True,public_video=True))
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
                body = html(public=public_video,attachments=True,public_video=public_video).replace(f'<link rel="canonical" href="{REPLY}">', f'<link rel="canonical" href="{r.request.url}">')
                if r.request.url == MAIN:
                    body = body.replace('/other/status/999', '/director/status/123').replace('href="/other"', 'href="/director"').replace('Other</a>', 'Director</a>').replace('Unrelated text must never be used.', 'Main case text stays unchanged.')
                body += '<script>window.fullPrompt=' + json.dumps(FULL) + '</script>'
                r.fulfill(body=body, content_type='text/html')
            run.context.route('https://x.com/**', route)
            collector = run.open_page('collector.html')
            images = collector.evaluate('''async()=>{
              const values=[];for(let i=0;i<5;i++){
                const c=document.createElement('canvas');c.width=64;c.height=48;
                const ctx=c.getContext('2d');ctx.fillStyle=`rgb(${30+i*35},70,120)`;ctx.fillRect(0,0,64,48);
                values.push(c.toDataURL('image/png').split(',')[1]);
              }return values;
            }''')
            image_bytes = [base64.b64decode(value) for value in images]
            video_bytes = (Path(__file__).parent / 'fixtures/detail-portrait-smoke.mp4').read_bytes()
            def media_route(r):
                index = 4 if '/poster.png' in r.request.url else int(r.request.url.split('reply-')[1].split('.png')[0])-1
                r.fulfill(body=image_bytes[index], content_type='image/png', headers={'Access-Control-Allow-Origin':'*'})
            run.context.route('https://pbs.twimg.com/**', media_route)
            run.context.route('https://video.twimg.com/**', lambda r:r.fulfill(body=video_bytes,content_type='video/mp4',headers={'Access-Control-Allow-Origin':'*'}))
            run.seed_storage(collector, {'entries': [], 'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-09-19T00:00:00Z', 'clipboardIncluded': True}})
            source = run.context.new_page()
            source.goto(MAIN)
            source.bring_to_front()
            collector.evaluate("()=>document.querySelector('#start-page-capture').click()")
            expect(collector.locator('.page-capture-confirm')).to_have_count(1)
            collector.locator('.page-capture-confirm').click()
            collector.locator('.page-capture-supplements > summary').click()
            # The user left the original source after scanning. Exercise the
            # temporary-page path without reading or navigating this new page.
            source_after_navigation = 'https://x.com/other/status/999'
            source.goto(source_after_navigation)
            add_comment()
            expect(collector.locator('#feedback')).to_contain_text('当前草稿已保留')
            expect(collector.locator('.page-capture-supplements')).to_have_count(1)
            expect(collector.locator('.page-capture-excerpt')).not_to_contain_text('Shot 179:')
            assert source.url == source_after_navigation
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
            collector.evaluate('''()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);
              chrome.runtime.sendMessage=async m=>{if(m.type==='COMMIT_PAGE_CAPTURE')window.savedCapturePayload=m.batch;return send(m)};
            }''')
            collector.locator('#page-capture-save').click()
            expect(collector.locator('#page-capture')).to_be_hidden(timeout=15000)
            entries = collector.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries) == 1
            entry = entries[0]
            assert FULL in entry['text'] and entry['text'].count('Shot 179:') == 1, entry['text']
            assert 'short preview' not in entry['text']
            assert any(b.get('sourceUrl') == REPLY for b in entry['articleDocument']['blocks'])
            assert entry['sourceFacts']['status'] == 'complete'
            content = [asset for asset in entry['mediaAssets'] if asset.get('usage') != 'poster']
            payload = collector.evaluate('window.savedCapturePayload')
            assert len(payload['candidates'][0]['media']) == 5, payload
            assert len(payload['selections'][0]['selectedMediaIds']) == 5, payload
            assert len([asset for asset in content if asset['kind']=='image']) == 4, entry['mediaAssets']
            assert len([asset for asset in content if asset['kind']=='video']) == 1, entry['mediaAssets']
            hashes = collector.evaluate('''async assets=>{
              const {getMediaBlob}=await import('./media-store.js');const {sha256Blob}=await import('./blob-digest.js');
              return Promise.all(assets.map(async a=>({id:a.id,kind:a.kind,sha256:await sha256Blob(await getMediaBlob(a.id))})));
            }''', content)
            assert sorted(item['sha256'] for item in hashes if item['kind']=='image') == sorted(hashlib.sha256(b).hexdigest() for b in image_bytes[:4])
            assert next(item['sha256'] for item in hashes if item['kind']=='video') == hashlib.sha256(video_bytes).hexdigest()
            assert len({asset['id'] for asset in content}) == 5
            assert all(any(block.get('assetId')==asset['id'] for block in entry['articleDocument']['blocks']) for asset in content)
            assert source.url == source_after_navigation
            assert not any(p.url == REPLY for p in run.context.pages), 'temporary success tab leaked'
            library = run.open_page('library.html')
            library.locator('.case-card').first.click()
            expect(library.locator('#detail-drawer')).to_contain_text('Shot 179:')
            print({'public_ssr_video':public_video,'failed_read_preserves_draft': True, 'retry_and_undo': True, 'full_saved_once': len(FULL), 'four_photos_and_video_bytes_verified': True, 'library_readback': True, 'source_page_unchanged': True, 'temporary_tabs_closed': True, 'screenshots': str(evidence)})


if __name__ == '__main__':
    if 'public-video' in __import__('sys').argv: sidebar_journey(public_video=True)
    else:
        main()
        sidebar_journey()
