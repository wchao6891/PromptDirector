"""Synthetic video responses with live-checked field names; real capture, save, readback and playback.
The temporary manifest pregrants only fixture origins. Native permission UI is not exercised.
"""
import hashlib
import json
import tempfile
from pathlib import Path

from playwright.sync_api import expect
from e2e_support import EXTENSION_DIR, extension_session
from page_capture_e2e import fixture_png

ORIGIN = 'https://jimeng.jianying.com'
CDN = 'https://v6-artist.vlabvod.com'
IMAGES = 'https://p3-dreamina-sign.byteimg.com'
WORK_ID = '7490123456789012345'
OTHER_ID = '7490123456789012346'
PROMPT = '第一段视频原始提示词\n第二段视频原始提示词'
VIDEO = CDN + '/current-original/video/'


def main():
    item = {'common_attr': {'id': WORK_ID, 'title': '当前视频作品', 'description': '剧情第一段\n剧情第二段', 'cover_url': IMAGES + '/cover.png'},
            'author': {'name': '视频作者'}, 'aigc_image_params': {'text2video_params': {'video_gen_inputs': [{'prompt': '', 'unified_edit_input': {'meta_list': [{'meta_type': 'text', 'text': PROMPT}]}}]}},
            'video': {'duration': 3.2, 'origin_video': {'video_url': VIDEO, 'width': 1080, 'height': 1920}}}
    other = {'common_attr': {'id': OTHER_ID, 'title': '背景图片作品'}, 'author': {'name': '图片作者'},
             'aigc_image_params': {'text2image_params': {'prompt': '其他作品提示词'}},
             'image': {'large_images': [{'image_url': IMAGES + '/other.png', 'width': 512, 'height': 512}]}}
    # First unrelated item catches accidental first-item fallback in detail capture.
    payload = {'data': {'item_list': [other, item]}}
    html = '''<!doctype html><meta charset="utf-8"><title>即梦隔离采集样本</title><main>作品列表</main>
    <button id="open-image">打开图片作品</button>
    <section data-detail-container-appearance style="display:none"><img id="detail-image" src="''' + IMAGES + '''/other.png"></section>
    <script>window.__get_explore_result=''' + json.dumps(payload) + ''';
    const detail=document.querySelector('[data-detail-container-appearance]');
    document.querySelector('#detail-image').__reactFiber$fixture={memoizedProps:{renderModel:{id:"''' + OTHER_ID + '''"}},return:null};
    document.querySelector('#open-image').onclick=()=>detail.style.display='block';
    </script>'''
    media_root = Path(__file__).parent / 'fixtures/hls-audio-video'
    video_bytes = b''.join((media_root / name).read_bytes() for name in ['init.mp4', 'stream0.m4s', 'stream1.m4s', 'stream2.m4s'])
    with tempfile.TemporaryDirectory(prefix='jimeng-video-runtime-') as temp:
        extension = Path(temp)
        for file in EXTENSION_DIR.iterdir():
            if file.name not in {'manifest.json', '.git', 'node_modules', 'dist'}:
                (extension / file.name).symlink_to(file, target_is_directory=file.is_dir())
        manifest = json.loads((EXTENSION_DIR / 'manifest.json').read_text())
        manifest['host_permissions'] += [ORIGIN + '/*', CDN + '/*', IMAGES + '/*']
        (extension / 'manifest.json').write_text(json.dumps(manifest))
        with extension_session('jimeng-video-capture-', extension_dir=extension) as run:
            run.context.route(ORIGIN + '/**', lambda route: route.fulfill(body=html, content_type='text/html'))
            run.context.route(CDN + '/**', lambda route: route.fulfill(body=video_bytes, content_type='video/mp4', headers={'Access-Control-Allow-Origin': '*'}))
            run.context.route(IMAGES + '/**', lambda route: route.fulfill(body=fixture_png(route.request.url), content_type='image/png'))
            collector = run.open_page('collector.html')
            run.seed_storage(collector, {'entries': [], 'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-09-19T00:00:00Z', 'clipboardIncluded': True}})
            source = run.context.new_page()
            source.goto(ORIGIN + '/ai-tool/explore')
            source.bring_to_front()
            batch = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert batch['ok'], batch
            candidates = batch['batch']['candidates']
            assert len(candidates) == 2, candidates
            assert {c['sourceFacts']['itemId']: c['media'][0]['kind'] for c in candidates} == {WORK_ID: 'video', OTHER_ID: 'image'}, candidates
            # The observer must retain the video after the page consumes the initial response.
            source.evaluate('()=>delete window.__get_explore_result')
            retained = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert retained['ok'], retained
            assert [(c['sourceFacts']['itemId'], c['contentText'], [(m['kind'], m['url']) for m in c['media']]) for c in retained['batch']['candidates']] == [(c['sourceFacts']['itemId'], c['contentText'], [(m['kind'], m['url']) for m in c['media']]) for c in candidates]
            # Open the selected work while the unrelated earlier item remains in page state.
            source.goto(ORIGIN + '/ai-tool/work-detail/' + WORK_ID)
            source.bring_to_front()
            collector.evaluate("()=>document.querySelector('#start-page-capture').click()")
            expect(collector.locator('.page-capture-item')).to_have_count(1)
            expect(collector.locator('#page-capture-list')).to_contain_text('当前视频作品')
            expect(collector.locator('#page-capture-list')).not_to_contain_text('背景图片作品')
            collector.locator('.page-capture-confirm').click()
            expect(collector.locator('#page-capture-media-review-list .page-capture-media-review-item')).to_have_count(1)
            collector.locator('#page-capture-save').click()
            expect(collector.locator('#page-capture')).to_be_hidden(timeout=15000)
            entries = collector.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries) == 1, entries
            entry = entries[0]
            assert entry['sourceFacts']['itemId'] == WORK_ID
            assert '第二段视频原始提示词' in entry['text'] and '其他作品' not in entry['text'], entry
            content_assets = [a for a in entry['mediaAssets'] if a.get('usage') != 'poster']
            assert len(content_assets) == 1, entry
            asset = content_assets[0]
            assert asset['kind'] == 'video' and asset['storageMode'] == 'managed', asset
            assert any(p['assetId'] == asset['id'] and p['text'] == PROMPT for p in entry['mediaPrompts']), entry
            digest = collector.evaluate("""async id=>{
              const blob=await (await import('./media-store.js')).getMediaBlob(id);
              return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');
            }""", asset['id'])
            assert digest == hashlib.sha256(video_bytes).hexdigest()
            collector.reload()
            assert len(collector.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")) == 1
            library = run.open_page('library.html')
            library.locator('.case-card').first.click()
            expect(library.locator('#detail-drawer')).to_contain_text('第二段视频原始提示词')
            video = library.locator('#detail-drawer video').first
            video.evaluate('(v)=>{v.muted=true;}')
            library.get_by_role('button',name='播放视频',exact=True).click()
            library.wait_for_function("()=>document.querySelector('#detail-drawer video')?.ended")
            assert video.evaluate('v=>v.webkitAudioDecodedByteCount>0 && v.webkitVideoDecodedByteCount>0')
            source.goto(ORIGIN + '/ai-tool/explore')
            source.locator('#open-image').click()
            assert source.url == ORIGIN + '/ai-tool/explore'
            source.bring_to_front()
            collector.evaluate("()=>document.querySelector('#start-page-capture').click()")
            expect(collector.locator('.page-capture-item')).to_have_count(1)
            expect(collector.locator('#page-capture-list')).to_contain_text('背景图片作品')
            expect(collector.locator('#page-capture-list')).not_to_contain_text('当前视频作品')
            collector.locator('.page-capture-confirm').click()
            collector.locator('#page-capture-save').click()
            expect(collector.locator('#page-capture')).to_be_hidden(timeout=15000)
            saved = collector.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(saved) == 2, saved
            image_entry = next(e for e in saved if e['sourceFacts']['itemId'] == OTHER_ID)
            assert len(image_entry['mediaAssets']) == 1 and image_entry['mediaAssets'][0]['kind'] == 'image', image_entry
            assert any(p['assetId'] == image_entry['mediaAssets'][0]['id'] and p['text'] == '其他作品提示词' for p in image_entry['mediaPrompts'])
            # Closing the work overlay restores intentional batch capture on the same URL.
            source.evaluate("()=>document.querySelector('[data-detail-container-appearance]').style.display='none'")
            source.bring_to_front()
            restored = collector.evaluate("async()=>chrome.runtime.sendMessage({type:'START_PAGE_CAPTURE',mode:'loaded'})")
            assert restored['ok'] and len(restored['batch']['candidates']) == 2, restored
            print({'mixed_list': True, 'retained_video': True, 'exact_detail': True, 'saved_video_sha256': digest,
                   'prompt_pairing': True, 'sidebar_cleared': True, 'reload_retained': True, 'audio_video_playback': True,
                   'same_url_image_overlay_save': True, 'close_overlay_restores_list': True,
                   'native_permission_ui': 'not exercised; temporary manifest pregrants fixture origins'})


if __name__ == '__main__':
    main()
