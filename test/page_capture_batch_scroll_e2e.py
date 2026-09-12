"""Real virtual scrolling: >30 steps, >100 cases, exhaustion and cancellation."""
from e2e_support import extension_session, wait_for_async_condition
from page_capture_e2e import FIXTURE_ORIGIN, PNG
from generic_scroll_capture_e2e import FEED


def main():
    html=FEED.replace('height:2800px','height:36600px').replace('4,10-first','4,140-first').replace("scroll.addEventListener('scroll',()=>setTimeout(render,40));", "window.scanScrolls=0;scroll.addEventListener('scroll',()=>{window.scanScrolls++;setTimeout(render,40)});")
    with extension_session('pd-batch-scroll-') as run:
        run.context.route(FIXTURE_ORIGIN+'/**',lambda r:r.fulfill(body=PNG if r.request.url.endswith('.png') else html,content_type='image/png' if r.request.url.endswith('.png') else 'text/html'))
        panel=run.open_page('collector.html')
        page=run.context.new_page();page.goto(FIXTURE_ORIGIN+'/scale-feed');page.bring_to_front()
        page.locator('#scroll').evaluate('e=>e.scrollTop=520')
        response=panel.evaluate("()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'list',targetCount:150})")
        assert response['ok'],response
        cases=response['batch']['candidates']
        assert len(cases)==140,len(cases)
        assert len({c['canonicalUrl'] for c in cases})==140
        assert all(c['media'] for c in cases)
        steps=page.evaluate('scanScrolls');assert steps>30,steps
        assert response['batch']['stopReason']=='no-next-page',response['batch']['stopReason']
        assert page.locator('#scroll').evaluate('e=>e.scrollTop')==520
        # Start another real scan and cancel it while it is traversing.
        panel.evaluate("()=>{window.scanResult=null;chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'list',targetCount:150}).then(r=>window.scanResult=r);}")
        page.wait_for_function('scanScrolls > '+str(steps+2))
        result=panel.evaluate("()=>chrome.runtime.sendMessage({type:'CANCEL_PAGE_CAPTURE'})")
        assert result['ok'],result
        cancelled=wait_for_async_condition(panel,'()=>window.scanResult',timeout=30000)
        assert cancelled['batch']['stopReason']=='cancelled',cancelled
        assert page.locator('#scroll').evaluate('e=>e.scrollTop')==520
        assert panel.evaluate("()=>chrome.storage.local.get('entries').then(s=>(s.entries||[]).length)")==0
        for target in [0,-1,1.5,'invalid']:
            invalid=panel.evaluate("targetCount=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'list',targetCount})",target)
            assert not invalid['ok'],invalid
        print({'virtualCases':140,'scrollEvents':steps,'exhaustionReported':True,'cancelledAndRestored':True,'invalidTargetsRejected':True})


if __name__=='__main__':main()
