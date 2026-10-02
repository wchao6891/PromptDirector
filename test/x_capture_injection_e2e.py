"""X scan regression through the real Chrome injection and capture message boundary."""
import json
import tempfile
from pathlib import Path
from e2e_support import EXTENSION_DIR, extension_session

MAIN = 'https://x.com/director/status/123'


def post(post_id, text):
    return f'<article data-testid="tweet"><div data-testid="User-Name"><a href="/director">Director</a></div><div data-testid="tweetText">{text}</div><a href="/director/status/{post_id}"><time>Today</time></a></article>'


def main():
    with tempfile.TemporaryDirectory(prefix='x-injection-runtime-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name != 'manifest.json':
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += ['https://x.com/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-x-injection-', extension_dir=extension) as run:
            collector = run.open_page('collector.html')
            reply = post(124,'Own reply in a narrower conversation cell.').replace('</article>', '<video src="https://video.twimg.com/own.mp4"></video></article>')
            markup = f'<main><div data-testid="primaryColumn">{post(123,"Original post must remain collectible.")}<div id="urt:conversation:124">{reply}</div></div></main>'
            run.context.route('https://x.com/**', lambda r: r.fulfill(body=markup, content_type='text/html'))
            video = (Path(__file__).parent/'fixtures/detail-portrait-smoke.mp4').read_bytes()
            run.context.route('https://video.twimg.com/**', lambda r: r.fulfill(body=video, content_type='video/mp4'))
            source = run.context.new_page()
            source.goto(MAIN)
            source.bring_to_front()
            response = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert response.get('ok'), 'A narrower X conversation cell must not hide the real root and become “当前网页没有识别到可保存的正文、作品或媒体”'
            candidates = response['batch']['candidates']
            assert len(candidates) == 1 and candidates[0]['canonicalUrl'] == MAIN
            assert candidates[0]['contentText'] == 'Original post must remain collectible.'
            assert len(candidates[0]['supplements']) == 1
            full = 'Complete selected prompt. '*1000+'END OF FULL SELECTED PROMPT'
            source.evaluate("text=>{const body=document.getElementById('urt:conversation:124').querySelector('[data-testid=tweetText]');body.innerHTML='Short preview <button data-testid=\"tweet-text-show-more-link\">Show more</button>';body.querySelector('button').onclick=()=>body.textContent=text}", full)
            source.evaluate("()=>document.querySelector('[data-testid=primaryColumn]').insertAdjacentHTML('beforeend','<div id=unrelated-loading role=progressbar></div>')")
            own_ready = collector.evaluate("""async()=>{
              const fn=(await import('./page-capture.js')).collectPageCaptureSnapshot;
              const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
              const [result]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:fn,args:[{serializeErrors:true,xSupplementInThread:true,xSupplementUrl:'https://x.com/director/status/124',mediaTimeoutMs:600}]});
              return result.result;
            }""")
            assert own_ready.get('supplement',{}).get('text') == full, 'An unrelated community-loading spinner must not consume the selected comment’s entire read deadline'
            source.evaluate("()=>document.querySelector('#unrelated-loading').remove()")
            before_pages = len(run.context.pages)
            selected = collector.evaluate("""async()=>{
              const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
              return chrome.runtime.sendMessage({type:'READ_PAGE_CAPTURE_SUPPLEMENT',sourceTabId:tab.id,sourceUrl:tab.url,supplement:{id:'selected',sourceUrl:'https://x.com/director/status/124'}});
            }""")
            assert selected.get('ok') and selected['supplement']['text'] == full, selected
            assert selected['supplement']['media'][0]['kind'] == 'video' and selected['supplement']['media'][0]['url'] == 'https://video.twimg.com/own.mp4'
            assert len(run.context.pages) == before_pages and source.url == MAIN and source.evaluate('window.scrollY') == 0, 'A mounted selected reply must finish without opening, activating or reloading another tab'
            source.evaluate("""markup=>{
              const column=document.querySelector('[data-testid=primaryColumn]');const root=column.querySelector('article');
              column.insertAdjacentHTML('beforeend','<div style="height:3000px"></div><div id=offscreen-loading role=progressbar style="height:20px"></div>');
              window.addEventListener('scroll',()=>{
                if(window.scrollY>800&&!document.querySelector('[data-late-reply]')){
                  column.insertAdjacentHTML('beforeend','<div data-late-reply>'+markup+'</div>');root.remove();
                }else if(window.scrollY===0&&!root.isConnected) column.prepend(root);
              });
            }""", post(125,'Later selected reply survives virtualization.').replace('</article>', '<video src="https://video.twimg.com/own.mp4"></video></article>'))
            offscreen = collector.evaluate("""async()=>{
              const fn=(await import('./page-capture.js')).collectPageCaptureSnapshot;
              const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
              return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:fn,args:[{serializeErrors:true,xSupplementInThread:true,xSupplementUrl:'https://x.com/director/status/125',mediaTimeoutMs:1500}]}))[0].result;
            }""")
            assert offscreen.get('supplement',{}).get('text') == 'Later selected reply survives virtualization.', 'A loading indicator far outside the current viewport must not prevent scrolling to the selected reply'
            source.evaluate("()=>document.querySelector('#offscreen-loading').remove()")
            source.evaluate("()=>{document.querySelector('[data-late-reply]').remove();const loading=document.createElement('div');loading.id='hidden-unrelated-loading';loading.setAttribute('role','progressbar');loading.style='position:fixed;top:100px;height:20px;visibility:hidden';document.querySelector('[data-testid=primaryColumn]').append(loading)}")
            hidden_loading = collector.evaluate("""async()=>{
              const fn=(await import('./page-capture.js')).collectPageCaptureSnapshot;
              const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
              return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:fn,args:[{serializeErrors:true,xSupplementInThread:true,xSupplementUrl:'https://x.com/director/status/125',mediaTimeoutMs:1500}]}))[0].result;
            }""")
            assert hidden_loading.get('supplement',{}).get('text') == 'Later selected reply survives virtualization.', 'An X loading indicator hidden by CSS must not consume the entire deadline while seeking the selected reply'
            source.evaluate("()=>document.querySelector('#hidden-unrelated-loading').remove()")
            later_selected = collector.evaluate("""async()=>{
              const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
              return chrome.runtime.sendMessage({type:'READ_PAGE_CAPTURE_SUPPLEMENT',sourceTabId:tab.id,sourceUrl:tab.url,supplement:{id:'later',sourceUrl:'https://x.com/director/status/125'}});
            }""")
            assert later_selected.get('ok') and later_selected['supplement']['text'] == 'Later selected reply survives virtualization.', later_selected
            assert later_selected['supplement']['media'][0]['kind'] == 'video'
            assert source.url == MAIN and source.evaluate('window.scrollY') == 0
            source.evaluate("()=>{const canonical=document.createElement('link');canonical.rel='canonical';canonical.href='https://x.com/director/status/999';document.head.append(canonical)}")
            stale = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert stale.get('ok') and stale['batch']['candidates'][0]['canonicalUrl'] == MAIN, 'SPA metadata from the previous post must not override the current source route'
            source.evaluate("()=>{const root=document.querySelector('article');root.remove();setTimeout(()=>document.querySelector('[data-testid=primaryColumn]').prepend(root),500)}")
            late = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert late.get('ok') and late['batch']['candidates'][0]['canonicalUrl'] == MAIN, 'A temporarily unmounted source must wait for its own post instead of rejecting after one quiet render interval'
            source.evaluate("""()=>{
              const root=document.querySelector('article');
              const observer=new MutationObserver(()=>{
                if(root.hasAttribute('data-promptdirector-capture-region')){observer.disconnect();history.replaceState({},'','/director/status/999')}
              });
              observer.observe(root,{attributes:true,attributeFilter:['data-promptdirector-capture-region']});
            }""")
            changed = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert not changed.get('ok') and '采集页面已改变' in changed.get('message',''), changed
            assert '当前网页没有识别到' not in changed['message'], 'Chrome promise rejection must not masquerade as an empty webpage'
            print({'real_injection_root_and_reply': True, 'source_selected_full_text_and_video': True, 'unrelated_timeline_loading_ignored': True, 'css_hidden_loading_does_not_block_seeking': True, 'offscreen_loading_ignored': True, 'later_virtualized_reply': True, 'no_temporary_tab_or_navigation': True, 'stale_canonical_ignored': True, 'late_source_root': True, 'page_change_error_crosses_real_chrome_boundary': True})


if __name__ == '__main__':
    main()
