"""Layout persistence, detail reading anchor, and index-status alignment."""
import sys
import os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def main(mode='all'):
    with extension_session('pd-layout-regressions-', viewport={'width':1440,'height':900}) as run:
        setup = run.open_page('collector.html')
        entry = {'id':'picture', 'title':'Layout reading anchor', 'text':'Original words\n' * 100,
                 'mediaAssets':[{'id':'image','kind':'image','storageMode':'managed','mimeType':'image/png','width':400,'height':300}], 'primaryMediaId':'image'}
        video = {**entry, 'id':'video-case','title':'Video reading anchor','text':'Original video words','mediaAssets':[{'id':'video','kind':'video','storageMode':'managed','mimeType':'video/mp4','width':320,'height':180}, {**entry['mediaAssets'][0],'usage':'poster'}],'primaryMediaId':'video'}
        run.seed_storage(setup, {'entries':[entry,video,*[{**video,'id':f'video-similar-{i}','title':f'Related video {i}','mediaAssets':video['mediaAssets']} for i in range(10)], {**entry,'id':'similar','title':'Related case'}], 'uiPreferences':{'locale':'zh-CN','motion':'reduced'}})
        setup.evaluate("async()=>{const{saveMediaBlob}=await import('./media-store.js');const c=document.createElement('canvas');c.width=400;c.height=300;await saveMediaBlob('image',await new Promise(r=>c.toBlob(r,'image/png')))}")
        setup.evaluate("async bytes=>{const{saveMediaBlob}=await import('./media-store.js');await saveMediaBlob('video',new Blob([new Uint8Array(bytes)],{type:'video/mp4'}))}",list((Path(__file__).parent/'fixtures/review-workspace-smoke.mp4').read_bytes()))
        p = run.open_page('library.html')
        p.wait_for_function("()=>document.body.dataset.libraryState==='ready'")
        if mode in ['all','persistence']:
            # A second open library has an older preference snapshot.
            other = run.open_page('library.html')
            assert p.evaluate("async()=> (await chrome.runtime.sendMessage({type:'UPDATE_LAYOUT_PREFERENCES',preferences:{sidebarWidth:320,detailPanelRatio:.4,detailMode:'sidebar',sidebarLayout:{order:['tags','types','projects'],open:['tags']}}})).ok")
            other.locator('#toggle-filters').click()
            other.wait_for_function("async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences.sidebarLayout.collapsed")
            prefs = p.evaluate("async()=> (await chrome.storage.local.get('uiPreferences')).uiPreferences")
            assert prefs['sidebarWidth'] == 320 and prefs['detailPanelRatio'] == .4, f'Stale panel action erased saved layout: {prefs}'
            assert prefs['sidebarLayout']['order'] == ['tags','types','projects'] and prefs['sidebarLayout']['open'] == ['tags'], 'An old collapse action erased newly saved module placement'
            p.reload(wait_until='domcontentloaded')
            assert p.locator('.workspace').evaluate("e=>getComputedStyle(e).getPropertyValue('--sidebar-width').trim()") == '320px'
        if mode in ['all','video-scroll']:
            # Include real poster cards: hiding/showing their masonry queues later
            # anchor restoration, which an immediate scrollTop assertion misses.
            for motion, scrolled, prepared in [('system',False,False),('system',True,True),('reduced',True,True)]:
                p.close()
                setup.evaluate("async motion=>await chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{detailMode:'fullscreen',motion}})",motion)
                p = run.open_page('library.html')
                p.wait_for_function("()=>document.body.dataset.libraryState==='ready'")
                p.locator('.case-card[data-entry-id=video-case]').click()
                expect(p.locator('#detail-drawer')).to_have_attribute('data-entry-id','video-case')
                panel = p.locator('#detail-drawer .review-feedback-panel')
                if prepared:
                    p.get_by_role('button',name='播放视频',exact=True).click()
                    p.wait_for_function("()=>document.querySelector('.detail-video')?.readyState>=2")
                    p.locator('.detail-video').evaluate('v=>{v.pause();v.currentTime=.8}')
                    p.keyboard.press('m'); expect(panel).to_be_visible()
                    panel.locator('textarea').fill('Keep this unsaved feedback')
                p.locator('.detail-video').evaluate('v=>{window.originalPlayer=v;window.originalTime=v.currentTime}')
                if scrolled:
                    p.locator('#detail-content').evaluate('e=>e.scrollTop=e.scrollHeight')
                    p.wait_for_function("()=>document.querySelector('#detail-content').scrollTop>0")
                p.locator('#detail-mode-toggle').click()
                p.wait_for_function("()=>document.querySelector('#detail-drawer').dataset.detailMode==='sidebar'")
                # Allow hidden-grid resize delivery before the user switches back.
                p.evaluate('async()=>{for(let i=0;i<12;i++)await new Promise(requestAnimationFrame)}')
                p.locator('#detail-mode-toggle').click()
                p.wait_for_function("()=>document.querySelector('#detail-drawer').dataset.detailMode==='fullscreen'")
                positions = p.evaluate("""async()=>{const samples=[];for(let i=0;i<60;i++){await new Promise(requestAnimationFrame);const c=document.querySelector('#detail-content'),v=c.querySelector('.detail-visual-gallery');samples.push({scroll:c.scrollTop,top:v.getBoundingClientRect().top,viewport:c.getBoundingClientRect().top})}return samples}""")
                bad = [s for s in positions if s['scroll']!=0 or abs(s['top']-s['viewport'])>=2]
                assert not bad, f'Video detail returned to related cases ({motion}, scrolled={scrolled}): {bad[:5]}'
                assert p.evaluate('()=>document.querySelector(".detail-video")===window.originalPlayer && Math.abs(window.originalPlayer.currentTime-window.originalTime)<.05'), 'Mode change replaced or reset the video'
                if prepared:
                    expect(panel.locator('textarea')).to_have_value('Keep this unsaved feedback')
                    panel.locator('textarea').fill('')
                if os.environ.get('PD_E2E_ARTIFACT_DIR'):
                    out = Path(os.environ['PD_E2E_ARTIFACT_DIR']); out.mkdir(parents=True,exist_ok=True)
                    p.screenshot(path=str(out/f'video-return-{motion}-{scrolled}.png'))
                p.locator('#detail-close').click()
            print('PASS: video returns remain at top after deferred layouts; player/time/draft preserved')
        if mode in ['all','scroll']:
            p.evaluate("async()=>await chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences:{detailMode:'fullscreen'}})")
            p.reload(wait_until='domcontentloaded')
            p.locator('.case-card[data-entry-id=picture]').click()
            p.locator('.detail-discovery').scroll_into_view_if_needed()
            p.locator('#detail-mode-toggle').click()
            p.wait_for_function("()=>document.querySelector('#detail-drawer').dataset.detailMode==='sidebar'")
            p.locator('.prompt-expand').click()
            p.locator('.detail-quick-organization').scroll_into_view_if_needed()
            p.locator('#detail-mode-toggle').click()
            p.wait_for_function("()=>document.querySelector('#detail-drawer').dataset.detailMode==='fullscreen'")
            positions = p.evaluate("()=>{const c=document.querySelector('#detail-content'),v=c.querySelector('.detail-visual-gallery');return {scroll:c.scrollTop,top:v.getBoundingClientRect().top,viewport:c.getBoundingClientRect().top}}")
            assert positions['scroll'] == 0 and abs(positions['top']-positions['viewport']) < 2, f'Full detail opened below media: {positions}'
            p.locator('#detail-close').click()
        if mode in ['all','status']:
            # Hold only the real checking response to measure its visible pending state.
            p.add_init_script("const send=chrome.runtime.sendMessage.bind(chrome.runtime);window.checkGate=new Promise(r=>window.releaseCheck=r);chrome.runtime.sendMessage=async(...args)=>{if(args[0]?.type==='PREVIEW_REANALYZE')await window.checkGate;return send(...args)}")
            p.reload(wait_until='domcontentloaded'); p.locator('#open-settings').click(); p.locator('[data-settings-tab=tasks]').click()
            expect(p.locator('#reanalyze-preview')).to_have_attribute('aria-busy','true')
            before = p.locator('.local-index-card h3').bounding_box()['y']
            status_before = p.locator('#reanalyze-preview').bounding_box()['y']
            p.evaluate('()=>window.releaseCheck()')
            expect(p.locator('#reanalyze-preview')).to_have_attribute('aria-busy','false')
            after = p.locator('.local-index-card h3').bounding_box()['y']
            status_after = p.locator('#reanalyze-preview').bounding_box()['y']
            assert abs(after-before)<1 and abs(status_after-status_before)<1, f'Completion moved heading/status: {before,after,status_before,status_after}'
        print(f'PASS: {mode}')


if __name__ == '__main__': main(sys.argv[1] if len(sys.argv)>1 else 'all')
