"""Video source preview must not change the material selected for Skill extraction."""
import tempfile
import base64
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session
from video_detail_layout_e2e import video_asset


def main():
    entry = base_entry('skill-video', '视频预览验收', '', 'content:prompt:video', 1)
    entry['text'] = ''
    asset = video_asset('skill-video-asset', '2026-08-08T00:00:00.000Z')
    entry['mediaAssets'] = [asset]
    entry['primaryMediaId'] = asset['id']
    data = base64.b64encode((Path(__file__).parent/'fixtures/detail-portrait-smoke.mp4').read_bytes()).decode()
    with extension_session('pd-skill-source-video-') as run:
        setup = run.open_page('collector.html')
        run.seed_storage(setup, {'entries':[entry]})
        setup.evaluate('''async ({data,id}) => {
          const {saveMediaBlob} = await import('./media-store.js');
          await saveMediaBlob(id,new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'video/mp4'}),{checkCapacity:false});
        }''', {'data':data,'id':asset['id']})
        page = run.open_page('skills.html')
        page.locator('#skill-create').click()
        page.locator('.skill-case-toggle').click()
        page.locator('.skill-case-detail').click()
        video = page.locator('.skill-source-video video')
        expect(video).to_be_visible()
        assert video.evaluate('(v)=>!v.getAttribute("src") && v.preload==="none"')
        selected = page.locator('.skill-source-asset input:checked').count()
        page.evaluate('''() => {
          window.previewVideo = document.querySelector('.skill-source-video video');
          window.previewVideo.muted = true; window.previewVideo.loop = true;
        }''')
        page.locator('#skill-source-inspector').get_by_role('button',name='播放视频',exact=True).click()
        page.wait_for_function('() => window.previewVideo.currentTime > 0 && !window.previewVideo.paused')
        assert page.locator('.skill-source-asset input:checked').count() == selected
        assert page.locator('#skill-source-apply').bounding_box()['height'] < 60
        page.screenshot(path=str(Path(tempfile.gettempdir()) / "pd-skill-video-wide.png"))
        page.locator('#skill-source-cancel').click()
        assert page.evaluate('window.previewVideo.paused && !window.previewVideo.getAttribute("src")')
        page.locator('.skill-case-detail').click()
        assert page.locator('.skill-source-asset input:checked').count() == selected
        page.set_viewport_size({'width':390,'height':844})
        page.screenshot(path=str(Path(tempfile.gettempdir()) / "pd-skill-video-narrow.png"))
        assert page.locator('#skill-source-inspector').evaluate('(e)=>e.getBoundingClientRect().width<=innerWidth')
        page.locator('#skill-source-apply').click()
        expect(page.locator('#skill-selected-count')).to_have_text('1')
        # Missing original reports the real failure and leaves the selection usable.
        page.evaluate('''async id => { const {deleteMediaBlobs}=await import('./media-store.js'); await deleteMediaBlobs([id]); }''',asset['id'])
        page.locator('.skill-case-detail').click()
        page.locator('#skill-source-inspector').get_by_role('button',name='播放视频',exact=True).click()
        expect(page.locator('.skill-source-video [role=status]')).to_contain_text('本地媒体文件缺失')
        assert page.locator('.skill-source-asset input:checked').count() == selected
        page.locator('#skill-source-cancel').click()
        print('PASS single-video content entry, lazy real playback, independent selection, close cleanup, reopen, narrow layout and missing-original recovery')

if __name__ == '__main__': main()
