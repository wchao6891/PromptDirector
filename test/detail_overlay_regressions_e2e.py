"""Closing fullscreen must return browsing; expanding projects must keep selection open."""
import sys
import os
import re
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session

def main(mode='all'):
    out=Path(os.environ['PD_E2E_ARTIFACT_DIR']) if os.environ.get('PD_E2E_ARTIFACT_DIR') else None
    if out: out.mkdir(parents=True,exist_ok=True)
    with extension_session('pd-detail-overlay-',viewport={'width':1440,'height':900}) as run:
        setup=run.open_page('collector.html')
        entry={'id':'case','title':'全屏与菜单验收','text':'原始内容保持','mediaAssets':[{'id':'video','kind':'video','storageMode':'managed','mimeType':'video/mp4','width':320,'height':180}],'primaryMediaId':'video'}
        projects=[{'id':'parent','name':'父项目','parentId':None,'order':0,'entryIds':[]},{'id':'child','name':'子项目','parentId':'parent','order':0,'entryIds':[]}]
        image={'id':'picture','title':'图片提示词审片','text':'图片原词保持','mediaAssets':[{'id':'image','kind':'image','storageMode':'managed','mimeType':'image/png','width':400,'height':300}],'primaryMediaId':'image'}
        article={**image,'id':'article','title':'资料中的图片','contentRole':'reference','classification':{'pathIds':['content:reference'],'status':'confirmed'},'articleDocument':{'version':1,'blocks':[{'id':'paragraph','kind':'paragraph','text':'资料正文保留'},{'id':'figure','kind':'image','assetId':'image'}]}}
        run.seed_storage(setup,{'entries':[entry,image,article,{'id':'other','title':'可继续打开的案例','text':'第二个案例'}],'organizerState':{'version':4,'collections':projects},'uiPreferences':{'locale':'zh-CN','motion':'reduced'}})
        setup.evaluate("async bytes=>{const{saveMediaBlob}=await import('./media-store.js');await saveMediaBlob('video',new Blob([new Uint8Array(bytes)],{type:'video/mp4'}))}",list((Path(__file__).parent/'fixtures/review-workspace-smoke.mp4').read_bytes()))
        setup.evaluate("async()=>{const{saveMediaBlob}=await import('./media-store.js');const c=document.createElement('canvas');c.width=400;c.height=300;await saveMediaBlob('image',await new Promise(r=>c.toBlob(r,'image/png')))}")
        p=run.open_page('library.html');p.locator('.case-card[data-entry-id=case]').click()
        if mode in ['all','fullscreen']:
            p.get_by_role('button',name='播放视频',exact=True).click()
            p.wait_for_function("()=>document.querySelector('.detail-video').readyState>=2")
            p.locator('.detail-video').evaluate('v=>{v.pause();v.currentTime=.8;window.playerBeforeReview=v}')
            p.locator('.review-transport').get_by_role('button',name='审片',exact=True).click()
            expect(p.locator('#detail-drawer')).to_have_class(re.compile('.*is-reviewing.*'))
            assert p.evaluate('()=>document.fullscreenElement===null && document.querySelector(".detail-video")===window.playerBeforeReview && Math.abs(window.playerBeforeReview.currentTime-.8)<.05')
            p.locator('.review-transport').get_by_role('button',name='退出审片',exact=True).click()
            expect(p.locator('#detail-drawer')).not_to_have_class(re.compile('.*is-reviewing.*'))
            # Defensive exit also covers embedded/native players requesting real fullscreen.
            p.locator('#detail-drawer').evaluate('d=>d.requestFullscreen()')
            p.wait_for_function('()=>Boolean(document.fullscreenElement)')
            p.get_by_role('button',name='关闭详情',exact=True).click()
            p.wait_for_function("()=>document.querySelector('#detail-drawer').getAttribute('aria-hidden')==='true'")
            assert p.evaluate('()=>document.fullscreenElement===null'), '关闭详情后隐藏面板仍占据全屏，浏览需要再次Esc'
            p.locator('.case-card[data-entry-id=other]').click();expect(p.locator('.detail-title')).to_have_text('可继续打开的案例')
            p.get_by_role('button',name='关闭详情',exact=True).click();p.locator('.case-card[data-entry-id=case]').click()
        if mode in ['all','project']:
            menu=p.locator('.detail-project-menu');menu.locator('summary').click()
            root=menu.locator('[data-collection-id=parent]')
            root.locator(':scope > .detail-project-tree-line .project-disclosure').click()
            expect(menu).to_have_attribute('open','')
            expect(menu.locator('[data-collection-id=child]')).to_be_visible()
            menu.locator('[data-collection-id=child] input').check()
            expect(menu).to_have_attribute('open','')
            p.wait_for_function("()=>chrome.storage.local.get('organizerState').then(s=>s.organizerState.collections.find(c=>c.id==='child').entryIds.includes('case'))")
            menu.get_by_role('searchbox').press('Escape');expect(menu).not_to_have_attribute('open','')
        if mode in ['all','drag']:
            org=p.locator('.detail-quick-organization');org.scroll_into_view_if_needed()
            org.get_by_role('button',name='添加标签',exact=True).click()
            row=org.locator('.tag-editor-row');handle=row.locator('.panel-drag-handle');before=row.bounding_box();head=handle.bounding_box()
            p.mouse.move(head['x']+head['width']/2,head['y']+head['height']/2);p.mouse.down();p.mouse.move(head['x']+head['width']/2-180,head['y']-100,steps=5);p.mouse.up()
            after=row.bounding_box();assert abs(after['x']-before['x'])>100,(before,after)
            if out:p.screenshot(path=str(out/'tag-drag.png'))
            p.set_viewport_size({'width':390,'height':900})
            p.wait_for_function("()=>{const r=document.querySelector('.detail-quick-organization .tag-editor-row').getBoundingClientRect();return innerWidth===390 && r.left>=0 && r.right<=innerWidth}")
            bounds=row.bounding_box();assert bounds['x']>=0 and bounds['x']+bounds['width']<=390,bounds
            p.set_viewport_size({'width':1440,'height':900})
            field=org.get_by_role('textbox',name='添加标签',exact=True);field.fill('拖动后的标签');field.press('Enter');expect(field).to_have_value('')
            p.wait_for_function("()=>import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries')).then(s=>s.entries.find(e=>e.id==='case').customLabels.includes('拖动后的标签'))")
            field.press('Escape');p.get_by_role('button',name='关闭详情',exact=True).click()
            p.locator('#open-settings').click();dialog=p.locator('#settings-dialog');before=dialog.bounding_box();header=dialog.locator('.ui-dialog-header').bounding_box()
            for delta in [-100,-200]:
                header=dialog.locator('.ui-dialog-header').bounding_box()
                p.mouse.move(header['x']+60,header['y']+25);p.mouse.down();p.mouse.move(header['x']+60+delta,header['y']+45,steps=5);p.mouse.up()
            after=dialog.bounding_box();assert abs(after['x']-before['x'])>150,(before,after)
            if out:p.screenshot(path=str(out/'settings-drag.png'))
            p.locator('#settings-close').click();p.locator('#open-settings').click();reopened=dialog.bounding_box();assert abs(reopened['x']-before['x'])<2,(before,reopened)
            p.locator('#settings-close').click()
            p.locator('.case-card[data-entry-id=picture]').click();p.locator('.detail-image').click()
            expect(p.locator('#detail-drawer')).to_have_class(re.compile('.*is-reviewing.*'))
            assert p.evaluate('()=>document.fullscreenElement===null && !document.querySelector("#image-lightbox")')
            if out:p.screenshot(path=str(out/'image-review.png'))
            p.locator('#detail-review-toggle').click();expect(p.locator('.original-prompt-panel .prompt-read-body')).to_have_text(image['text'])
            p.locator('#detail-close').click();p.locator('.case-card[data-entry-id=article]').click()
            p.locator('.article-document-image').click();expect(p.locator('#detail-drawer')).to_have_class(re.compile('.*is-reviewing.*'))
            expect(p.locator('.auxiliary-review-gallery .detail-image')).to_be_visible()
            p.locator('#detail-review-toggle').click();expect(p.locator('.article-document-reader')).to_be_visible();expect(p.locator('.auxiliary-review-gallery')).to_be_hidden()
            p.locator('#detail-close').click()
            p.locator('#temporary-review-file').set_input_files(str(Path(__file__).parent/'fixtures/review-workspace-smoke.mp4'))
            temporary=p.locator('#temporary-review-dialog');expect(temporary).to_be_visible()
            expect(temporary.get_by_role('button',name='全屏',exact=True)).to_have_count(0)
            temporary.locator('#temporary-review-media').evaluate('d=>d.requestFullscreen()')
            # A native media fullscreen hides the outer controls; invoke the same close handler.
            p.locator('#temporary-review-close').evaluate('b=>b.click()');expect(temporary).not_to_be_visible()
            assert p.evaluate('()=>document.fullscreenElement===null')
        print({'mode':mode,'fullscreenExit':True,'unifiedReviewPreservesPlayer':True,'treeStaysOpen':True,'tagsDragAndSave':True,'businessDialogsDragAndRecenter':True,'imagesEnterReview':True})

if __name__=='__main__':main(sys.argv[1] if len(sys.argv)>1 else 'all')
