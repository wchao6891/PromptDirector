"""Replay the reported generic list -> work-detail workflow without writing a library.

Source evidence: https://www.prompt-motion.com/ and /stephanlivera-df17a2 expose a
linked catalogue and a work page with Prompt, Model, Effort and source attribution.
The live HTML request returned 403 during investigation: this deliberately minimal
DOM fixture models that observed workflow; it is not a captured website DOM.
The hx-get case preserves the existing eyecannndy fragment-detail regression.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from generic_card_roots_e2e import PNG

ROOT=Path(__file__).resolve().parents[1]
ORIGIN='https://generic-detail.example.test'
PAGE='''<html><head><title>Motion collection</title><style>
.card{padding:15px;width:310px;display:inline-block}img{width:280px;height:160px}
</style></head><body><main>
<section class="wanted"><div class="grid">
<div class="card"><h2>Work A</h2><a href="/work/a"><img src="/a.png" alt="Work A"></a><p>Selected A original text</p></div>
<div class="card"><h2>Work B</h2><a hx-get="/work/b"><img src="/b.png" alt="Work B"></a><p>Selected B original text</p></div>
</div></section>
<section class="other"><div class="grid">
<div class="card"><h2>Unselected C</h2><img src="/c.png"><p>Do not include this separate collection</p></div>
<div class="card"><h2>Unselected D</h2><img src="/d.png"><p>Do not include this separate collection</p></div>
</div></section></main></body></html>'''

def injected(path,name):
    text=(ROOT/'extension'/path).read_text()
    start=text.index('export '+('async ' if name!='pickPageContent' else '')+'function '+name)
    text=text[start:]
    end=text.find('\nexport ',10)
    if end>=0:text=text[:end]
    return text.replace('export ','',1)


def main():
    capture=injected('page-capture.js','collectPageCaptureSnapshot')
    pick=injected('page-content-picker.js','pickPageContent')
    details=injected('generic-capture-details.js','collectGenericCaptureDetails')
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch()
        page=browser.new_page(viewport={'width':1200,'height':1000})
        def route(r):
            path=r.request.url.removeprefix(ORIGIN)
            if path.endswith('.png'):return r.fulfill(body=PNG,content_type='image/png')
            if path.startswith('/work/'):
                name=path.rsplit('/',1)[-1]
                return r.fulfill(body=f'<main><video poster="/{name}.png"><source src="/{name}.mp4" type="video/mp4"></video><h1>Full work {name}</h1><h2>Prompt</h2><pre>First line {name}\nSecond line {name}</pre><dl><dt>Model</dt><dd>Creator model</dd></dl><a href="https://creator.example/{name}">Original Source</a></main>',content_type='text/html')
            return r.fulfill(body=PAGE,content_type='text/html')
        page.route(ORIGIN+'/**',route)
        page.goto(ORIGIN+'/catalogue')
        page.evaluate('()=>{'+pick+';window.picked=pickPageContent()}')
        page.locator('.wanted .card').first.click(position={'x':5,'y':5})
        picked=page.evaluate('()=>window.picked')
        assert picked.get('selectionTemplate'), 'Manual selection must return a reusable page-scoped template'
        manual=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
            'manualContentHtml':picked['html'],'selectionTemplate':picked['selectionTemplate'],'sessionId':'manual'})
        assert manual['selectionTemplate']==picked['selectionTemplate']
        assert manual['candidates'][0]['media'][0]['detailRequests'][0]['url']==ORIGIN+'/work/a'
        batch=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
            'listMode':True,'selectionTemplate':picked['selectionTemplate'],'sessionId':'template','maxCandidates':20})
        assert [c['title'] for c in batch['candidates']]==['Work A','Work B'],batch
        assert all('Do not include' not in c['contentText'] for c in batch['candidates'])
        # Selecting only media or prose applies the same relative scope to each peer.
        for selector,kind in [('.wanted .card img','image'),('.wanted .card p','text')]:
            page.evaluate('()=>{'+pick+';window.picked=pickPageContent()}')
            page.locator(selector).first.click()
            scoped=page.evaluate('()=>window.picked')
            scope_batch=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
                'listMode':True,'selectionTemplate':scoped['selectionTemplate'],'sessionId':'scope','maxCandidates':20})
            assert len(scope_batch['candidates'])==2,scope_batch
            if kind=='image':
                assert all(len(c['media'])==1 and c['media'][0]['placement']=='inline' for c in scope_batch['candidates']),scope_batch
                assert all(not c['contentText'] for c in scope_batch['candidates']),scope_batch
                manual_image=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{'manualContentHtml':scoped['html'],'selectionTemplate':scoped['selectionTemplate']})
                assert manual_image['candidates'][0]['media'][0]['detailRequests'][0]['url']==ORIGIN+'/work/a'
            else:
                assert all(not c['media'] for c in scope_batch['candidates']),scope_batch
                assert [c['contentText'] for c in scope_batch['candidates']]==['Selected A original text','Selected B original text']
        requests=[{'url':ORIGIN+'/work/'+name,'sources':[ORIGIN+'/'+name+'.png']} for name in ['a','b']]
        read=page.evaluate('args=>{'+details+';return collectGenericCaptureDetails(...args)}',[requests,{'concurrency':2,'timeoutMs':3000,'maxBytes':100000}])
        assert all(not item.get('error') for item in read),read
        assert [item.get('media',{}).get('url') for item in read]==[ORIGIN+'/a.mp4',ORIGIN+'/b.mp4'],read
        assert read[0]['media']['kind']=='video'
        assert any(block.get('text')=='First line a\nSecond line a' for block in read[0]['blocks']),read[0]
        # Serializing a selected child must not erase an ancestor's unsafe request
        # boundary and turn that link into an allowed GET detail request.
        page.locator('.wanted .card').first.evaluate("node=>node.setAttribute('hx-post','/mutate')")
        page.evaluate('()=>{'+pick+';window.picked=pickPageContent()}')
        page.locator('.wanted .card img').first.click()
        unsafe=page.evaluate('()=>window.picked')
        unsafe_manual=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
            'manualContentHtml':unsafe['html'],'selectionTemplate':unsafe['selectionTemplate']})
        assert not unsafe_manual['candidates'][0]['media'][0].get('detailRequests'),unsafe_manual
        page.locator('[data-promptdirector-capture-template]').evaluate("node=>node.removeAttribute('data-promptdirector-capture-template')")
        missing=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
            'listMode':True,'selectionTemplate':unsafe['selectionTemplate'],'serializeErrors':True})
        assert missing.get('captureError',{}).get('code')=='CAPTURE_TEMPLATE_EXPIRED',missing
        page.goto(ORIGIN+'/different-page')
        stale=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
            'listMode':True,'selectionTemplate':picked['selectionTemplate'],'serializeErrors':True})
        assert stale.get('captureError',{}).get('code')=='CAPTURE_TEMPLATE_EXPIRED',stale
        browser.close()
    print('PASS: manual detail references, chosen repeated list only, paired detail video/original text, expired template stops')

if __name__=='__main__':main()
