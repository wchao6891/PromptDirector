"""Actual public X patterns: delayed thread/players, long offscreen photo and feedback actions."""
import sys
import os
import json
import tempfile
import time
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, EXTENSION_DIR

MAIN='https://x.com/director/status/123'
REPLY='https://x.com/director/status/124'
def post(url, text, media=''):
    return f'<article><a href="/director">Director</a><div dir="auto" class="whitespace-pre-wrap">{text}</div>{media}<a href="{url}">Today</a></article>'

def hydrated():
    with extension_session('pd-x-followup-hydration-') as run:
        setup=run.open_page('collector.html')
        scanner=setup.evaluate("async()=>({fn:(await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),adapters:(await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS})")
        run.context.route('https://x.com/**',lambda r:r.fulfill(body=post(REPLY,'Full comment remains intact.'),content_type='text/html'))
        page=run.context.new_page();page.goto(REPLY)
        page.evaluate("()=>{const clock=document.createElement('span');clock.id='playback-clock';document.body.append(clock);window.clockTimer=setInterval(()=>clock.textContent=String(performance.now()),20)}")
        # Real public player appears after its server-rendered text. No click or decoded image needed.
        page.evaluate("()=>setTimeout(()=>{const v=document.createElement('video');v.poster='https://pbs.twimg.com/amplify_video_thumb/555/img/cover.jpg';v.style.width='300px';v.style.height='200px';document.querySelector('article').append(v)},50)")
        start=time.monotonic()
        result=page.evaluate('async options=>('+scanner['fn']+')(options)',{'xSupplementUrl':REPLY,'mediaTimeoutMs':1000})
        assert len(result['supplement']['media'])==1, 'Selected reply was marked complete before its own video player mounted'
        elapsed=time.monotonic()-start
        assert elapsed<1.0, f'An unrelated playback clock delayed the selected comment past its render deadline: {elapsed:.3f}s'
        page.goto(REPLY)
        page.evaluate("text=>{document.querySelector('article div').textContent=text;setTimeout(()=>{document.body.insertAdjacentHTML('beforeend', '<article><div dir=auto class=whitespace-pre-wrap>Nested author continuation</div><a href=\"https://x.com/director/status/125\">Today</a></article>')},50)}",'Complete prompt. '*1000)
        result=page.evaluate('async options=>('+scanner['fn']+')(options)',{'adapters':scanner['adapters'],'mediaTimeoutMs':1000})
        assert len(result['candidates'][0].get('supplements',[]))==1, 'A newly mounted nested author reply was omitted'
        print({'late_video_player':True,'late_nested_author_post':True,'unrelated_playback_ignored':True,'comment_read_seconds':round(elapsed,3)})

def background():
    with extension_session('pd-x-hidden-comment-') as run:
        setup=run.open_page('collector.html')
        scanner=setup.evaluate("async()=>(await import('./page-capture.js')).collectPageCaptureSnapshot.toString()")
        run.context.route('https://x.com/**',lambda r:r.fulfill(body=post(REPLY,'Complete selected comment.', '<video poster="https://pbs.twimg.com/amplify_video_thumb/555/img/cover.jpg"></video>'),content_type='text/html'))
        page=run.context.new_page();page.goto(REPLY)
        page.evaluate("()=>{Object.defineProperty(document,'hidden',{value:true});window.requestAnimationFrame=()=>0}")
        result=page.evaluate('async options=>Promise.race([('+scanner+')(options),new Promise(resolve=>setTimeout(()=>resolve({stalled:true}),2000))])',{'xSupplementUrl':REPLY,'mediaTimeoutMs':1000})
        assert not result.get('stalled'), 'An inactive comment tab waits forever for paused animation frames until the user opens it'
        assert result['supplement']['text']=='Complete selected comment.'
        assert len(result['supplement']['media'])==1
        page.goto(REPLY)
        page.evaluate("()=>{window.fixtureHidden=false;Object.defineProperty(document,'hidden',{get:()=>window.fixtureHidden});window.requestAnimationFrame=()=>0;setTimeout(()=>{window.fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'))},30)}")
        switched=page.evaluate('async options=>('+scanner+')(options)',{'xSupplementUrl':REPLY,'mediaTimeoutMs':1000})
        assert len(switched['supplement']['media'])==1, 'Switching away during a paint wait must not stall the comment'
        page.goto(REPLY)
        page.evaluate("()=>{Object.defineProperty(document,'hidden',{value:false});window.requestAnimationFrame=()=>0}")
        deadline=page.evaluate('async options=>Promise.race([('+scanner+')(options).catch(e=>({error:e.message})),new Promise(resolve=>setTimeout(()=>resolve({stalled:true}),1000))])',{'xSupplementUrl':REPLY,'mediaTimeoutMs':100})
        assert deadline.get('error') and not deadline.get('stalled'), 'The read deadline must cover a paused visible paint as well as hidden DOM waits'
        page.goto(REPLY)
        page.evaluate("""()=>{Object.defineProperty(document,'hidden',{value:false});window.requestAnimationFrame=()=>0;
          chrome.runtime={onMessage:{addListener:fn=>window.cancelCapture=fn,removeListener:()=>{}}};
          setTimeout(()=>window.cancelCapture({type:'PROMPTDIRECTOR_PAGE_CAPTURE',sessionId:'cancel-frame',action:'cancel'},null,()=>{}),30)}""")
        aborted=page.evaluate('async options=>('+scanner+')(options).catch(e=>({error:e.message}))',{'sessionId':'cancel-frame','xSupplementUrl':REPLY,'mediaTimeoutMs':1000})
        assert '已取消' in aborted.get('error',''), 'Cancellation must reach the pending frame and selected-comment reader'
        print({'hidden_comment_reads_without_user_activation':True,'own_video_preserved':True,'visibility_switch':True,'frame_deadline':True,'frame_cancellation':True})

def thread():
    with extension_session('pd-x-incremental-thread-') as run:
        setup=run.open_page('collector.html')
        scanner=setup.evaluate("async()=>({fn:(await import('./page-capture.js')).collectPageCaptureSnapshot.toString(),adapters:(await import('./page-capture-adapter-registry.js')).PAGE_CAPTURE_ADAPTERS})")
        initial=post(MAIN,'Root must survive virtualization.')+''.join(post(f'https://x.com/director/status/{124+i}',f'Author part {i+1}') for i in range(5))
        run.context.route('https://x.com/**',lambda r:r.fulfill(body='<style>article{min-height:180px}</style><main>'+initial+'<div id="loading" style="height:3000px"></div></main>',content_type='text/html'))
        page=run.context.new_page()
        full='Full sixth prompt. '*1000+'END OF FULL PROMPT'
        for extra_count in (0,6):
          page.goto(MAIN)
          page.evaluate("""({text,extraCount})=>{
          window.addEventListener('scroll',()=>{
            if(window.scrollY===0||window.loaded)return;
            window.loaded=true;
            document.querySelector('#loading').setAttribute('role','progressbar');
            setTimeout(()=>{
              document.querySelector('main').innerHTML=`<article><div dir=auto class=whitespace-pre-wrap>${text}</div><a href='https://x.com/director/status/129'>Today</a></article>
                <article><div dir=auto class=whitespace-pre-wrap>Seventh valuable part<video poster='https://pbs.twimg.com/media/seventh.jpg'></video></div><a href='https://x.com/director/status/130'>Today</a></article>
                ${Array.from({length:extraCount},(_,i)=>`<article><div dir=auto class=whitespace-pre-wrap>Further author part ${i+8}</div><a href='https://x.com/director/status/${131+i}'>Today</a></article>`).join('')}
                <article><div dir=auto class=whitespace-pre-wrap>Foreign reply must not be mixed in.</div><a href='https://x.com/other/status/999'>Today</a></article><div style='height:3000px'></div>`;
            },400);
          });
          }""",{'text':full,'extraCount':extra_count})
          result=page.evaluate('async options=>('+scanner['fn']+')(options)',{'adapters':scanner['adapters'],'mediaTimeoutMs':3000})
          candidate=result['candidates'][0];replies=candidate.get('supplements',[])
          assert len(replies)==7+extra_count, f'Only {len(replies)} replies captured: all later parts must load without losing earlier virtualized parts'
          assert candidate['contentText']=='Root must survive virtualization.'
          assert next(r for r in replies if r['sourceUrl'].endswith('/129'))['text']==full
          assert any(m['kind']=='video' for r in replies if r['sourceUrl'].endswith('/130') for m in r['media'])
          assert not any('/other/' in r['sourceUrl'] for r in replies)
          assert page.evaluate('window.scrollY')==0, 'Scanning must restore the source reading position'
        page.goto(MAIN)
        page.evaluate("()=>window.addEventListener('scroll',()=>document.querySelector('#loading')?.setAttribute('role','progressbar'))")
        failed=page.evaluate('async options=>('+scanner['fn']+')(options)',{'adapters':scanner['adapters'],'mediaTimeoutMs':300})
        assert failed['candidates'][0]['completeness']=='partial'
        assert len(failed['candidates'][0]['supplements'])==5 and page.evaluate('window.scrollY')==0
        page.goto(MAIN)
        page.evaluate("""()=>{
          const root=document.querySelector('article');const markup=root.outerHTML;
          window.scrollTo(0,1000);root.remove();
          window.addEventListener('scroll',()=>{if(window.scrollY===0&&!window.rootRestored){window.rootRestored=true;document.querySelector('main').insertAdjacentHTML('afterbegin',markup)}});
        }""")
        expected_position=page.evaluate('window.scrollY')
        recovered=page.evaluate('async options=>('+scanner['fn']+')(options)',{'adapters':scanner['adapters'],'mediaTimeoutMs':3000})
        assert len(recovered['candidates'])==1 and recovered['candidates'][0]['canonicalUrl']==MAIN, 'A virtualized root must not turn its first five mounted replies into separate main cases'
        assert recovered['candidates'][0]['contentText']=='Root must survive virtualization.'
        assert page.evaluate('window.scrollY')==expected_position
        print({'seven_and_thirteen_author_parts':True,'sixth_full_prompt_characters':len(full),'seventh_video':True,'virtualized_earlier_parts_retained':True,'foreign_replies_excluded':True,'source_position_restored':True,'loading_deadline_retains_partial_content':True,'offscreen_root_identity_restored':True})

def cache():
    original=(Path(__file__).parent/'fixtures/detail-portrait-smoke.mp4').read_bytes()
    state={'body':original,'etag':'"original"','bodies':0,'validations':0,'requests':[]}
    class Handler(BaseHTTPRequestHandler):
        protocol_version='HTTP/1.1'
        def do_GET(self):
            state['requests'].append({'cache':self.headers.get('Cache-Control'),'validator':self.headers.get('If-None-Match')})
            validated=self.headers.get('If-None-Match')==state['etag']
            self.send_response(304 if validated else 200)
            self.send_header('Access-Control-Allow-Origin','*')
            self.send_header('Cache-Control','max-age=604800, must-revalidate')
            self.send_header('ETag',state['etag'])
            self.send_header('Content-Type','video/mp4')
            self.send_header('Content-Length',str(0 if validated else len(state['body'])))
            self.end_headers()
            if self.headers.get('If-None-Match')==state['etag']:
                state['validations']+=1
            else:
                state['bodies']+=1
                time.sleep(0.5)
                self.wfile.write(state['body'])
        def log_message(self,*args): pass
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with extension_session('pd-capture-cache-', preserve_http_cache=True) as run:
            page=run.open_page('collector.html')
            url=f'http://127.0.0.1:{server.server_port}/movie.mp4'
            def download():
                return page.evaluate("""async url=>{
                  const {downloadPageCaptureVideo}=await import('./page-capture-video.js');
                  const {sha256Blob}=await import('./blob-digest.js');
                  const start=performance.now();
                  const blob=await downloadPageCaptureVideo(url,{allowLoopback:true});
                  return {hash:await sha256Blob(blob),bytes:blob.size,ms:performance.now()-start};
                }""",url)
            first=download();second=download()
            assert first['hash']==second['hash'] and first['bytes']==len(original)
            assert state['bodies']==1 and state['validations']==1, f'Repeated capture downloaded the entire unchanged original again: {state["requests"]}'
            state['body']=original+b'changed original bytes';state['etag']='"changed"'
            changed=download()
            assert changed['hash']!=first['hash'] and changed['bytes']==len(state['body']), 'Validation must fetch changed bytes at the same URL'
            assert state['bodies']==2 and state['validations']==1
            print({'first_download_ms':round(first['ms'],1),'validated_repeat_ms':round(second['ms'],1),'repeat_full_body_downloads':0,'same_url_changed_bytes_downloaded':True,'complete_original_hash_verified':True})
    finally:
        server.shutdown();server.server_close()

def feedback():
    with extension_session('pd-feedback-actions-',viewport={'width':340,'height':700}) as run:
        page=run.open_page('collector.html')
        run.seed_storage(page,{'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-10-02T00:00:00Z','clipboardIncluded':True}})
        page.evaluate("""async()=>{
          const batch=(await import('./page-capture.js')).normalizePageCaptureBatch({id:'feedback',tabId:999,sourceUrl:'https://x.com/director/status/123',adapter:'x',status:'ready',candidates:[{id:'one',canonicalUrl:'https://x.com/director/status/123',contentText:'Capture preview. '.repeat(900),pageType:'post',media:[]}]});
          const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async q=>q.active?[{id:999,url:batch.sourceUrl}]:query(q);
          chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.runtime.sendMessage=async m=>m.type==='START_PAGE_CAPTURE'?{ok:true,batch}:m.type==='COMMIT_PAGE_CAPTURE'?{ok:false,message:'部分内容未保存，已保留供重试'}:send(m);
        }""")
        page.locator('#start-page-capture').click();page.locator('.page-capture-confirm').click()
        page.locator('#page-capture-save').click()
        expect(page.locator('#feedback')).to_contain_text('部分内容未保存')
        # Includes the actual text-only retry action that wraps in narrow sidebars.
        page.locator('#page-capture-save-text-only').evaluate('e=>e.hidden=false')
        for width in (340,420,680):
            page.set_viewport_size({'width':width,'height':700})
            page.wait_for_timeout(100)
            box=page.locator('#feedback').bounding_box();save=page.locator('#page-capture-save').bounding_box()
            assert box['y']+box['height']<=save['y'], {'feedback':box,'save':save}
            assert page.locator('#feedback').evaluate("e=>e.parentElement.id")=='page-capture-actions', 'Feedback needs its own row, not an overlay above unrelated controls'
            for control in page.locator('button:visible,input:visible,select:visible').all():
                rect=control.bounding_box()
                overlap=rect and min(rect['x']+rect['width'],box['x']+box['width'])>max(rect['x'],box['x']) and min(rect['y']+rect['height'],box['y']+box['height'])>max(rect['y'],box['y'])
                assert not overlap, {'covered_control':control.get_attribute('id'),'feedback':box,'control':rect}
            if os.environ.get('PROMPTDIRECTOR_LAB_EVIDENCE_DIR'):
                page.screenshot(path=str(Path(os.environ['PROMPTDIRECTOR_LAB_EVIDENCE_DIR'])/f'feedback-{width}.png'))
        page.evaluate("()=>document.querySelector('#feedback').textContent='部分内容未保存，已保留供重试。'.repeat(30)")
        page.wait_for_timeout(100)
        box=page.locator('#feedback').bounding_box();save=page.locator('#page-capture-save').bounding_box()
        assert box['y']>=0 and box['y']+box['height']<=save['y'] and save['y']+save['height']<=700
        page.locator('#page-capture-cancel').click()
        page.evaluate("""async()=>{
          const {createCaptureDraft}=await import('./capture-draft.js');
          await chrome.runtime.sendMessage({type:'UPDATE_CAPTURE_DRAFT',draft:createCaptureDraft({fragments:[{id:'normal',text:'Keep this unsaved user material.'}]})});
        }""")
        normal=run.open_page('collector.html')
        normal.evaluate("""()=>{const send=chrome.runtime.sendMessage.bind(chrome.runtime);chrome.runtime.sendMessage=async m=>m.type==='COMMIT_CAPTURE_DRAFT'?{ok:false,message:'部分内容未保存，已保留供重试'}:send(m)}""")
        normal.locator('#save-draft').click()
        expect(normal.locator('#feedback')).to_contain_text('部分内容未保存')
        assert normal.locator('#feedback').evaluate('e=>e.parentElement.id')=='collector-footer'
        box=normal.locator('#feedback').bounding_box();save=normal.locator('#save-draft').bounding_box()
        assert box['y']+box['height']<=save['y'] and save['y']+save['height']<=700
        assert not run.page_errors,run.page_errors
        print({'dedicated_feedback_row':True,'all_visible_controls_uncovered':True,'wrapped_actions_and_long_error_do_not_overlap':True,'normal_capture_footer':True})

def live():
    """Opt-in read-only scan of the user-specified public pages, disposable profile."""
    long='https://x.com/PJaccetturo/status/2105285290436812964'
    video='https://x.com/PJaccetturo/status/2105285286389248049'
    root='https://x.com/PJaccetturo/status/2105285283298115670'
    with tempfile.TemporaryDirectory(prefix='pd-x-live-runtime-') as directory:
        extension=Path(directory)
        for file in EXTENSION_DIR.iterdir():
            if file.name!='manifest.json':(extension/file.name).symlink_to(file,target_is_directory=file.is_dir())
        manifest=json.loads((EXTENSION_DIR/'manifest.json').read_text());manifest['host_permissions']+=['https://x.com/*','https://pbs.twimg.com/*','https://video.twimg.com/*']
        (extension/'manifest.json').write_text(json.dumps(manifest))
        with extension_session('pd-x-live-followup-',extension_dir=extension) as run:
            setup=run.open_page('collector.html');source=run.context.new_page()
            source.goto(long,wait_until='domcontentloaded',timeout=30000)
            expect(source.locator('article')).not_to_have_count(0,timeout=20000)
            source.bring_to_front()
            start=time.monotonic()
            response=setup.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            elapsed=time.monotonic()-start
            assert response.get('ok'),response
            candidate=response['batch']['candidates'][0]
            assert len(candidate['contentText'])>13000 and candidate['contentText'].endswith('No music.'), {'characters':len(candidate['contentText']),'end':candidate['contentText'][-100:]}
            assert not any(m['kind']=='video' for m in candidate['media']), 'Ancestor playback was mixed into a photo post'
            assert len(candidate['media'])==1,candidate['media']
            assert elapsed<5,elapsed
            start=time.monotonic()
            supplement=setup.evaluate("async url=>chrome.runtime.sendMessage({type:'READ_PAGE_CAPTURE_SUPPLEMENT',supplement:{id:'live-video',sourceUrl:url}})",video)
            assert supplement.get('ok'),supplement
            own=supplement['supplement'];assert own['partial'] is False
            assert any(m['kind']=='video' and '.mp4' in m['url'] and '/2105198166014640128/' in m['url'] for m in own['media']),own
            assert source.url==long
            print({'live_long_prompt_characters':len(candidate['contentText']),'scan_seconds':round(elapsed,3),'own_photo_without_click':True,'live_comment_video_original':True,'comment_seconds':round(time.monotonic()-start,3),'source_page_unchanged':True},flush=True)
            source.goto(root,wait_until='domcontentloaded');source.bring_to_front()
            expect(source.locator('article')).not_to_have_count(0,timeout=20000)
            response=setup.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert response.get('ok'),response
            replies=response['batch']['candidates'][0]['supplements']
            print({'live_root_loaded_author_replies':len(replies),'includes_nested_video_comment':any(r['sourceUrl']==video for r in replies),'urls':[r['sourceUrl'] for r in replies]},flush=True)

if __name__=='__main__':
    modes = {'hydrated':hydrated,'background':background,'thread':thread,'cache':cache,'feedback':feedback,'live':live}
    if len(sys.argv) > 1: modes[sys.argv[1]]()
    else:
        for name in ('hydrated','background','thread','cache','feedback'): modes[name]()
