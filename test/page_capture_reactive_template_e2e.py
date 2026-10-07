"""Minimal replay of melies.co/cinematic-techniques media lifecycle observed live.

The real page uses a.cinematic-tile > span.cine-media > img/video, inside a
cinematic-wall. On 2026-10-07 a selected hover video was removed when its tile
left the viewport; the existing poster img remained. This fixture reproduces
that lifecycle and structure, with synthetic content and locally routed media.
"""
from playwright.sync_api import sync_playwright
from generic_capture_template_details_e2e import injected, PNG, ORIGIN

PAGE='''<html><style>.cinematic-wall{display:flex;gap:20px}.cinematic-tile{display:block;width:300px}.cine-media{display:block}img,video{width:300px;height:160px}</style><body><main><section>
<div class="cinematic-wall">
<a class="cinematic-tile" href="/work/a"><span class="cine-media"><img src="/a.png" alt="Work A"><video src="/a.mp4" poster="/a.png"></video></span><span class="cinematic-tile__caption">Work A</span></a>
<a class="cinematic-tile" href="/work/b"><span class="cine-media"><img src="/b.png" alt="Work B"></span><span class="cinematic-tile__caption">Work B</span></a>
</div></section><section><div class="cinematic-wall"><a class="cinematic-tile" href="/work/c"><span class="cine-media"><img src="/c.png" alt="Other work"></span><span>Other work</span></a></div></section></main></body></html>'''

def main():
    capture=injected('page-capture.js','collectPageCaptureSnapshot')
    pick=injected('page-content-picker.js','pickPageContent')
    details=injected('generic-capture-details.js','collectGenericCaptureDetails')
    with sync_playwright() as p:
        browser=p.chromium.launch();page=browser.new_page()
        page.route(ORIGIN+'/**',lambda r:r.fulfill(body=PNG,content_type='image/png') if r.request.url.endswith('.png') else r.fulfill(body=PAGE,content_type='text/html'))
        page.goto(ORIGIN+'/cinematic-techniques')
        page.evaluate('()=>{'+pick+';window.picked=pickPageContent()}')
        page.locator('video').click()
        picked=page.evaluate('()=>window.picked')
        # Same source page and same card, only the transient preview was removed.
        page.locator('video').evaluate('node=>node.remove()')
        result=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
            'selectionTemplate':picked['selectionTemplate'],'listMode':True,'maxCandidates':3,'serializeErrors':True})
        assert not result.get('captureError'),result.get('captureError')
        assert len(result['candidates'])==2,result
        assert [c['media'][0]['url'] for c in result['candidates']]==[ORIGIN+'/a.png',ORIGIN+'/b.png'],result
        assert all(len(c['media'])==1 and not c['contentText'] for c in result['candidates']),result
        # Recycled containers for a different work must still invalidate selection.
        page.locator('.cinematic-tile img').first.evaluate("node=>node.src='/unrelated.png'")
        changed=page.evaluate('options=>{'+capture+';return collectPageCaptureSnapshot(options)}',{
            'selectionTemplate':picked['selectionTemplate'],'listMode':True,'serializeErrors':True})
        assert changed.get('captureError',{}).get('code')=='CAPTURE_TEMPLATE_EXPIRED',changed
        # The real work page's primary video has no poster attribute. Its full
        # asset stem appears in the source thumbnail; copyable original text is
        # inside a button, separate from the explanatory prose under "Prompt it".
        detail_html='''<html><link rel="canonical" href="/work/alpha"><article><h1>Work Alpha</h1><aside><button aria-label="Open preview"><video src="/mini/asset-alpha.mp4"></video></button></aside><h2>Prompt it</h2><p>How to write a prompt for this shot.</p><button aria-label="Copy prompt"><pre>Complete original first line\nComplete original second line</pre></button></article></html>'''
        page.route(ORIGIN+'/work/alpha',lambda r:r.fulfill(body=detail_html,content_type='text/html'))
        args=[[{'url':ORIGIN+'/work/alpha','sources':[ORIGIN+'/thumb/work-alpha-asset-alpha.png']}],{'concurrency':1,'timeoutMs':3000,'maxBytes':100000}]
        read=page.evaluate('args=>{'+details+';return collectGenericCaptureDetails(...args)}',args)
        assert not read[0].get('error'),read
        assert read[0]['media']['url']==ORIGIN+'/mini/asset-alpha.mp4',read
        assert read[0]['originalPrompt']=='Complete original first line\nComplete original second line',read
        args[0][0]['sources']=[ORIGIN+'/thumb/work-beta-asset-beta.png']
        wrong=page.evaluate('args=>{'+details+';return collectGenericCaptureDetails(...args)}',args)
        assert wrong[0].get('error') and not wrong[0].get('media'),wrong
        browser.close()
    print('PASS: same-card hover replacement retains exact media scope; different work expires')

    from playwright.sync_api import expect
    from page_capture_manual_template_save_e2e import main as save_roundtrip
    def reselect_and_unmount(source,panel):
        previous=panel.evaluate("()=>captureCalls.filter(call=>call.message.type==='PICK_PAGE_CONTENT').at(-1).response.batch.selectionTemplate")
        source.bring_to_front()
        panel.locator('#add-selection').evaluate('button=>button.click()')
        expect(source.locator('#promptdirector-content-picker')).to_be_attached()
        source.locator('video').nth(1).click()
        panel.wait_for_function("()=>captureCalls.filter(call=>call.message.type==='PICK_PAGE_CONTENT').length===2")
        latest=panel.evaluate("()=>captureCalls.filter(call=>call.message.type==='PICK_PAGE_CONTENT').at(-1).response.batch.selectionTemplate")
        assert previous['marker']!=latest['marker']
        source.locator('video').evaluate_all('nodes=>nodes.forEach(node=>node.remove())')
        assert source.locator('[data-promptdirector-capture-template]').count()==1
    def localized_failure_keeps_preview(source,panel,evidence):
        for locale,expected in [('en','Your selection is no longer available. Select a case on the current page again.'),
            ('zh-CN','手选范围已失效，请在当前页面重新选择一个案例')]:
            panel.evaluate("locale=>chrome.storage.local.set({uiPreferences:{locale,theme:'dark',motion:'reduced'}})",locale)
            panel.reload(wait_until='networkidle')
            source.bring_to_front()
            panel.locator('#start-selection').evaluate('button=>button.click()')
            expect(source.locator('#promptdirector-content-picker')).to_be_attached()
            source.locator('.cinematic-tile img').first.click()
            expect(panel.locator('.page-capture-item')).to_have_count(1)
            source.locator('[data-promptdirector-capture-template]').evaluate("node=>node.removeAttribute('data-promptdirector-capture-template')")
            panel.locator('#page-capture-mode').select_option('list')
            panel.locator('#page-capture-target-count').fill('3')
            source.bring_to_front()
            panel.locator('#page-capture-list-run').evaluate('button=>button.click()')
            expect(panel.locator('#page-capture-help')).to_have_text(expected)
            expect(panel.locator('#feedback')).to_have_text('')
            expect(panel.locator('.page-capture-item')).to_have_count(1)
            panel.screenshot(path=str(evidence/f'expired-{locale}.png'),full_page=True)
    save_roundtrip(page_html=PAGE.replace('<img src="/b.png" alt="Work B">','<img src="/b.png" alt="Work B"><video src="/b.mp4" poster="/b.png"></video>'),
        selection_selector='video',after_pick=reselect_and_unmount,after_save=localized_failure_keeps_preview)

if __name__=='__main__':main()
