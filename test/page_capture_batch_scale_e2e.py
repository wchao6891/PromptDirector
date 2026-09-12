"""Synthetic paginated source, real extension collection and isolated storage readback."""
from pathlib import Path
import tempfile
from playwright.sync_api import expect
from e2e_support import extension_session
from page_capture_e2e import FIXTURE_ORIGIN
import re, struct, zlib

def artwork(url):
    match = re.search(r"scale-(\d+)", url)
    index = int(match[1]) if match else 0
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    row = bytes([index, 80, 150, 255]) * 64
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 64, 64, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress((b"\0" + row) * 64)) + chunk(b"IEND", b"")


def listing(second=False):
    ids = range(61, 121) if second else range(1, 71)
    cards = ''.join(f'<div class="work-card"><a href="/work/{i}"><h2>Scale Work {i}</h2></a><h3>Prompt</h3><p>Creative prompt for list work {i}.</p><img src="/scale-{i}.png" style="width:320px;height:320px"></div>' for i in ids)
    link = '' if second else '<a rel="next" href="/scale?page=2">Next</a>'
    return f'<html><head><title>Scale fixture</title></head><body><main>{cards}</main>{link}<script>window.scrollEvents=0;addEventListener("scroll",()=>window.scrollEvents++)</script></body></html>'


def main():
    with extension_session('pd-batch-scale-') as run:
        run.context.route(FIXTURE_ORIGIN+'/**', lambda r:r.fulfill(body=listing('page=2' in r.request.url) if '/scale?' in r.request.url else artwork(r.request.url), content_type='text/html' if '/scale?' in r.request.url else 'image/png'))
        p=run.open_page('collector.html',wait_until='networkidle')
        p.set_viewport_size({'width':390,'height':844})
        run.seed_storage(p,{'entries':[], 'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-12T00:00:00Z','clipboardIncluded':True}})
        page=run.context.new_page(); page.goto(FIXTURE_ORIGIN+'/scale?page=1'); page.bring_to_front()
        p.locator('#start-page-capture').evaluate('e=>e.click()')
        expect(p.locator('.page-capture-confirm').first).to_be_visible(timeout=20000)
        p.locator('.page-capture-confirm').first.click(); p.locator('#page-capture-mode').select_option('list')
        p.evaluate("""()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async m=>{const r=await send(m);if(m.type==='START_PAGE_CAPTURE')window.scaleBatch=r.batch;return r;};}""")
        p.locator('#page-capture-target-count').fill('120'); p.locator('#page-capture-list-run').click()
        expect(p.locator('.page-capture-item')).to_have_count(120,timeout=180000)
        print(p.evaluate("()=>({adapter:scaleBatch.adapter,mediaCases:scaleBatch.candidates.filter(c=>c.media.length).length})"),flush=True)
        assert p.evaluate("()=>new Set(scaleBatch.candidates.map(c=>c.canonicalUrl)).size")==120
        expect(p.locator('.page-capture-item.confirmed')).to_have_count(120)
        expect(p.locator('#page-capture-help')).to_be_hidden()
        expect(p.locator('#page-capture-list-summary')).to_be_hidden()
        p.locator('#page-capture-save-mode').select_option('multiple')
        p.locator('#capture-collection').select_option(label='＋ 新建项目')
        project='隔离测试：长项目名称保持完整且归属不丢失'
        p.locator('#capture-new-collection-name').fill(project); p.locator('#capture-new-collection-name').press('Tab')
        category=p.locator('#content-type option').evaluate_all("nodes=>nodes.find(n=>n.value)?.value")
        p.locator('#content-type').select_option(category)
        for label in ['规模验证','图文配对']:
            p.locator('#custom-labels input').fill(label);p.locator('#custom-labels input').press('Enter')
        for width in [320,390]:
            p.set_viewport_size({'width':width,'height':844})
            p.locator('#page-capture').evaluate('e=>e.scrollTop=e.scrollHeight')
            p.locator('#page-capture-organize').click()
            assert p.locator('#capture-collection').evaluate('e=>e===document.activeElement')
            assert p.locator('#capture-metadata').bounding_box()['y']>=0
            assert p.locator('#capture-new-collection-name').input_value()==project
            assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
            p.locator('#page-capture').evaluate('e=>e.scrollTop=0')
            p.screenshot(path=str(Path(tempfile.gettempdir())/f'pd-batch-verified-{width}.png'))
        p.locator('#page-capture-save').click()
        expect(p.locator('#page-capture')).to_be_hidden(timeout=180000)
        state=p.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        entries=state['entries']; assert len(entries)==120,len(entries)
        collection=next(c for c in state['organizerState']['collections'] if c['name']==project)
        for e in entries:
            assert e['classification']['pathIds']==[category],e
            assert set(e['customLabels'])=={'规模验证','图文配对'},e
            assert str(e['title'].split()[-1]) in e['text'],e
            assert len(e.get('mediaAssets',[]))==1,e
            index=e['title'].split()[-1]
            assert e['url'].endswith('/work/'+index),e
            assert e['mediaAssets'][0]['sourceUrl'].endswith('/scale-'+index+'.png'),e
            assert e['mediaAssets'][0].get('byteSize',0)>0,e
        assert len(collection['entryIds'])==120,collection
        assert page.url.endswith('/scale?page=1'),page.url
        print({'capturedAndSaved':120,'paginationOverlapRemoved':10,'projectMembers':120,'categoryAndTags':True,'mediaRetained':True,'widths':[320,390]},flush=True)


if __name__=='__main__': main()
