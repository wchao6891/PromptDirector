"""Specific user feedback; production scanner/sidebar, disposable browser data."""
import sys
from playwright.sync_api import expect
from e2e_support import extension_session

MAIN = 'https://x.com/director/status/123'
REPLY = 'https://x.com/director/status/124'

def post(url, text, media=''):
    return f'''<article data-testid="tweet"><div data-testid="User-Name"><a href="/director"><span>Director</span></a></div>
    <div data-testid="tweetText">{text}</div>{media}<a href="{url}"><time>Today</time></a></article>'''

def scan():
    with extension_session('pd-x-lazy-feedback-') as run:
        setup = run.open_page('collector.html')
        scanner = setup.evaluate("""async()=>({fn:(await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),
          adapters:(await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS})""")
        source = run.context.new_page()
        text = 'Complete production prompt. ' * 800
        media = f'<a href="{MAIN}/photo/1"><img loading="lazy" src="https://pbs.twimg.com/media/pending?format=jpg&amp;name=large" style="width:600px"></a>'
        # An already mounted foreign reply marks the end of the author's chain;
        # this check measures owned text/photo extraction, not thread pagination.
        end = '<article><div data-testid=User-Name><a href="/other">Other</a></div><div data-testid=tweetText>Unrelated reply</div><a href="https://x.com/other/status/125"><time>Today</time></a></article>'
        run.context.route('https://x.com/**', lambda r:r.fulfill(body=post(MAIN,text,media)+end, content_type='text/html'))
        run.context.route('https://pbs.twimg.com/**', lambda r:r.abort())
        source.goto(MAIN)
        source.evaluate('()=>{window.readabilityCalls=0;window.Readability=class {parse(){window.readabilityCalls++;return {textContent:"Unrelated page text"}}}}')
        result = source.evaluate('async options => {const start=performance.now(); const snapshot=await ('+scanner['fn']+')(options); return {snapshot,ms:performance.now()-start}}', {'adapters':scanner['adapters']})
        candidate = result['snapshot']['candidates'][0]
        assert text.strip() == candidate['contentText'], candidate['contentText']
        assert len(candidate['media']) == 1, 'An unloaded owned X photo was omitted: '+str(candidate['media'])
        assert result['ms'] < 1000, result['ms']
        assert source.evaluate('window.readabilityCalls') == 0, 'Owned X content must not trigger whole-page article parsing'
        print({'unloaded_photo_without_click':True,'full_text_characters':len(candidate['contentText']),'scan_ms':result['ms']})

def supplement():
    with extension_session('pd-x-supplement-media-') as run:
        setup = run.open_page('collector.html')
        scanner = setup.evaluate("""async()=>({fn:(await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),
          adapters:(await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS})""")
        media = ''.join(f'<a href="{REPLY}/photo/{i}"><img src="https://pbs.twimg.com/media/reply-{i}.jpg" style="width:200px;height:150px"></a>' for i in range(1,5))
        media += '<video src="https://video.twimg.com/reply.mp4" poster="https://pbs.twimg.com/reply-poster.jpg" style="width:200px;height:150px"></video>'
        run.context.route('https://x.com/**',lambda r:r.fulfill(body=post(MAIN,'Main unchanged.')+post(REPLY,'Author supplementary prompt.',media),content_type='text/html'))
        run.context.route('https://pbs.twimg.com/**',lambda r:r.abort())
        run.context.route('https://video.twimg.com/**',lambda r:r.abort())
        source=run.context.new_page(); source.goto(MAIN)
        raw=source.evaluate('async options=>('+scanner['fn']+')(options)',{'adapters':scanner['adapters']})
        snapshot=setup.evaluate("async value=>(await import('./page-capture.js')).normalizePageCaptureBatch({...value,status:'ready'})",raw)
        assert len(snapshot['candidates'][0]['supplements'][0].get('media',[])) == 5, 'Selected reply lost its own four photos and video'
        setup.evaluate("""snapshot=>{
          const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async q=>q.active?[{id:999,url:'https://x.com/director/status/123'}]:query(q);
          chrome.permissions.contains=async()=>true;
          chrome.permissions.request=async()=>true;
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=async m=>m.type==='START_PAGE_CAPTURE'?{ok:true,batch:snapshot}:m.type==='READ_PAGE_CAPTURE_SUPPLEMENT'?{ok:true,supplement:{...m.supplement,partial:false}}:send(m);
        }""",snapshot)
        run.seed_storage(setup,{'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-10-02T00:00:00Z','clipboardIncluded':True}})
        setup.locator('#start-page-capture').click();setup.locator('.page-capture-confirm').click()
        setup.locator('.page-capture-supplements > summary').click()
        setup.get_by_role('button',name='补入当前案例',exact=True).click()
        expect(setup.locator('.page-capture-thumbnail')).to_have_count(5)
        setup.locator('#page-capture-undo-region').click()
        expect(setup.locator('.page-capture-thumbnail')).to_have_count(0)
        setup.locator('.page-capture-supplements > summary').click()
        setup.get_by_role('button',name='补入当前案例',exact=True).click()
        # Inspect the real sidebar's save payload without writing fake media bytes.
        # The commit now enters the background save-task pipeline as START_CAPTURE_SAVE
        # wrapping a COMMIT_PAGE_CAPTURE input; refusing to start it keeps storage untouched.
        setup.evaluate("async()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async m=>{if(m.type==='START_CAPTURE_SAVE'&&m.input?.type==='COMMIT_PAGE_CAPTURE'){window.savedBatch=m.input.batch;return {ok:false,message:JSON.stringify(m.input.batch)}}return send(m)}}")
        setup.locator('#page-capture-save').click()
        expect(setup.locator('#feedback')).to_contain_text('selectedMediaIds')
        saved=setup.evaluate('window.savedBatch')
        assert len(saved['selections'][0]['selectedMediaIds']) == 5
        assert len(saved['candidates'][0]['media']) == 5
        assert all(m.get('originalWorkUrl')==REPLY for m in saved['candidates'][0]['media'])
        print({'four_photos_and_video_selected':True,'undo_redo':True,'source_page_unchanged':source.url==MAIN})

def hover():
    with extension_session('pd-hover-feedback-') as run:
        page=run.open_page('library.html')
        run.seed_storage(page,{'entries':[{'id':'hover','title':'Hover test','text':'Preserve preview and original drag.', 'savedAt':'2026-10-02T00:00:00Z',
          'mediaAssets':[{'id':'hover-image','kind':'image','mimeType':'image/png','storageMode':'managed'}]}]})
        page.evaluate("""async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
          const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,640,360);
          const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));await (await import('./media-store.js')).saveMediaBlob('hover-image',blob)}""")
        page.reload(); image=page.locator('.case-shot').first
        expect(image).to_have_attribute('src', __import__('re').compile(r'^blob:'))
        page.evaluate("""()=>{window.hoverSources=[];const img=document.querySelector('.case-shot');window.hoverObserver=new MutationObserver(()=>window.hoverSources.push(img.src));window.hoverObserver.observe(img,{attributes:true,attributeFilter:['src']})}""")
        initial=image.get_attribute('src');page.locator('.case-card').first.hover();page.wait_for_timeout(500)
        assert image.get_attribute('src') == initial, 'First hover replaced the visible preview with the original'
        assert page.evaluate('window.hoverSources') == [], page.evaluate('window.hoverSources')
        print({'hover_keeps_preview':True})

if __name__=='__main__':
    modes = {'scan':scan,'supplement':supplement,'hover':hover}
    if len(sys.argv) > 1: modes[sys.argv[1]]()
    else:
        for mode in modes.values(): mode()
