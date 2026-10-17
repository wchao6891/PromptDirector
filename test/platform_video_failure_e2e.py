"""Rejected page streams cannot leave description-only video cases; retry uses the same draft."""
import base64
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session, wait_for_async_condition

VIDEO = base64.b64encode((Path(__file__).parent / 'fixtures/zhipu-local-video-smoke.mp4').read_bytes()).decode()

with tempfile.TemporaryDirectory(prefix='platform-failure-extension-') as temp:
    extension = Path(temp)
    for file in EXTENSION_DIR.iterdir():
        if file.name != 'manifest.json':
            (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
    manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
    manifest['host_permissions'].append('https://www.bilibili.com/*')
    (extension / 'manifest.json').write_text(json.dumps(manifest))
    with extension_session('platform-original-failure-', extension_dir=extension, viewport={'width': 390, 'height': 844}) as run:
        page = run.open_page('collector.html')
        page.set_default_timeout(15000)
        run.seed_storage(page, {'entries': [], 'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-10-17T00:00:00Z', 'clipboardIncluded': True}})
        run.context.route('https://www.bilibili.com/**', lambda route: route.fulfill(body='<title>Fixture work</title><h1>Fixture work</h1>', content_type='text/html'))
        source=run.context.new_page()
        source.goto('https://www.bilibili.com/video/BVfixture/')
        source.bring_to_front()
        worker = run.context.service_workers[0]
        version=page.evaluate("async()=>(await import('./video-component-config.js')).VIDEO_COMPONENT.version")
        worker.evaluate("""({data,version}) => {
          globalThis.nativeFailure=true;globalThis.nativeDownloads=[];
          chrome.permissions.contains=async()=>true;
          chrome.runtime.connectNative=()=>{
            const listeners=[];
            return {onMessage:{addListener:f=>listeners.push(f)},onDisconnect:{addListener(){}},disconnect(){},postMessage(message){
              queueMicrotask(()=>{
                if(message.type==='video_hello'){listeners.forEach(f=>f({type:'video_ready',componentVersion:version}));return;}
                const {operation,input}=message;
                let result={};
                if(operation==='download'){
                  nativeDownloads.push({url:input.url,streams:Boolean(input.streams)});
                  if(nativeFailure){listeners.forEach(f=>f({type:'video_response',id:message.id,error:{message:'Error opening input: Server returned 403 Forbidden (access denied)'}}));return;}
                  result={token:'fixture',width:640,height:360,chunkCount:1,byteSize:atob(data).length,mimeType:'video/mp4'};
                }else if(operation==='read')result={data};
                else if(operation==='status')result={available:true};
                listeners.forEach(f=>f({type:'video_response',id:message.id,result}));
              });
            }};
          };
        }""", {"data": VIDEO, "version": version})
        page.evaluate("""async()=>{
          const {normalizePageCaptureBatch}=await import('./page-capture.js');
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;
          chrome.runtime.sendMessage=async m=>{
            if(m.type==='START_PAGE_CAPTURE')return {ok:true,batch:normalizePageCaptureBatch({sourceUrl:'https://www.bilibili.com/video/BVfixture/',adapter:'bilibili',candidates:[{
              id:'bili-work',title:'Rejected original',canonicalUrl:'https://www.bilibili.com/video/BVfixture/',pageType:'video',adapter:'bilibili',
              contentText:'This description must not become an empty video case.',sourceFacts:{provider:'bilibili',pageType:'video',originalPromptAvailable:false},
              media:[{id:'video',kind:'video',placement:'inline',sourceKind:'source',url:'https://www.bilibili.com/video/BVfixture/',videoStreams:{videoUrl:'https://a.bilivideo.com/video',audioUrl:'https://a.bilivideo.com/audio'}}]
            }]})};
            if(['PREVIEW_PAGE_CAPTURE_REGION','CLEAR_PAGE_CAPTURE_MARKERS'].includes(m.type))return {ok:true};
            const r=await send(m);
            if(m.type==='GET_CAPTURE_SAVE_TASK'&&r.task?.status==='completed')window.saveReceipt=r.task.result;
            return r;
          };
        }""")
        page.locator('#start-page-capture').click()
        page.locator('.page-capture-item').first.wait_for()
        confirm=page.locator('.page-capture-confirm')
        if confirm.count() and confirm.first.is_visible():confirm.first.click()
        page.locator('#page-capture-save').click()
        expect(page.locator('#feedback')).to_contain_text('部分内容未保存', timeout=30000)
        expect(page.locator('#page-capture-help')).to_be_visible()
        expect(page.locator('#page-capture-help')).to_contain_text('403')
        state = page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert state['entries'] == [], 'A failed original must never publish its description as an empty video case'
        task = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
        assert task['status'] == 'pending'
        original_id = task['id']
        source.bring_to_front()
        page.reload()
        expect(page.locator('#page-capture-help')).to_be_visible()
        expect(page.locator('#page-capture-help')).to_contain_text('403')
        for width in [390, 1280]:
            page.set_viewport_size({'width': width, 'height': 844})
            page.screenshot(path=f'/tmp/pd-video-failure-{width}.png')
        worker.evaluate('()=>globalThis.nativeFailure=false')
        page.evaluate('()=>{chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;}')
        page.locator('#page-capture-save').click()
        expect(page.locator('#page-capture')).to_be_hidden(timeout=30000)
        entries = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        assert len(entries) == 1 and any(a['kind'] == 'video' and a['storageMode'] == 'managed' for a in entries[0]['mediaAssets'])
        assert page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task") is None
        library = run.open_page('library.html')
        library.locator('.case-card').first.click()
        expect(library.locator('#detail-drawer')).to_be_visible()
        library.locator('#detail-drawer .detail-video-play').click()
        wait_for_async_condition(library, "()=>[...document.querySelectorAll('#detail-drawer video')].some(v=>v.currentTime>0&&v.videoWidth>0)")
        library.reload()
        library.locator('.case-card').first.click()
        library.locator('#detail-drawer .detail-video-play').click()
        wait_for_async_condition(library, "()=>[...document.querySelectorAll('#detail-drawer video')].some(v=>v.currentTime>0&&v.videoWidth>0)")
        print(json.dumps({'noEmptyCase': True, 'sameDraftRetry': original_id, 'persistentCause': True, 'detailPlaybackAfterReload': True}))
