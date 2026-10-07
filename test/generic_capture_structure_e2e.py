"""Repeated table-of-contents labels must not steal headings or cross-section media."""
from e2e_support import extension_session
from page_capture_e2e import FIXTURE_ORIGIN, PNG
PAGE='''<html><head><title>All transitions</title><style>img{width:180px;height:120px}</style></head><body><main>
<h1>All transitions</h1><p>A catalogue with individual techniques and overlapping reference clips.</p>
<ul><li><a href="#" data-target="arc">Arc transition</a></li><li><a href="#" data-target="wipe">Wipe Transition</a></li></ul>
<div id="arc"><h1>Arc transition</h1><p>Camera movement description.</p></div>
<div><img src="/shared.png" alt="Shared clip"><img src="/arc.png" alt="Made for Heroes. Worn by Icons"></div>
<div id="wipe"><h1>Wipe Transition</h1><p>Scene wipe description.</p></div>
<div><img src="/shared.png" alt="Shared clip"><img src="/wipe.png" alt="Another clip"></div>
</main></body></html>'''
with extension_session('pd-generic-structure-') as run:
    run.context.route(FIXTURE_ORIGIN+'/**',lambda r:r.fulfill(body=PNG if r.request.url.endswith('.png') else PAGE,content_type='image/png' if r.request.url.endswith('.png') else 'text/html'))
    panel=run.open_page('collector.html');source=run.context.new_page();source.goto(FIXTURE_ORIGIN+'/structure');source.bring_to_front()
    response=panel.evaluate("()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
    assert response['ok'],response
    candidate=response['batch']['candidates'][0]
    result=panel.evaluate("async c=>(await import('./generic-capture-groups.js')).groupGenericCapture(c,'sections')",candidate)
    groups=[g for g in result if g['batchStructureStatus']!='review']
    assert [g['title'] for g in groups]==['Arc transition','Wipe Transition'],[(g['title'],len(g['media'])) for g in groups]
    assert [len(g['media']) for g in groups]==[2,2]
    assert len(candidate['media'])==3
    assert 'Camera movement description.' in groups[0]['contentText']
    assert 'Scene wipe description.' in groups[1]['contentText']
    assert len([b for b in candidate['articleDocument']['blocks'] if b['kind']=='image'])==4
    assert candidate['title']=='All transitions'
    print('PASS: table-of-contents collisions, repeated original in both groups, complete page title, short descriptions and artwork named Icons')
