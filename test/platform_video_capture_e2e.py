"""Real extension save/readback: selected Douyin modal, original default, explicit online-only, failure retention."""
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session, wait_for_async_condition

ID = '7673852821996834082'
WORK = 'https://www.douyin.com/user/fixture?modal_id=' + ID
VIDEO = 'https://v26-web.douyinvod.com/original/?mime_type=video_mp4'
BYTES = (Path(__file__).parent / 'fixtures/zhipu-local-video-smoke.mp4').read_bytes()


def main():
    with tempfile.TemporaryDirectory(prefix='platform-video-extension-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name != 'manifest.json':
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += ['https://www.douyin.com/*', 'https://v26-web.douyinvod.com/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('platform-video-', extension_dir=extension) as run:
            item = {'awemeId': ID, 'desc': 'Synthetic selected video', 'authorInfo': {'nickname': 'Fixture creator'},
                    'video': {'duration': 1000, 'width': 640, 'height': 360, 'playAddr': [{'src': VIDEO}]}}
            html = '<html><body><h1>Selected video</h1><div class="video_' + ID + '"><video></video></div><script>document.querySelector(".video_' + ID + '").__reactProps$test={data:' + json.dumps(item) + '};</script></body></html>'
            run.context.route(WORK, lambda route: route.fulfill(body=html, content_type='text/html'))
            downloads = []
            run.context.route(VIDEO, lambda route: (downloads.append(route.request.url), route.fulfill(body=BYTES, content_type='video/mp4'))[-1])
            collector = run.open_page('collector.html')
            run.seed_storage(collector, {'entries': [], 'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-10-17T00:00:00Z', 'clipboardIncluded': True}})
            source = run.context.new_page()
            source.goto(WORK)
            source.bring_to_front()
            collector.locator('#start-page-capture').click()
            expect(collector.locator('.page-capture-item')).to_have_count(1, timeout=15000)
            expect(collector.locator('#page-capture-list')).to_contain_text('Synthetic selected video')
            confirm = collector.locator('.page-capture-confirm')
            if confirm.count() and confirm.first.is_visible():
                confirm.first.click()
            collector.locator('#page-capture-save').click()
            wait_for_async_condition(collector, "async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.some(e=>e.mediaAssets?.some(a=>a.kind==='video'&&a.storageMode==='managed'))")
            saved = collector.evaluate("""async()=>{
                const state=await chrome.runtime.sendMessage({type:'GET_STATE'});
                const entry=state.entries[0],asset=entry.mediaAssets.find(a=>a.kind==='video');
                const blob=await (await import('./media-store.js')).getMediaBlob(asset.id);
                return {id:entry.id,url:entry.url,asset,size:blob.size,onlineOnly:state.uiPreferences.videoOnlineOnly};
            }""")
            assert saved['url'] == 'https://www.douyin.com/video/' + ID, saved
            assert saved['size'] == len(BYTES) and saved['onlineOnly'] is False, saved
            assert saved['asset']['storageMode'] == 'managed' and 'reference' not in saved['asset'], saved
            before = len(downloads)
            batch = collector.evaluate("""async ({id,url})=>{
                const {normalizePageCaptureBatch}=await import('./page-capture.js');
                return normalizePageCaptureBatch({sourceUrl:url,candidates:[{id:'other',title:'Online choice',canonicalUrl:'https://www.douyin.com/video/12345',contentText:'Online choice',pageType:'video',media:[{id:'v',kind:'video',url,sourceKind:'site-original',originalWorkUrl:'https://www.douyin.com/video/12345'}]}],selections:[{candidateId:'other',includeText:true,selectedMediaIds:['v'],mediaDecision:'confirmed'}]});
            }""", {'id': ID, 'url': VIDEO})
            collector.evaluate("async()=>chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{videoOnlineOnly:true}})")
            online = collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", batch)
            assert online['results'][0]['status'] == 'saved', online
            online_entry = collector.evaluate("async id=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.find(e=>e.id===id)", online['results'][0]['entryId'])
            assert online_entry['mediaAssets'][0]['storageMode'] == 'reference', online_entry
            assert len(downloads) == before, 'Online-only must not download the original ahead of time'
            collector.evaluate("async()=>chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{videoOnlineOnly:false}})")
            batch['candidates'][0]['canonicalUrl'] = 'https://www.douyin.com/video/99999'
            batch['candidates'][0]['media'][0]['url'] = 'https://v26-web.douyinvod.com/failed.mp4'
            batch['candidates'][0]['media'][0]['variants'] = []
            batch['candidates'][0]['media'][0]['originalWorkUrl'] = 'https://www.douyin.com/video/99999'
            run.context.route('https://v26-web.douyinvod.com/failed.mp4', lambda route: route.fulfill(status=403))
            failed = collector.evaluate("async batch=>chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch})", batch)
            assert failed['ok'] is False and failed['code'] == 'video_component_required', failed
            task = collector.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
            assert task['status'] == 'waiting-component' and task['input']['batch']['candidates'][0]['canonicalUrl'].endswith('/99999'), task
            state = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
            assert len(state['entries']) == 2, 'Missing originals must not create a player or a false saved case'
            collector.reload()
            expect(collector.locator('#video-component-setup')).to_be_visible()
            expect(collector.locator('#video-component-setup button')).to_have_text('安装视频组件')
            library = run.open_page('library.html')
            expect(library.locator(f'.case-card[data-entry-id="{saved["id"]}"]')).to_be_visible()
            expect(library.locator('#library-loading')).to_be_hidden()
            library.get_by_role('button', name='设置', exact=True).click()
            library.locator('[data-settings-tab="general"]').click()
            expect(library.locator('#video-online-only')).not_to_be_checked()
            library.locator('#video-online-only').check()
            wait_for_async_condition(library, "async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).uiPreferences.videoOnlineOnly")
            library.reload()
            expect(library.locator(f'.case-card[data-entry-id="{saved["id"]}"]')).to_be_visible()
            expect(library.locator('#library-loading')).to_be_hidden()
            library.get_by_role('button', name='设置', exact=True).click()
            library.locator('[data-settings-tab="general"]').click()
            expect(library.locator('#video-online-only')).to_be_checked()
            for width in [1280, 390]:
                library.set_viewport_size({'width': width, 'height': 900})
                library.locator('#video-online-only').scroll_into_view_if_needed()
                library.screenshot(path=f'/tmp/pd-video-settings-{width}.png')
            print(json.dumps({'selectedOriginalSaved': True, 'bytes': saved['size'], 'onlineOnlyNoDownload': True, 'failedOriginalRetainsRetry': True, 'settingPersists': True}))


if __name__ == '__main__':
    main()
