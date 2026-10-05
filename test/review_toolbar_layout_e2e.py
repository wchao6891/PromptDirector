"""Current-frame feedback, single-row controls and the information sidebar."""
import hashlib,json,os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session

def main():
    original=(Path(__file__).parent/'fixtures/review-workspace-smoke.mp4').read_bytes()
    with extension_session('pd-review-toolbar-', viewport={'width':1920,'height':900}) as run:
        page=run.open_page('library.html')
        entry={'id':'toolbar','title':'审片与信息面板','text':'完整原始提示词，不因显示模式改变。','mediaAssets':[
            {'id':'video','kind':'video','storageMode':'managed','mimeType':'video/mp4','width':320,'height':180},
            {'id':'picture','kind':'image','storageMode':'managed','mimeType':'image/png','width':50,'height':200}], 'primaryMediaId':'video','customLabels':['原有标签']}
        run.seed_storage(page,{'entries':[entry,{'id':'other','title':'另一条信息','text':'其他案例资料'}]})
        page.evaluate("""async bytes=>{const{saveMediaBlob}=await import('./media-store.js');await saveMediaBlob('video',new Blob([new Uint8Array(bytes)],{type:'video/mp4'}));const c=document.createElement('canvas');c.width=50;c.height=200;await saveMediaBlob('picture',await new Promise(r=>c.toBlob(r,'image/png')));}""",list(original))
        page.reload();page.locator('.case-card[data-entry-id=toolbar]').click()
        expect(page.locator('.detail-visual-rail')).to_be_visible()
        page.get_by_role('button',name='播放视频',exact=True).click()
        page.wait_for_function("()=>document.querySelector('.detail-video').readyState>=2")
        page.locator('.detail-video').evaluate('v=>{v.pause();v.currentTime=.3}')
        expect(page.locator('.detail-video-play')).to_be_hidden()
        page.locator('[data-review-feedback]').click()
        panel=page.locator('.review-feedback-panel')
        panel.locator('textarea').fill('刷新时保留已经写的内容')
        page.locator('.detail-video').evaluate('v=>v.currentTime=1.2')
        panel.get_by_role('button',name='刷新时间',exact=True).click()
        expect(panel.locator('input[type=number]').first).to_have_value('1.2')
        expect(panel.locator('textarea')).to_have_value('刷新时保留已经写的内容')
        page.locator('.detail-video').evaluate('v=>{v.currentTime=.2;v.play()}')
        panel.get_by_role('button',name='刷新时间',exact=True).click()
        position=float(panel.locator('input[type=number]').first.input_value())
        assert .2<=position<2.4,position
        panel.get_by_role('button',name='保存',exact=True).click()
        page.wait_for_function("()=>document.querySelector('.review-feedback-form').dataset.dirty==='false'")
        note=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries[0].timeNotes[0]")
        assert abs(note['startMs']-position*1000)<1 and note['text']=='刷新时保留已经写的内容',note
        page.locator('.detail-video').evaluate('v=>v.pause()')
        panel.get_by_role('button',name='收起备注',exact=True).click()
        def one_row():
            result=page.locator('.detail-visual-caption').evaluate("""e=>{const controls=[...e.querySelectorAll('button')].filter(b=>b.getClientRects().length);const centers=controls.map(b=>{const r=b.getBoundingClientRect();return r.y+r.height/2});return {spread:Math.max(...centers)-Math.min(...centers),nav:e.contains(document.querySelector('.detail-media-navigation')),height:e.getBoundingClientRect().height}}""")
            assert result['nav'] and result['spread']<1,result
            return result
        desktop=one_row()
        page.get_by_role('button',name='审片',exact=True).click()
        expect(page.locator('.detail-visual-rail')).to_be_hidden();one_row()
        page.get_by_role('button',name='下一项媒体',exact=True).click()
        expect(page.locator('.detail-image')).to_be_visible();one_row()
        page.get_by_role('button',name='退出审片',exact=True).click()
        expect(page.locator('.detail-visual-rail')).to_be_visible()
        page.get_by_role('button',name='切换侧栏详情',exact=True).click()
        page.locator('.case-card[data-entry-id=other]').click()
        expect(page.locator('.detail-title')).to_have_text('另一条信息')
        page.locator('.case-card[data-entry-id=toolbar]').click()
        expect(page.locator('.detail-visual-gallery')).to_be_hidden()
        expect(page.locator('.detail-discovery')).to_be_hidden()
        expect(page.locator('.original-prompt-panel .prompt-read-body')).to_have_text(entry['text'])
        icons=page.locator('#detail-review-toggle,#detail-mode-toggle').evaluate_all("es=>es.map(e=>e.querySelector('use').getAttribute('href'))")
        assert len(set(icons))==2,icons
        expect(page.locator('.prompt-more')).to_have_count(0)
        expect(page.get_by_role('button',name='编辑分析规则',exact=True)).to_be_visible()
        page.locator('.sidebar-media-picker').select_option('video')
        page.wait_for_function("()=>document.querySelector('.detail-visual-gallery').dataset.displayedAssetId==='video'")
        assert page.locator('.detail-visual-gallery').is_hidden()
        artifact=os.environ.get('PD_E2E_ARTIFACT_DIR')
        if artifact:page.screenshot(path=str(Path(artifact)/'information-sidebar.png'))
        page.get_by_role('button',name='审片',exact=True).click()
        expect(page.locator('.detail-video')).to_be_visible();expect(page.locator('.detail-visual-rail')).to_be_hidden()
        page.get_by_role('button',name='退出审片',exact=True).click()
        expect(page.locator('.detail-visual-gallery')).to_be_hidden()
        page.get_by_role('button',name='切换全屏详情',exact=True).click()
        expect(page.locator('.detail-visual-gallery')).to_be_visible()
        expect(page.get_by_role('button',name='编辑分析规则',exact=True)).to_be_visible()
        page.set_viewport_size({'width':390,'height':844});mobile=one_row()
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        if artifact:page.screenshot(path=str(Path(artifact)/'single-row-mobile.png'))
        page.reload();expect(page.locator('.case-card')).to_have_count(2)
        saved=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries[0]")
        assert saved['text']==entry['text'] and saved['customLabels']==['原有标签']
        raw=page.evaluate("async()=>{const{getMediaBlob}=await import('./media-store.js');return Array.from(new Uint8Array(await(await getMediaBlob('video')).arrayBuffer()))}")
        assert hashlib.sha256(bytes(raw)).digest()==hashlib.sha256(original).digest()
        print(json.dumps({'refreshPausedAndPlayingTime':True,'draftRetained':True,'savedRefreshedTime':True,'pausedFrameUnobstructed':True,'singleRowDesktop':desktop,'singleRowMobile':mobile,'reviewNoThumbnailRail':True,'sidebarInformationOnly':True,'allSourceDataRetained':True,'distinctModeIcons':icons}))

if __name__=='__main__':main()
