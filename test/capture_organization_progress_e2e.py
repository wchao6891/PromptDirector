"""Actual collector/worker/storage; network bodies are controlled byte streams.

No installed profile or personal case library is read or written. A valid fixture
video plus a legal MP4 free atom exercises MiB progress and original SHA readback.
"""
import base64
import hashlib
import json
import os
import struct
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def main(on_download=None):
    out = Path(os.environ.get('PD_E2E_ARTIFACT_DIR') or tempfile.mkdtemp(prefix='pd-capture-progress-'))
    out.mkdir(parents=True, exist_ok=True)
    video = (Path(__file__).parent / 'fixtures/review-workspace-smoke.mp4').read_bytes()
    padding = 2 * 1024 * 1024  # Exercise the shared MiB formatter, not a product quota.
    video += struct.pack('>I4s', padding + 8, b'free') + bytes(padding)
    projects = [dict(id='root', name='X精选', parentId=None, order=0, entryIds=[]),
                dict(id='child', name='动作对抗', parentId='root', order=0, entryIds=[]),
                dict(id='leaf', name='角色打斗与分镜参考', parentId='child', order=0, entryIds=[])]
    with extension_session('pd-capture-progress-', viewport={'width':468, 'height':800}) as run:
        run.context.on('console', lambda message: print('console:',message.text[:500],flush=True) if 'capture diagnostics' in message.text else None)
        p = run.open_page('collector.html')
        run.seed_storage(p, {'entries': [], 'organizerState': {'version':4,'collections':projects},
            'uiPreferences': {'locale':'zh-CN','theme':'dark','motion':'reduced'},
            'capturePermissionOnboarding': {'version':1,'acknowledgedAt':'2026-10-05T00:00:00Z','clipboardIncluded':True}})
        worker = next(w for w in run.context.service_workers if w.url.startswith(f'chrome-extension://{run.extension_id}/'))
        case_record_prefix = p.evaluate("async()=>(await import('./library-case-records.js')).CASE_RECORD_PREFIX")
        worker.evaluate('''({encoded,caseRecordPrefix})=>{
          const binary=atob(encoded), bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
          const nativeFetch=globalThis.fetch.bind(globalThis); const gates=new Map();
          globalThis.captureFixture={gates, failImage:true, holdCommit:true, requests:[]};
          globalThis.fetch=async(url,options)=>{
            globalThis.captureFixture.lastFetch=String(url);
            if(!String(url).startsWith('https://capture-progress.test/'))return nativeFetch(url,options);
            const key=String(url).endsWith('.mp4')?'video':'image';
            captureFixture.requests.push({key, signal:options.signal});
            const data=key==='video'?bytes:globalThis.captureFixture.image;
            let part=0;
            const stream=new ReadableStream({async pull(controller){
              if(part===0){part++;controller.enqueue(data.slice(0,Math.floor(data.length/2)));return;}
              await new Promise(resolve=>gates.set(key,resolve));
              if(key==='image'&&globalThis.captureFixture.failImage){controller.error(new Error('fixture connection interrupted'));return;}
              controller.enqueue(data.slice(Math.floor(data.length/2)));controller.close();
            }});
            return new Response(stream,{headers:{'content-type':key==='video'?'video/mp4':'image/png',
              ...(key==='video'?{'content-length':String(data.length)}:{})}});
          };
          const originalSet=chrome.storage.local.set.bind(chrome.storage.local);
          chrome.storage.local.set=async values=>{
            // Pause the actual case record write, before its index is published.
            const videoCase=Object.entries(values).some(([key,entry])=>
              key.startsWith(caseRecordPrefix)&&entry.mediaAssets?.some(asset=>asset.kind==='video'));
            if(globalThis.captureFixture.holdCommit&&videoCase){
              globalThis.captureFixture.holdCommit=false;
              await new Promise(resolve=>gates.set('commit',resolve));
            }
            return originalSet(values);
          };
        }''', {'encoded':base64.b64encode(video).decode(),'caseRecordPrefix':case_record_prefix})
        image = p.evaluate('''async()=>{
          const c=document.createElement('canvas');c.width=320;c.height=180;
          const x=c.getContext('2d');x.fillStyle='#355e72';x.fillRect(0,0,320,180);
          return [...new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer())];
        }''')
        worker.evaluate('data=>{globalThis.captureFixture.image=Uint8Array.from(data)}', image)
        p.evaluate('''async()=>{
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          const {createCaptureDraft}=await import('./capture-draft.js');
          await send({type:'UPDATE_CAPTURE_DRAFT',draft:createCaptureDraft({
            title:'采集保存进度验证',fragments:[{id:'original',text:'原始提示词必须完整保存。',sourceUrl:'https://example.com/progress/video'}]
          })});
          window.captureProgressEvents=[];
          chrome.runtime.onMessage.addListener(message=>{
            if(message.type==='CAPTURE_SAVE_PROGRESS')window.captureProgressEvents.push(message);
          });
          window.fixtureKind='video'; window.fixtureAttempt=1;
          chrome.permissions.contains=async()=>true;
          window.permissionGestures=[];
          chrome.permissions.request=async()=>{window.permissionGestures.push(navigator.userActivation.isActive);return true;};
          const query=chrome.tabs.query.bind(chrome.tabs);
          chrome.tabs.query=async q=>q.active?[{id:999,url:'https://example.com/progress/video'}]:query(q);
          chrome.runtime.sendMessage=async message=>{
            if(message.type==='START_PAGE_CAPTURE'){
              const kind=window.fixtureKind;
              return {ok:true,batch:{id:'progress-'+window.fixtureAttempt,sourceUrl:'https://example.com/progress/'+kind,
                candidates:[{id:'main',canonicalUrl:'https://example.com/progress/'+kind,title:'采集保存进度验证 '+kind,
                pageType:kind==='video'?'video':'post',contentText:'原始提示词必须完整保存。',
                textBlocks:[{id:'original',text:'原始提示词必须完整保存。'}],
                media:[{id:kind,kind,placement:'inline',url:'https://capture-progress.test/'+kind+(kind==='video'?'.mp4':'.png'),sourceKind:'site-original'}],
                sourceFacts:{provider:'example.com',pageType:kind==='video'?'video':'post'}}],selections:[]}};
            }
            if(['PREVIEW_PAGE_CAPTURE_REGION','CLEAR_PAGE_CAPTURE_MARKERS'].includes(message.type))return {ok:true};
            return send(message);
          };
          window.dispatchEvent(new Event('focus'));
        }''')
        expect(p.locator('#preview-state')).to_be_visible()
        p.locator('#capture-collection > summary').click()
        p.locator('[data-collection-id=root] .project-disclosure').first.click()
        p.locator('[data-collection-id=child] .project-disclosure').first.click()
        expect(p.locator('[data-collection-id=leaf] .detail-project-option > span')).to_have_text('角色打斗与分镜参考')
        assert p.locator('#capture-collection').evaluate('e=>e.open')
        p.screenshot(path=str(out/'project-tree.png'))
        p.locator('[data-collection-id=leaf] input').check()
        expect(p.locator('#capture-collection > summary')).to_contain_text('角色打斗')
        expect(p.locator('#capture-collection .detail-project-summary-text')).to_have_attribute('title','X精选 / 动作对抗 / 角色打斗与分镜参考')
        p.locator('[data-collection-id=child] input').first.check()
        expect(p.locator('#capture-collection input:checked')).to_have_count(1)
        p.locator('[data-collection-id=child] input').first.uncheck()
        expect(p.locator('#capture-collection > summary')).to_contain_text('选择项目')
        p.locator('#capture-collection input[type=search]').fill('角色打斗')
        expect(p.locator('#capture-collection [role=treeitem]')).to_have_count(1)
        p.locator('[data-collection-id=leaf] input').check()
        p.locator('#capture-collection input[type=search]').press('Escape')
        p.locator('#custom-labels [aria-label="添加标签"]').filter(has=p.locator('svg')).click()
        p.locator('#custom-labels input').fill('镜头参考, 动作')
        p.locator('#custom-labels input').press('Enter')
        expect(p.locator('.tag-editor-chip')).to_have_count(2)
        p.locator('#custom-labels input').fill('待保存标签')
        p.locator('#custom-labels input').press('Escape')
        for theme in ['dark','light']:
            p.evaluate("async theme=>(await import('./i18n.js')).initializeUi({locale:'zh-CN',theme,motion:'reduced'})",theme)
            for width in [320,468]:
                p.set_viewport_size({'width':width,'height':800})
                assert p.evaluate('document.documentElement.scrollWidth<=innerWidth')
                p.screenshot(path=str(out/f'capture-{theme}-{width}.png'))
        p.evaluate("async()=>(await import('./i18n.js')).initializeUi({locale:'zh-CN',theme:'dark',motion:'reduced'})")
        p.set_viewport_size({'width':468,'height':800})
        p.locator('#add-page-capture').click(); p.locator('.page-capture-confirm').click()
        p.locator('#content-type').select_option('content:video-case')
        p.screenshot(path=str(out/'capture-page.png'))
        p.locator('#page-capture-save').click()
        assert p.evaluate('()=>permissionGestures')==[True]
        try:
            expect(p.locator('#feedback')).to_contain_text('%',timeout=15000)
        except Exception:
            print({'events':p.evaluate('()=>captureProgressEvents'),
                   'transport':worker.evaluate('()=>({fetch:captureFixture.lastFetch,gates:[...captureFixture.gates.keys()]})'),
                   'storage':p.evaluate("async()=>(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries")},flush=True)
            raise
        known=p.locator('#feedback progress').evaluate('e=>({value:e.value,max:e.max,busy:e.getAttribute("aria-busy")})')
        assert known['value']==len(video)//2 and known['max']==len(video) and known['busy']=='true', known
        assert p.evaluate("async()=>(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries.length")==0
        expect(p.locator('#page-capture-save')).to_have_text('取消保存')
        expect(p.locator('#page-capture-save')).to_be_enabled()
        expect(p.locator('#page-capture-help')).to_be_hidden()
        p.screenshot(path=str(out/'download-real-bytes.png'))
        if on_download:
            on_download(run,p,worker,out,video)
            return
        p.evaluate('()=>window.progressNodeBefore=document.querySelector("#feedback progress")')
        worker.evaluate("()=>globalThis.captureFixture.gates.get('video')()")
        expect(p.locator('#feedback')).to_contain_text('正在入库',timeout=30000)
        assert p.locator('#feedback progress').get_attribute('value') is None
        assert p.evaluate('()=>window.progressNodeBefore===document.querySelector("#feedback progress")')
        assert p.evaluate("async()=>(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries.length")==0
        p.screenshot(path=str(out/'writing-after-download.png'))
        worker.evaluate("()=>globalThis.captureFixture.gates.get('commit')()")
        expect(p.locator('#page-capture')).to_be_hidden(timeout=30000)
        state=p.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert len(state['entries'])==1
        entry=state['entries'][0]
        assert entry['text']=='原始提示词必须完整保存。', entry['text']
        assert entry['customLabels']==['镜头参考','动作','待保存标签'],entry['customLabels']
        assert entry['classification']['pathIds']==['content:video-case']
        assert next(c for c in state['organizerState']['collections'] if c['id']=='leaf')['entryIds']==[entry['id']]
        actual=p.evaluate('''async id=>{
          const blob=await(await import('./media-store.js')).getMediaBlob(id);
          return {bytes:blob.size,hash:await(await import('./blob-digest.js')).sha256Blob(blob)};
        }''', next(a['id'] for a in entry['mediaAssets'] if a['kind']=='video'))
        assert actual=={'bytes':len(video),'hash':hashlib.sha256(video).hexdigest()},actual
        stale=p.evaluate('()=>captureProgressEvents.find(m=>m.progress.phase==="download")')
        before=p.locator('#feedback').inner_text()
        worker.evaluate('m=>chrome.runtime.sendMessage({...m,sequence:m.sequence+100000,progress:{phase:"download",kind:"video",receivedBytes:1,totalBytes:2}})', stale)
        p.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        assert p.locator('#feedback').inner_text()==before
        # Unknown-size and interrupted image still keep the selected content for retry.
        p.evaluate("()=>{window.fixtureKind='image';window.fixtureAttempt++}")
        p.locator('#start-page-capture').click(); p.locator('.page-capture-confirm').click()
        p.locator('#page-capture-save').click()
        expect(p.locator('#feedback')).to_contain_text('下载图片',timeout=15000)
        p.wait_for_function('()=>captureProgressEvents.some(m=>m.progress.kind==="image"&&m.progress.receivedBytes>0)')
        assert p.locator('#feedback progress').get_attribute('value') is None
        assert '%' not in p.locator('#feedback').inner_text()
        p.screenshot(path=str(out/'download-unknown-size.png'))
        worker.evaluate("()=>{const release=globalThis.captureFixture.gates.get('image');globalThis.captureFixture.gates.delete('image');release()}")
        expect(p.locator('#feedback')).to_contain_text('保留供重试',timeout=30000)
        expect(p.locator('#page-capture-save')).to_be_enabled()
        assert p.locator('#feedback progress').count()==0
        worker.evaluate('()=>globalThis.captureFixture.failImage=false')
        p.locator('#page-capture-save').click()
        p.wait_for_function('()=>document.querySelector("#feedback").getAttribute("aria-busy")==="true"')
        for _ in range(100):
            if worker.evaluate("()=>globalThis.captureFixture.gates.has('image')"): break
            p.wait_for_timeout(20)
        worker.evaluate("()=>globalThis.captureFixture.gates.get('image')()")
        expect(p.locator('#page-capture')).to_be_hidden(timeout=30000)
        final=p.evaluate("()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert len(final['entries'])==2
        image_entry=next(e for e in final['entries'] if e['url'].endswith('/image'))
        original=p.evaluate('''async id=>{
          const blob=await(await import('./media-store.js')).getMediaBlob(id);
          return [...new Uint8Array(await blob.arrayBuffer())];
        }''', next(a['id'] for a in image_entry['mediaAssets'] if a['kind']=='image'))
        assert original==image
        events=p.evaluate('()=>captureProgressEvents')
        result={'knownBytesAndPercent':known,'videoOriginalReadback':actual,
                'writingIsIndeterminateUntilCommit':True,'staleIgnored':True,'unknownSizeNoPercent':True,
                'failureRetainedAndRetrySameCase':True,'treeSingleSelectionSearchAndExpansion':True,
                'tagsAndProjectSaved':True,'hostPermissionRequestedWithinSaveClick':all(p.evaluate('()=>permissionGestures')),'pageErrors':run.page_errors,'network':'fixture byte streams'}
        (out/'checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        (out/'progress-events.json').write_text(json.dumps(events,ensure_ascii=False,indent=2))
        assert not run.page_errors,run.page_errors
        print({'artifacts':str(out),**result},flush=True)


if __name__=='__main__': main()
