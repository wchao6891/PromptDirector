"""Synthetic assets; real library cover selection, upload, persistence and article order."""
from pathlib import Path
import base64
from playwright.sync_api import expect
from e2e_support import extension_session, base_entry


def main():
    with extension_session('case-covers-', viewport={'width': 1280, 'height': 900}) as run:
        page = run.open_page('collector.html')
        run.seed_storage(page, {'entries': [], 'uiPreferences': {'motion': 'reduced'}})
        image = page.evaluate('''async () => {
          const {saveMediaBlob}=await import('./media-store.js');
          const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
          const ctx=canvas.getContext('2d');
          for (const [id,color] of [['first','#396b81'],['second','#b07043']]) {
            ctx.fillStyle=color;ctx.fillRect(0,0,640,360);
            await saveMediaBlob(id,await new Promise(resolve=>canvas.toBlob(resolve)));
          }
          return canvas.toDataURL();
        }''')
        article = base_entry('article-cover', '文章封面测试', '文章原文', 'content:reference', 0)
        article.update(mediaAssets=[{'id': 'doc', 'kind': 'document', 'mimeType': 'text/plain'},
                                    {'id': 'first', 'kind': 'image', 'sourceTitle': '第一张图', 'width': 640, 'height': 360},
                                    {'id': 'second', 'kind': 'image', 'sourceTitle': '第二张图', 'width': 640, 'height': 360}], primaryMediaId='doc',
                       sourceFacts={'pageType': 'article'}, articleDocument={'version': 1, 'blocks': [
                           {'id': 'text', 'kind': 'paragraph', 'text': '文章原文'},
                           {'id': 'one', 'kind': 'image', 'assetId': 'first'},
                           {'id': 'two', 'kind': 'image', 'assetId': 'second'}]})
        video = base_entry('video-cover', '视频封面测试', '', 'content:video-case', 1)
        video.update(mediaAssets=[{'id': 'video', 'kind': 'video', 'storageMode': 'reference',
                                    'sourceUrl': 'https://www.bilibili.com/video/BV1ntYN6NEAi/',
                                    'reference': {'url': 'https://www.bilibili.com/video/BV1ntYN6NEAi/', 'provider': 'bilibili', 'playbackMode': 'embed'}}], primaryMediaId='video')
        text = base_entry('text-cover', '纯文字测试', '纯文字内容', 'content:reference', 2)
        text.update(mediaAssets=[], primaryMediaId='')
        run.seed_storage(page, {'entries': [article, video, text], 'uiPreferences': {'motion': 'reduced'}})
        library = run.open_page('library.html')
        expect(library.locator('.case-card[data-entry-id="article-cover"] img')).to_have_attribute('data-visual-id', 'first')
        expect(library.locator('.case-card[data-entry-id="text-cover"] .case-text-cover')).to_be_visible()
        library.locator('.case-card[data-entry-id="article-cover"]').click()
        library.locator('.entry-editor > summary').click()
        library.get_by_role('button', name='更换封面', exact=True).click()
        expect(library.locator('.case-cover-option')).to_have_count(2)
        library.locator('.case-cover-option[data-asset-id="second"]').click()
        expect(library.locator('#promptdirector-app-dialog')).to_have_count(0)
        saved = library.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.find(e=>e.id==='article-cover')")
        assert saved['coverVisualId'] == 'second' and saved['primaryMediaId'] == 'doc', saved
        assert [b.get('assetId') for b in saved['articleDocument']['blocks'] if b['kind']=='image'] == ['first', 'second']
        library.locator('#detail-close').click()
        expect(library.locator('.case-card[data-entry-id="article-cover"] img')).to_have_attribute('data-visual-id', 'second')
        library.locator('.case-card[data-entry-id="video-cover"]').click()
        expect(library.get_by_role('button', name='逆推视频提示词', exact=True)).to_have_class('button-secondary video-analysis-run')
        library.screenshot(path='/tmp/pd-b14-video-secondary.png', animations='disabled')
        library.locator('.entry-editor > summary').click()
        library.get_by_role('button', name='更换封面', exact=True).click()
        library.locator('#promptdirector-app-dialog input[type=file]').set_input_files({
            'name': 'custom-cover.png', 'mimeType': 'image/png', 'buffer': base64.b64decode(image.split(',')[1])})
        expect(library.locator('#promptdirector-app-dialog')).to_have_count(0)
        saved = library.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.find(e=>e.id==='video-cover')")
        assert saved['primaryMediaId'] == 'video', saved
        cover_id = saved['coverVisualId']
        assert next(a for a in saved['mediaAssets'] if a['id']==cover_id)['usage'] == 'poster'
        expect(library.locator('.referenced-video-embed iframe')).to_be_visible()
        library.locator('#detail-close').click()
        library.reload()
        expect(library.locator('.case-card[data-entry-id="video-cover"] img')).to_have_attribute('data-visual-id', cover_id)
        library.locator('.case-card[data-entry-id="article-cover"]').click()
        library.locator('.entry-editor > summary').click()
        library.get_by_role('button', name='更换封面', exact=True).click()
        output = Path('/tmp/pd-b14-covers'); output.mkdir(exist_ok=True)
        for theme in ['dark', 'light']:
            library.evaluate('theme=>document.documentElement.dataset.theme=theme', theme)
            for width in [1280, 390]:
                library.set_viewport_size({'width': width, 'height': 900})
                library.screenshot(path=str(output / f'cover-{theme}-{width}.png'), animations='disabled')
                assert library.evaluate('document.documentElement.scrollWidth <= innerWidth')
        library.locator('#promptdirector-app-dialog .app-dialog-close').click()
        assert not run.page_errors, run.page_errors
        print({'articleImageSelection': True, 'articleOrderPreserved': True, 'videoUploadAndPrimaryPreserved': True,
               'reloadCover': True, 'noImageTextFallback': True, 'secondaryVideoAnalysis': True})


if __name__ == '__main__':
    main()
