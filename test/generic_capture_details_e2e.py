"""Read-only generic details: attribution, save/readback, failure and no specialist changes."""
from e2e_support import extension_session
from playwright.sync_api import expect
from page_capture_e2e import FIXTURE_ORIGIN, PNG
PAGE='''<html><head><title>Reference library</title><style>img{width:180px;height:120px}</style></head><body><main>
<h1>Reference library</h1><h2>First technique</h2><img src="/a.png" alt="Clip A" hx-get="/details/a" hx-target="#dialog">
<h2>Second technique</h2><a href="/details/b"><img src="/b.png" alt="Clip B"></a>
<img src="/c.png" alt="Clip C" hx-get="/details/wrong"><img src="/d.png" alt="Clip D" hx-get="/details/fail">
<a href="/delete/item"><img src="/e.png" alt="Keep me"></a></main><div id="dialog"></div></body></html>'''
with extension_session('pd-generic-details-') as run:
    requests=[]
    def route(r):
        path=r.request.url.split(FIXTURE_ORIGIN)[-1]; requests.append(path)
        if path.endswith('.png'): return r.fulfill(body=PNG,content_type='image/png')
        if path=='/details/limited': return r.fulfill(status=429,body='rate limited',content_type='text/html')
        if path=='/details/fail': return r.fulfill(status=500,body='failed',content_type='text/html')
        if path.startswith('/details/'):
            name=path.rsplit('/',1)[-1]
            html=f'<main><img src="/{name}.png"><h1>Full work {name}</h1><div>Complete description {name}.</div><ul><li>Director: Creator {name}</li><li>Original Source <a href="https://original.example/{name}">Link</a></li></ul><a title="Download" href="/downloads/{name}">Download</a></main>'
            return r.fulfill(body=html,content_type='text/html')
        return r.fulfill(body=PAGE,content_type='text/html')
    run.context.route(FIXTURE_ORIGIN+'/**',route)
    panel=run.open_page('collector.html');source=run.context.new_page();source.goto(FIXTURE_ORIGIN+'/catalogue');source.bring_to_front()
    response=panel.evaluate("()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
    assert response['ok'],response
    assert not any(path.startswith('/details/') for path in requests), 'Default capture must not load secondary details'
    response=panel.evaluate("""async batch=>{const m=await import('./generic-capture-details.js');
      const r=await chrome.runtime.sendMessage({type:'READ_PAGE_CAPTURE_DETAILS',tabId:batch.tabId,requests:m.genericDetailRequests(batch),requestId:'detail-test'});
      return {...r,batch:m.applyGenericCaptureDetails(batch,r.details)};
    }""",response['batch'])
    assert response['ok'],response
    c=response['batch']['candidates'][0]
    assert '/delete/item' not in requests,requests
    assert len(c['media'])==5,len(c['media'])
    assert 'Complete description a.' in c['contentText'],c['contentText']
    assert 'Complete description wrong.' not in c['contentText']
    assert len(c['possibleOmissions'])==2,c['possibleOmissions']
    groups=panel.evaluate("async c=>(await import('./generic-capture-groups.js')).groupGenericCapture(c,'media')",c)
    a=next(g for g in groups if g['media'] and g['media'][0]['alt']=='Clip A')
    assert 'Complete description a.' in a['contentText'] and 'Creator a' in a['contentText'],a['contentText']
    assert 'description b' not in a['contentText']
    assert a['media'][0]['originalWorkUrl']=='https://original.example/a'
    assert any(b.get('sourceUrl')=='https://original.example/a' for b in a['articleDocument']['blocks'])
    assert any(b.get('sourceUrl')==FIXTURE_ORIGIN+'/downloads/a' for b in a['articleDocument']['blocks'])
    saved=panel.evaluate("""async ({response,a})=>{
      const {normalizePageCaptureBatch}=await import('./page-capture.js');
      const batch=normalizePageCaptureBatch({...response.batch,candidates:[a],selections:[{candidateId:a.id,includeText:true,selectedMediaIds:a.media.map(m=>m.id),mediaDecision:'confirmed'}]});
      return chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});
    }""",{'response':response,'a':a})
    assert saved['ok'],saved
    panel.reload()
    entries=panel.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
    entry=next(e for e in entries if 'Full work a' in e['title'])
    assert 'Complete description a.' in entry['text'] and 'Creator a' in entry['text'],entry['text']
    assert any(b.get('sourceUrl')=='https://original.example/a' for b in entry['articleDocument']['blocks'])
    assert any(m.get('originalWorkUrl')=='https://original.example/a' for m in entry['mediaAssets']),entry['mediaAssets']
    print('PASS: explicit GET and ordinary detail links, full attribution, wrong-work rejection, failure keeps media, destructive links ignored, standalone grouping owns its details')
    func=panel.evaluate("async()=>(await import('./generic-capture-details.js')).collectGenericCaptureDetails.toString()")
    before=len(requests)
    limited=source.evaluate("args=>("+func+")(...args)",[[{'url':FIXTURE_ORIGIN+'/details/limited','sources':[]},{'url':FIXTURE_ORIGIN+'/details/not-requested','sources':[]}],{'concurrency':1,'timeoutMs':30000,'maxBytes':1048576}])
    assert len(limited)==2 and all(d.get('error') for d in limited)
    assert '/details/not-requested' not in requests[before:]
    print('PASS: saved original and full metadata survive reload; rate limit stops remaining requests and reports them')

    panel.evaluate("()=>chrome.storage.local.set({capturePermissionOnboarding:{version:1,acknowledgedAt:new Date().toISOString(),clipboardIncluded:true}})")
    panel.reload()
    source.bring_to_front()
    panel.locator('#start-page-capture').evaluate('e=>e.click()')
    option=panel.locator('#page-capture-details')
    expect(option).to_be_visible();expect(option).not_to_be_checked()
    if panel.locator('.page-capture-confirm').first.get_attribute('aria-pressed')!='true': panel.locator('.page-capture-confirm').first.click()
    panel.set_viewport_size({'width':390,'height':850})
    panel.screenshot(path='/tmp/pd-detail-optin-default.png',full_page=True)
    assert "![Clip" not in panel.locator(".page-capture-item").first.inner_text()
    before_ui=len(requests)
    option.check()
    expect(option).to_be_disabled()
    expect(panel.locator('#page-capture-mode')).to_be_enabled(timeout=30000)
    expect(option).to_be_checked()
    assert any(path.startswith('/details/') for path in requests[before_ui:])
    expect(panel.locator('.page-capture-item.confirmed')).to_have_count(1)
    panel.set_viewport_size({'width':390,'height':850})
    assert panel.evaluate('document.documentElement.scrollWidth<=innerWidth')
    panel.screenshot(path='/tmp/pd-detail-optin.png',full_page=True)
    print('PASS: visible unchecked opt-in, explicit click fetches details, selection retained, narrow layout')
    panel.locator('#page-capture-undo-region').click()
    expect(option).not_to_be_checked();expect(option).to_be_enabled()
    pending_routes=[]
    source.route('**/details/**',lambda r:pending_routes.append(r))
    option.check()
    expect(panel.locator('#page-capture-cancel')).to_have_text('停止扫描')
    panel.locator('#page-capture-cancel').click()
    expect(panel.locator('#page-capture-mode')).to_be_enabled()
    expect(option).not_to_be_checked()
    expect(panel.locator('.page-capture-item.confirmed')).to_have_count(1)
    assert panel.locator('.page-capture-thumbnail').count()==5
    print('PASS: undo and cancellation restore the base capture and manual selection')
    for route_pending in pending_routes:
        try: route_pending.abort()
        except Exception: pass
    source.unroute('**/details/**')
