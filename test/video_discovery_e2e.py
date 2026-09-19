"""Real webRequest delivery with routed synthetic responses, not downloadable-video acceptance."""
from e2e_support import extension_session

def main():
    with extension_session('video-discovery-') as run:
        origin='https://wchao6891.github.io'
        run.context.route(origin+'/sniff-*',lambda route:route.fulfill(content_type='video/mp4' if '.mp4' in route.request.url else 'text/html',body=b'fixture'))
        setup=run.open_page('collector.html',wait_until='networkidle')
        page=run.context.new_page();page.goto(origin+'/sniff-page')
        tab=setup.evaluate("async()=> (await chrome.tabs.query({active:true,currentWindow:true}))[0].id")
        page.evaluate("async()=>{await fetch('/sniff-video.mp4?range=0-1');await fetch('/sniff-video.mp4?range=2-3');}")
        setup.wait_for_function("async id=>(await chrome.action.getBadgeText({tabId:id}))==='1'",arg=tab)
        state=setup.evaluate("async id=>(await chrome.storage.session.get('videoDiscovery:'+id))['videoDiscovery:'+id]",tab)
        assert len(state)==1 and state[0]['mimeType']=='video/mp4',state
        page.goto(origin+'/sniff-next')
        setup.wait_for_function("async id=>(await chrome.action.getBadgeText({tabId:id}))===''",arg=tab)
        print('PASS: real network observation; range dedup; badge=1; navigation clears badge')
if __name__=='__main__':main()
