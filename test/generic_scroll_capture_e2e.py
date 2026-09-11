"""Unregistered-site fixtures: semantic articles, internal scroll and virtualized blocks."""
from e2e_support import extension_session
from page_capture_e2e import FIXTURE_ORIGIN, PNG


def document_fixture(role=False):
    opening = '<section id="scroll" style="height:400px;overflow:auto"><div role="main"><div role="document"' if role else '<main><div id="scroll" style="height:400px;overflow:auto"><article'
    closing = '</div></div></section>' if role else '</article></div></main>'
    return '''<html><head><title>Unregistered document</title></head><body>
<aside style="height:150px;overflow:auto"><div style="height:6000px">SIDEBAR MUST NOT BE CAPTURED</div></aside>'''+opening+''' style="height:4600px;position:relative"><h1 id="title">Unregistered document</h1><div id="blocks"></div>
<table id="table" style="position:absolute;top:4100px"><tr><td rowspan="2">Source column</td><td><p>Before image</p><img width="160" height="120" src="/inside.png"><p>After image</p></td></tr><tr><td>Final cell</td></tr></table>'''+closing+'''
<script>
const scroll=document.querySelector('#scroll');
function render(){const first=Math.max(0,Math.floor((scroll.scrollTop-100)/220)-1);document.querySelector('#blocks').innerHTML=Array.from({length:Math.min(4,18-first)},(_,n)=>{const i=first+n;return `<p id="paragraph-${i}" style="position:absolute;top:${100+i*220}px">Section ${i}: preserved text from a virtual document.</p>`}).join('');}
scroll.addEventListener('scroll',()=>{scroll.setAttribute('aria-busy','true');setTimeout(()=>{render();scroll.setAttribute('aria-busy','false');},220);});render();
</script></body></html>'''


FEED = """<html><head><title>Unknown gallery</title></head><body><aside style="height:120px;overflow:auto"><p style="height:5000px">SIDEBAR</p></aside><main id="scroll" style="height:400px;overflow:auto"><div style="height:2800px;position:relative" id="feed"></div></main><script>
const scroll=document.querySelector('#scroll');
function render(){let first=Math.max(0,Math.floor(scroll.scrollTop/260)-1);document.querySelector('#feed').innerHTML=Array.from({length:Math.min(4,10-first)},(_,n)=>{let i=first+n;return `<article style="position:absolute;top:${i*260}px"><a href="/work/${i}"><h2>Work ${i}</h2></a><p>Independent work number ${i}, retain its own description.</p><img src="/work-${i}.png" width="160" height="120"></article>`}).join('');}
scroll.addEventListener('scroll',()=>setTimeout(render,40));render();
</script></body></html>"""

def main():
    with extension_session('pd-generic-scroll-') as run:
        run.context.route(FIXTURE_ORIGIN+'/**', lambda r: r.fulfill(body=PNG,content_type='image/png') if r.request.url.endswith('.png') else r.fulfill(body=(FEED.replace('<main id=', '<main><section id=').replace('</div></main><script>', '</div></section></main><script>') if r.request.url.endswith('/feed-inner') else FEED) if '/feed' in r.request.url else document_fixture(r.request.url.endswith('/roles')),content_type='text/html'))
        collector=run.open_page('collector.html')
        run.seed_storage(collector,{'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-12T00:00:00Z','clipboardIncluded':True}})
        page=run.context.new_page()
        for path in ['/semantic','/roles']:
            page.goto(FIXTURE_ORIGIN+path)
            page.locator('#scroll').evaluate('e=>e.scrollTop=440')
            page.bring_to_front()
            response=collector.evaluate("async mode=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode})", "loaded" if path=="/semantic" else "whole")
            assert response['ok'],response
            batch=response['batch'];assert len(batch['candidates'])==1,batch
            case=batch['candidates'][0]
            assert case['adapter']=='generic',case['adapter']
            for i in range(18):
                assert f'Section {i}:' in case['contentText'],(i,case['contentText'])
            assert 'SIDEBAR' not in case['contentText']
            assert case['completeness']=='complete',case['extraction']
            assert page.locator('#scroll').evaluate('e=>e.scrollTop')==440
            assert page.locator('aside').evaluate('e=>e.scrollTop')==0
            batch['selections']=[{'candidateId':case['id'],'includeText':True,'selectedMediaIds':[m['id'] for m in case['media']],'mediaDecision':'confirmed'}]
            saved=collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})",batch)
            assert saved['ok'],saved
            entry_id=saved['results'][0]['entryId']
            library=run.open_page('library.html?case='+entry_id)
            library.locator('.article-structured-table img').wait_for()
            text=library.locator('.article-document-reader').inner_text()
            assert text.index('Section 0:') < text.index('Section 17:') < text.index('Source column'),text
            assert library.locator('.article-structured-table tr').first.locator('td').first.get_attribute('rowspan')=='2'
            library.close()
        # A deliberately tiny scan budget must not be reported as a complete document.
        page.bring_to_front()
        from pathlib import Path
        source=Path('extension/page-capture.js').read_text()
        function=source[source.index('export async function collectPageCaptureSnapshot'):]
        # Invoke the shipped self-contained function with a test-only traversal budget.
        function=function[:function.index('\nexport ',10)] if '\nexport ' in function[10:] else function
        snapshot=page.evaluate('async()=>{'+function.replace('export async','async',1)+';return collectPageCaptureSnapshot({mode:"whole",maxScrollSteps:1,maxMedia:24});}')
        assert snapshot['candidates'][0]['completeness']=='partial'
        for feed_path in ['/feed','/feed-inner']:
            page.goto(FIXTURE_ORIGIN+feed_path)
            page.locator('#scroll').evaluate('e=>e.scrollTop=520')
            page.bring_to_front()
            response=collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'whole'})")
            assert response['ok'],response
            works=response['batch']['candidates']
            assert len(works)==10,[(c['title'],c['canonicalUrl']) for c in works]
            assert {c['canonicalUrl'] for c in works}=={FIXTURE_ORIGIN+'/work/'+str(i) for i in range(10)}
            assert page.locator('#scroll').evaluate('e=>e.scrollTop')==520
            assert page.locator('aside').evaluate('e=>e.scrollTop')==0
        print('PASS: two unregistered virtual document structures retain 18 ordered sections, table/media placement, restore scroll, report a limited scan as partial, and collect 10 independent works from two internal feed layouts')

if __name__=='__main__': main()
