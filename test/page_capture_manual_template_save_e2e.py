"""Real picker -> template batch -> explicit details -> background save -> stored originals.

Uses the documented synthetic workflow replay from generic_capture_template_details_e2e,
served locally and routed through the test extension's existing fixture host permission.
No real website, profile, library, model or paid service is contacted.
"""
import hashlib
import json
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session
from generic_capture_template_details_e2e import PAGE
from page_capture_e2e import FIXTURE_ORIGIN
from article_cases_capture_e2e import image_bytes


def main(*, page_html=PAGE, selection_selector='.wanted .card', after_pick=None, after_save=None):
    video=(Path(__file__).parent/'fixtures/zhipu-local-video-smoke.mp4').read_bytes()
    evidence=Path(tempfile.mkdtemp(prefix='pd-manual-template-save-'))
    requested_paths=[]
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requested_paths.append(self.path)
            if self.path.endswith('.png'):body=image_bytes(self.path);kind='image/png'
            elif self.path.endswith('.mp4'):body=video;kind='video/mp4'
            elif self.path.startswith('/work/'):
                name=self.path.rsplit('/',1)[-1]
                body=f'<html><body><main><video poster="/{name}.png"><source src="/{name}.mp4" type="video/mp4"></video><h1>Full work {name}</h1><h2>Prompt</h2><pre>First original line {name}\nSecond original line {name}</pre><dl><dt>Model</dt><dd>Creator model</dd></dl><p>Original Source <a href="https://creator.example/{name}">Creator {name}</a></p></main></body></html>'.encode();kind='text/html; charset=utf-8'
            else:body=page_html.replace('</main>', '<a rel="next" href="/catalogue-next">Next page</a></main>').encode();kind='text/html; charset=utf-8'
            self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with extension_session('pd-manual-template-save-',viewport={'width':1200,'height':900}) as run:
            def route(r):
                response=urllib.request.urlopen(f'http://127.0.0.1:{server.server_port}'+r.request.url.removeprefix(FIXTURE_ORIGIN))
                r.fulfill(body=response.read(),content_type=response.headers['Content-Type'])
            run.context.route(FIXTURE_ORIGIN+'/**',route)
            panel=run.open_page('collector.html')
            run.seed_storage(panel,{'entries':[], 'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-10-07T00:00:00Z','clipboardIncluded':True},
                'organizerState':{'collections':[{'id':'capture-project','name':'采集回放项目','entryIds':[],'parentId':None,'order':0,'visibility':'library'}]}})
            panel.reload()
            panel.evaluate('''()=>{window.captureCalls=[];const send=chrome.runtime.sendMessage.bind(chrome.runtime);
              chrome.runtime.sendMessage=async message=>{const response=await send(message);
                if(['PICK_PAGE_CONTENT','START_PAGE_CAPTURE','READ_PAGE_CAPTURE_DETAILS','START_CAPTURE_SAVE'].includes(message.type))captureCalls.push({message,response});return response;};}''')
            source=run.context.new_page();source.goto(FIXTURE_ORIGIN+'/catalogue');source.bring_to_front()
            panel.locator('#start-selection').evaluate('button=>button.click()')
            expect(source.locator('#promptdirector-content-picker')).to_be_attached()
            source.locator(selection_selector).first.click(position={'x':5,'y':5})
            expect(panel.locator('.page-capture-item')).to_have_count(1)
            picked=panel.evaluate("()=>captureCalls.find(call=>call.message.type==='PICK_PAGE_CONTENT').response.batch")
            assert picked['selectionTemplate']['sourceUrl']==source.url,picked
            if after_pick:
                after_pick(source,panel)
                picked=panel.evaluate("()=>captureCalls.filter(call=>call.message.type==='PICK_PAGE_CONTENT').at(-1).response.batch")
            expect(panel.locator('#page-capture-details')).to_be_visible()
            expect(panel.locator('#page-capture-details')).not_to_be_checked()
            panel.locator('#page-capture-mode').select_option('list')
            # A current-page manual template must keep its results rather than follow
            # this real next-page link and fail when the marker no longer exists.
            panel.locator('#page-capture-target-count').fill('3')
            source.bring_to_front()
            panel.locator('#page-capture-list-run').evaluate('button=>button.click()')
            panel.wait_for_function("()=>captureCalls.some(call=>call.message.type==='START_PAGE_CAPTURE')")
            scan=panel.evaluate("()=>captureCalls.find(call=>call.message.type==='START_PAGE_CAPTURE')")
            assert scan['response']['ok'],scan
            expect(panel.locator('.page-capture-item')).to_have_count(2)
            assert scan['message']['selectionTemplate']==picked['selectionTemplate'],scan
            assert [c['title'] for c in scan['response']['batch']['candidates']]==['Work A','Work B'],scan
            assert scan['response']['batch']['stopReason']=='manual-template-page',scan
            assert '/catalogue-next' not in requested_paths,requested_paths
            assert source.url==FIXTURE_ORIGIN+'/catalogue',source.url
            before_ids=[media['id'] for c in scan['response']['batch']['candidates'] for media in c['media']]
            panel.locator('#page-capture-details').check()
            expect(panel.locator('#page-capture-mode')).to_be_enabled(timeout=30000)
            expect(panel.locator('#page-capture-details')).to_be_checked()
            assert len(panel.evaluate("()=>captureCalls.filter(call=>call.message.type==='READ_PAGE_CAPTURE_DETAILS')"))==1
            expect(panel.locator('.page-capture-item.confirmed')).to_have_count(2)
            panel.locator('#page-capture-save-mode').select_option('multiple')
            panel.locator('#capture-collection summary').click()
            panel.locator('#capture-collection [data-collection-id="capture-project"] input').check()
            panel.locator('#capture-collection summary').click()
            panel.screenshot(path=str(evidence/'details-ready.png'),full_page=True)
            panel.locator('#page-capture-save').click()
            expect(panel.locator('#page-capture')).to_be_hidden(timeout=60000)
            save=panel.evaluate("()=>captureCalls.find(call=>call.message.type==='START_CAPTURE_SAVE').message.input")
            actual_ids=[media_id for selection in save['batch']['selections'] for media_id in selection['selectedMediaIds']]
            assert actual_ids==before_ids,(actual_ids,before_ids)
            panel.reload()
            state=panel.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
            assert len(state['entries'])==2,state['entries']
            for name in ['a','b']:
                entry=next(e for e in state['entries'] if any(a.get('sourceUrl')==FIXTURE_ORIGIN+'/'+name+'.mp4' for a in e['mediaAssets']))
                prompt=f'First original line {name}\nSecond original line {name}'
                assert prompt in entry['text'],entry['text']
                asset=next(a for a in entry['mediaAssets'] if a['kind']=='video')
                assert asset['storageMode']=='managed' and asset['byteSize']==len(video),asset
                assert any(p['assetId']==asset['id'] and p['text']==prompt and p['source']=='webpage' for p in entry['mediaPrompts']),entry['mediaPrompts']
                assert any(b.get('sourceUrl')=='https://creator.example/'+name for b in entry['articleDocument']['blocks'])
                assert asset.get('originalWorkUrl')=='https://creator.example/'+name,asset
                read=panel.evaluate("""async id=>{const blob=await(await import('./media-store.js')).getMediaBlob(id);return{size:blob.size,sha:await(await import('./blob-digest.js')).sha256Blob(blob)}}""",asset['id'])
                assert read=={'size':len(video),'sha':hashlib.sha256(video).hexdigest()},read
            project=next(c for c in state['organizerState']['collections'] if c['id']=='capture-project')
            assert set(project['entryIds'])=={e['id'] for e in state['entries']},project
            panel.screenshot(path=str(evidence/'saved-readback.png'),full_page=True)
            if after_save:
                after_save(source,panel,evidence)
            print(json.dumps({'savedCases':2,'originalVideosReadBack':2,'pairedOriginalPrompts':2,'manualTemplateForwarded':True,'selectionIdsPreserved':True,'projectMembershipPreserved':True,'evidence':str(evidence)},ensure_ascii=False))
    finally:server.shutdown();server.server_close()

if __name__=='__main__':main()
