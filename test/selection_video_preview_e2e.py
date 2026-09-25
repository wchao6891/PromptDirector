"""Both selection surfaces show motion without changing the selected references."""
import tempfile
import base64
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session
from video_detail_layout_e2e import video_asset


def main():
    entry = base_entry('motion-source', '动作视频来源', '保留完整原始提示词', 'content:prompt:video', 1)
    asset = video_asset('motion-video', '2026-08-08T00:00:00.000Z')
    entry['mediaAssets'] = [asset]
    entry['primaryMediaId'] = asset['id']
    entry['mediaPrompts'] = [{'assetId':asset['id'],'text':'保留完整原始提示词'}]
    long_name = '多层项目中的完整名称必须可以读到最后一个字'
    with extension_session('pd-selection-video-') as run:
        setup = run.open_page('collector.html')
        run.seed_storage(setup, {'entries':[entry], 'organizerState':{'version':6,'collections':[{'id':'collection:long','name':long_name,'order':0,'entryIds':[entry['id']]}]}})
        setup.evaluate('''async ({id,data}) => { const {saveMediaBlob}=await import('./media-store.js');
          await saveMediaBlob(id,new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'video/mp4'}),{checkCapacity:false});
        }''', {'id':asset['id'],'data':base64.b64encode((Path(__file__).parent/'fixtures/detail-portrait-smoke.mp4').read_bytes()).decode()})
        skills = run.open_page('skills.html')
        skills.locator('#skill-create').click()
        skills.locator('#skill-project-picker summary').click()
        menu = skills.locator('#skill-project-filter')
        expect(menu).to_contain_text(long_name)
        assert menu.bounding_box()['width'] > 250
        assert menu.locator('button').last.evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
        skills.screenshot(path=str(Path(tempfile.gettempdir()) / "pd-skill-project-menu.png"))
        menu.get_by_role('option',name=long_name).click()
        skills.wait_for_function('() => document.querySelector(".skill-video-cover video")?.readyState >= 2')
        skills.locator('.skill-case-visual').hover()
        hover=skills.locator('.case-video-preview')
        expect(hover).to_be_visible()
        skills.wait_for_function('() => document.querySelector(".case-video-preview")?.currentTime > 0')
        expect(skills.locator('.skill-case')).to_have_attribute('data-selected','false')
        skills.locator('#skill-workspace-title').hover()
        expect(hover).to_have_count(0)
        skills.locator('.skill-case-play').click()
        skills.wait_for_function('() => document.querySelector(".skill-source-video video")?.currentTime > 0')
        skills.locator('#skill-source-cancel').click()
        expect(skills.locator('#skill-selected-count')).to_have_text('0')
        page = run.open_page('composer.html?type=video')
        page.locator('#composer-reference-open').click()
        surface = page.locator('.composer-case-select-preview').first
        surface.hover()
        page.wait_for_function('() => document.querySelector(".case-video-preview")?.currentTime > 0')
        expect(page.locator('.composer-case-preview-checkbox')).not_to_be_checked()
        page.screenshot(path=str(Path(tempfile.gettempdir()) / "pd-composer-video-hover.png"))
        page.locator('#composer-reference-search').hover()
        expect(page.locator('.case-video-preview')).to_have_count(0)
        page.get_by_role('button',name='播放视频',exact=True).click()
        page.wait_for_function('() => document.querySelector(".composer-reference-preview-dialog video")?.currentTime > 0')
        page.get_by_role('button',name='关闭视频预览').click()
        expect(page.locator('.composer-reference-preview-dialog')).to_have_count(0)
        surface.hover()
        expect(page.locator('.case-video-preview')).to_have_count(1)
        page.locator('#composer-reference-cancel').click()
        expect(page.locator('.case-video-preview')).to_have_count(0)
        # Image-direction users still need to watch a video before borrowing its text.
        image_page = run.open_page('composer.html?type=image')
        image_page.locator('#composer-reference-open').click()
        image_surface = image_page.locator('.composer-case-select-preview').first
        expect(image_page.locator('.composer-case-inspect svg use')).to_have_attribute('href', __import__('re').compile(r'#icon-play$'))
        expect(image_page.locator('.composer-case-inspect')).to_have_text('')
        image_surface.hover()
        image_page.wait_for_function('() => document.querySelector(".case-video-preview")?.currentTime > 0')
        image_page.get_by_role('button', name='播放视频', exact=True).click()
        image_page.wait_for_function('() => document.querySelector(".composer-reference-preview-dialog video")?.currentTime > 0')
        image_page.get_by_role('button', name='关闭视频预览').click()
        image_page.locator('.composer-case-preview-checkbox').check()
        expect(image_page.locator('#composer-case-selection-count')).to_contain_text('1')
        image_page.locator('#composer-reference-apply').click()
        expect(image_page.locator('#composer-reference-open')).to_contain_text('1')
        print('PASS long project menu, decoded video cover, Skill and Composer hover/play/leave/close, selection unchanged')

if __name__=='__main__': main()
