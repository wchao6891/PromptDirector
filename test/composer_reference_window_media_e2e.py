"""Mixed-media reference-window regression; isolated local fixtures, no model calls."""
from __future__ import annotations

import base64
from pathlib import Path

from playwright.sync_api import expect

from composer_reference_picker_e2e import current_session
from e2e_support import base_entry, extension_session


CASE_ID = 'window-mixed'
CASE_TITLE = '窗口混合素材'
VIDEO_IDS = ['window-video-one', 'window-video-two']
POSTER_IDS = ['window-poster-one', 'window-poster-two']
PROMPTS = [
    '第一支视频完整原词\n' + '\n'.join(f'镜头 {index}：角色沿雨夜街道前进，摄影机保持低机位跟随，保留环境光与步伐变化。' for index in range(1, 17)),
    '第二支视频完整原词\n' + '\n'.join(f'镜头 {index}：摄影机绕过人物肩膀，逐步露出远处城市，保持连续空间关系。' for index in range(1, 17)),
]


def mixed_card(page):
    return page.locator(f'.composer-case-option[data-entry-id="{CASE_ID}"]')


def media_checkbox(page, asset_id):
    return mixed_card(page).locator('.composer-case-assets').first.locator(
        f'.composer-case-asset[data-asset-id="{asset_id}"] input[type=checkbox]')


def source_checkbox(page, asset_id, label):
    return mixed_card(page).locator(
        f'.composer-case-assets[aria-label="{CASE_TITLE}的视频文字来源"] '
        f'.composer-case-asset[data-asset-id="{asset_id}"]'
    ).filter(has_text=label).locator('input[type=checkbox]')


def assert_other_card_unchanged(page):
    assert page.evaluate("() => Boolean(window.otherCard) && window.otherCard === document.querySelector('.composer-case-option[data-entry-id=window-other]')"), \
        'A local video/source change must not replace the unrelated reference card'


def toggle_with_focus(page, checkbox, selected):
    # Space triggers the real checkbox change path. The target card is replaced
    # during video/source updates; the equivalent new control must regain focus.
    checkbox.focus()
    checkbox.press('Space')
    expect(checkbox).to_be_checked(checked=selected)
    expect(checkbox).to_be_focused()
    assert_other_card_unchanged(page)


def assert_images_readable(page):
    page.wait_for_function('''() => {
      const images = [...document.querySelectorAll('.composer-case-option img')];
      return images.length >= 4 && images.every(image => image.src && image.complete && image.naturalWidth > 0);
    }''')
    # A decoded image may still look fine after its URL was revoked. Fetch the
    # current URLs too, so replace/release ordering cannot hide behind decoding.
    images = page.evaluate('''async () => Promise.all([...document.querySelectorAll('.composer-case-option img')].map(async image => {
      try {
        const response = await fetch(image.src);
        const bytes = new Uint8Array(await response.arrayBuffer());
        return {ok:response.ok, png:[...bytes.slice(0,8)].join(',') === '137,80,78,71,13,10,26,10', src:image.src};
      } catch(error) { return {ok:false, error:error.message, src:image.src}; }
    }))''')
    assert all(image['ok'] and image.get('png') for image in images), images


def assert_selected_sources(page):
    for asset_id in VIDEO_IDS:
        expect(media_checkbox(page, asset_id)).to_be_checked()
        expect(source_checkbox(page, asset_id, '原始提示词')).to_be_checked()
        expect(source_checkbox(page, asset_id, 'AI 视觉逆推')).not_to_be_checked()
    expect(media_checkbox(page, 'window-image')).not_to_be_checked()
    expect(source_checkbox(page, VIDEO_IDS[0], '人工时间点笔记')).to_be_checked()
    expect(source_checkbox(page, VIDEO_IDS[1], '人工时间点笔记')).not_to_be_checked()


def main():
    video_bytes = (Path(__file__).parent / 'fixtures/review-workspace-smoke.mp4').read_bytes()
    video_base64 = base64.b64encode(video_bytes).decode()
    with extension_session('pd-reference-window-media-', viewport={'width': 1280, 'height': 1000}) as run:
        run.context.set_offline(True)
        setup = run.open_page('collector.html')
        # Real PNG originals, distinct posters, and the repository's valid MP4.
        pngs = setup.evaluate('''async () => {
          const result = {};
          for (const [id,color] of [['window-image','#be473b'],['window-poster-one','#246bbb'],
              ['window-poster-two','#31883e'],['window-other-image','#d19822']]) {
            const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
            const context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,8,8);
            result[id]=canvas.toDataURL('image/png').split(',')[1];
          }
          return result;
        }''')
        entry = base_entry(CASE_ID, CASE_TITLE, '案例正文不能覆盖逐视频原词', 'content:prompt:video')
        entry['mediaAssets'] = [{'id': 'window-image', 'kind': 'image', 'usage': 'content',
            'storageMode': 'managed', 'mimeType': 'image/png', 'width': 8, 'height': 8,
            'byteSize': len(base64.b64decode(pngs['window-image']))}]
        entry['mediaPrompts'] = [{'assetId': 'window-image', 'text': '未选图片的独立原词'}]
        entry['timeNotes'] = []
        entry['videoAnalyses'] = []
        for index, (video_id, poster_id) in enumerate(zip(VIDEO_IDS, POSTER_IDS)):
            entry['mediaAssets'].extend([
                {'id': video_id, 'kind': 'video', 'usage': 'content', 'storageMode': 'managed',
                 'mimeType': 'video/mp4', 'width': 320, 'height': 180, 'byteSize': len(video_bytes),
                 'posterAssetId': poster_id},
                {'id': poster_id, 'kind': 'image', 'usage': 'poster', 'storageMode': 'managed',
                 'mimeType': 'image/png', 'width': 8, 'height': 8,
                 'byteSize': len(base64.b64decode(pngs[poster_id]))},
            ])
            entry['mediaPrompts'].append({'assetId': video_id, 'text': PROMPTS[index], 'textRevision': 3})
            entry['timeNotes'].append({'id': f'window-note-{index}', 'assetId': video_id,
                'startMs': 1200 if index == 0 else 2300, 'text': f'第{index + 1}支视频人工笔记',
                'createdAt': '2026-08-30T00:00:00.000Z'})
            entry['videoAnalyses'].append({'id': f'window-reconstruction-{index}', 'assetId': video_id,
                'mode': 'visual-reconstruction', 'requestId': f'window-request-{index}',
                'contractVersion': 'visual-v3-1', 'reconstructionPrompt': f'第{index + 1}支视频未选AI逆推',
                'tags': [], 'uncertainties': [], 'includeTags': False, 'analysisScope': 'visual',
                'finishReason': 'stop', 'version': 2, 'createdAt': '2026-08-30T00:00:01.000Z'})
        entry['primaryMediaId'] = 'window-image'
        other = base_entry('window-other', '其他参考卡', '另一张卡必须保持原来的节点', 'content:prompt:image')
        other['mediaAssets'] = [{'id': 'window-other-image', 'kind': 'image', 'usage': 'content',
            'storageMode': 'managed', 'mimeType': 'image/png', 'width': 8, 'height': 8,
            'byteSize': len(base64.b64decode(pngs['window-other-image']))}]
        other['primaryMediaId'] = 'window-other-image'
        session = setup.evaluate('''async () => {
          const {createComposerSession}=await import('./composer.js');
          return createComposerSession({id:'window-media-session',title:'参考窗口验证',targetType:'video',
            messages:[{id:'window-media-request',role:'user',type:'request',content:'挑选本次视频参考资料'}]});
        }''')
        run.seed_storage(setup, {'entries': [entry, other], 'composerSessions': [session],
            'uiPreferences': {'locale': 'zh-CN', 'theme': 'dark', 'motion': 'reduced'}})
        setup.evaluate('''async ({pngs,videoBase64,videoIds}) => {
          const {saveMediaBlob}=await import('./media-store.js');
          const decode=value=>Uint8Array.from(atob(value),character=>character.charCodeAt(0));
          for(const [id,data] of Object.entries(pngs)) await saveMediaBlob(id,new Blob([decode(data)],{type:'image/png'}),{checkCapacity:false});
          for(const id of videoIds) await saveMediaBlob(id,new Blob([decode(videoBase64)],{type:'video/mp4'}),{checkCapacity:false});
        }''', {'pngs': pngs, 'videoBase64': video_base64, 'videoIds': VIDEO_IDS})

        page = run.open_page('composer.html?session=window-media-session')
        page.locator('#composer-reference-open').click()
        expect(mixed_card(page)).to_be_visible()
        expect(mixed_card(page).locator('.composer-case-assets').first.locator('.composer-case-asset')).to_have_count(3)
        page.evaluate("() => {window.otherCard=document.querySelector('.composer-case-option[data-entry-id=window-other]')}")
        assert_images_readable(page)
        toggle_with_focus(page, media_checkbox(page, VIDEO_IDS[0]), True)
        assert_images_readable(page)
        toggle_with_focus(page, source_checkbox(page, VIDEO_IDS[0], '原始提示词'), False)
        toggle_with_focus(page, source_checkbox(page, VIDEO_IDS[0], '原始提示词'), True)
        toggle_with_focus(page, source_checkbox(page, VIDEO_IDS[0], '人工时间点笔记'), False)
        toggle_with_focus(page, source_checkbox(page, VIDEO_IDS[0], '人工时间点笔记'), True)
        toggle_with_focus(page, source_checkbox(page, VIDEO_IDS[0], 'AI 视觉逆推'), False)
        toggle_with_focus(page, media_checkbox(page, VIDEO_IDS[1]), True)
        toggle_with_focus(page, source_checkbox(page, VIDEO_IDS[1], 'AI 视觉逆推'), False)
        toggle_with_focus(page, source_checkbox(page, VIDEO_IDS[1], '人工时间点笔记'), False)
        assert_selected_sources(page)
        assert_images_readable(page)

        # Filtering exercises the real suspend/release/remount path, not CSS hiding.
        page.evaluate("() => {window.beforeFilterCard=document.querySelector('.composer-case-option[data-entry-id=window-mixed]')}")
        page.locator('#composer-reference-search').fill('其他参考卡')
        expect(mixed_card(page)).to_have_count(0)
        assert page.evaluate('() => !window.beforeFilterCard.isConnected')
        page.locator('#composer-reference-search').fill('')
        expect(mixed_card(page)).to_be_visible()
        assert page.evaluate("() => window.beforeFilterCard !== document.querySelector('.composer-case-option[data-entry-id=window-mixed]')")
        assert_selected_sources(page)
        assert_images_readable(page)
        preview = page.evaluate('''async () => {
          const image=document.querySelector('.composer-case-option[data-entry-id=window-mixed] .composer-video-cover img');
          if(!image) return null;
          const bytes=new Uint8Array(await (await fetch(image.src)).arrayBuffer());
          return btoa(String.fromCharCode(...bytes));
        }''')
        assert preview == pngs[POSTER_IDS[1]], 'The remounted preview must still show the second selected video'
        page.locator('#composer-reference-apply').click()
        expect(page.locator('#composer-reference-workspace')).to_be_hidden()
        expect(page.locator('#composer-reference-open')).to_be_focused()
        snapshots = current_session(page)['referenceSnapshots']
        assert [item['assetId'] for item in snapshots] == VIDEO_IDS, snapshots
        assert [item['originalText'] for item in snapshots] == PROMPTS
        assert [item['kind'] for item in snapshots[0]['referenceSources']] == ['original_prompt', 'time_notes']
        assert [item['text'] for item in snapshots[0]['referenceSources']] == [PROMPTS[0], '[0:01.200] 第1支视频人工笔记']
        assert [item['kind'] for item in snapshots[1]['referenceSources']] == ['original_prompt']
        assert snapshots[1]['referenceSources'][0]['text'] == PROMPTS[1]
        assert '未选AI逆推' not in str(snapshots) and '第2支视频人工笔记' not in str(snapshots)
        assert '未选图片的独立原词' not in str(snapshots)
        page.reload()
        expect(page.locator('#composer-reference-open')).to_be_visible()
        assert current_session(page)['referenceSnapshots'] == snapshots
        page.locator('#composer-reference-open').click()
        assert_selected_sources(page)
        page.locator('#composer-reference-cancel').click()
        expect(page.locator('#composer-reference-open')).to_be_focused()
        original_bytes = page.evaluate('''async ids => {
          const {getMediaBlob}=await import('./media-store.js');
          return Object.fromEntries(await Promise.all(ids.map(async id=>{
            const bytes=new Uint8Array(await (await getMediaBlob(id)).arrayBuffer());
            return [id,btoa(String.fromCharCode(...bytes))];
          })));
        }''', [*pngs, *VIDEO_IDS])
        assert original_bytes == {**pngs, **{asset_id: video_base64 for asset_id in VIDEO_IDS}}
        assert not run.page_errors, run.page_errors
        print({'localVideoRefreshFocusPreserved': True, 'otherCardNodePreserved': True,
               'currentBlobImagesReadable': True, 'filterRemountSelectionAndPreviewPreserved': True,
               'fullOriginalPromptsAndSelectedSourcesSaved': True, 'reloadReadback': True,
               'closeRestoresFocus': True, 'originalMediaBytesUnchanged': True})


if __name__ == '__main__':
    main()
