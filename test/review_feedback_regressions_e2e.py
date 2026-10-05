"""Real screening: current time, optional range, standalone frames and stable media geometry."""
import hashlib,json,os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session

def main():
    video=(Path(__file__).parent/'fixtures/review-workspace-smoke.mp4').read_bytes()
    with extension_session('pd-review-feedback-regressions-') as run:
        page=run.open_page('library.html')
        entry={'id':'review-regression','title':'审片反馈回归','text':'原始资料保持','classification':{'pathIds':['content:video-case'],'status':'confirmed'},'mediaAssets':[{'id':'regression-video','kind':'video','storageMode':'managed','mimeType':'video/mp4','width':320,'height':180,'byteSize':len(video)}],'primaryMediaId':'regression-video'}
        run.seed_storage(page,{'entries':[entry]})
        page.evaluate("""async bytes=>{const {saveMediaBlob}=await import('./media-store.js');await saveMediaBlob('regression-video',new Blob([new Uint8Array(bytes)],{type:'video/mp4'}))}""",list(video))
        page.reload();expect(page.locator('.case-card')).to_have_count(1)
        page.locator('.case-card').click();expect(page.locator('.detail-video')).to_be_visible()
        expect(page.locator('.original-prompt-panel .prompt-read-body')).to_have_text(entry['text'])
        page.locator('.entry-editor-inline > summary').click();expect(page.locator('.entry-original-editor')).to_have_count(0)
        page.locator('.entry-editor-inline > summary').click()
        idle=page.evaluate("""async()=>{let mutations=0;const observer=new MutationObserver(list=>mutations+=list.length);observer.observe(document.querySelector('.detail-visual-gallery'),{childList:true,subtree:true});await new Promise(r=>setTimeout(r,500));observer.disconnect();return mutations;}""")
        assert idle==0,('paused case must not start a self-sustaining rendering loop',idle)
        page.get_by_role('button',name='播放视频',exact=True).click()
        page.wait_for_function("() => document.querySelector('.detail-video').readyState>=2")
        stable=page.evaluate("""async()=>{const svg=document.querySelector('.review-transport-row button svg');await new Promise(r=>setTimeout(r,600));return svg===document.querySelector('.review-transport-row button svg');}""")
        assert stable,'playing preserves the icon node'
        page.locator('.detail-video').evaluate('v=>{v.pause();v.currentTime=.154313}')
        page.locator('[data-review-point=in]').click()
        page.locator('.detail-video').evaluate('v=>{v.currentTime=.71293}')
        page.locator('[data-review-point=out]').click()
        page.locator('.detail-video').evaluate('v=>v.currentTime=1.4')
        page.locator('[data-review-feedback]').click()
        panel=page.locator('.review-feedback-panel')
        expect(panel.locator('input[type=number]').first).to_have_value('1.4')
        expect(panel.locator('input[type=number]').nth(1)).to_be_hidden()
        panel.get_by_role('button',name='使用入出点区间',exact=True).click()
        expect(panel.locator('input[type=number]').first).to_have_value('0.154')
        panel.locator('textarea').fill('时间段反馈')
        panel.get_by_role('button',name='保存',exact=True).click()
        page.wait_for_function("() => document.querySelector('.review-feedback-form').dataset.dirty==='false'")
        note=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries[0].timeNotes[0]")
        assert note['startMs']==154 and note['endMs']==713,note
        page.locator('[data-review-clear]').click()
        expect(page.locator('[data-review-mark=in]')).to_be_hidden();expect(page.locator('[data-review-mark=out]')).to_be_hidden()
        expect(panel.locator('input[type=number]').nth(1)).to_be_hidden()
        # Consecutive notes capture the current position instead of reusing the previous note.
        page.locator('.detail-video').evaluate('v=>v.currentTime=1.6')
        panel.locator('textarea').fill('当前时间反馈');panel.get_by_role('button',name='保存',exact=True).click()
        page.wait_for_function("() => document.querySelector('.review-feedback-form').dataset.dirty==='false'")
        notes=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries[0].timeNotes")
        assert notes[1]['startMs']==1600 and 'endMs' not in notes[1],notes
        # Default placement and dragging stay above the controls.
        def no_overlap():return page.evaluate("""()=>{const p=document.querySelector('.review-feedback-panel').getBoundingClientRect(),b=document.querySelector('.detail-visual-caption').getBoundingClientRect();return p.bottom<=b.top && p.top>=0;}""")
        assert no_overlap(),'feedback must leave the toolbar accessible'
        artifact=os.environ.get('PD_E2E_ARTIFACT_DIR')
        if artifact:page.screenshot(path=str(Path(artifact)/'draggable-notes.png'))
        header=panel.locator('header').bounding_box();before=panel.bounding_box()
        page.mouse.move(header['x']+30,header['y']+10);page.mouse.down();page.mouse.move(header['x']-100,header['y']+70,steps=5);page.mouse.up()
        after=panel.bounding_box();assert abs(after['x']-before['x'])>50 and no_overlap()
        panel.get_by_role('button',name='收起备注',exact=True).click()
        page.locator('.detail-video').evaluate('v=>v.currentTime=.9')
        page.evaluate('() => window.reviewPlayerBeforeSave=document.querySelector(".detail-video")')
        page.locator('[data-review-capture]').click()
        page.wait_for_function("() => document.querySelectorAll('.detail-visual-thumb').length===2 && !document.querySelector('[data-review-capture]').disabled")
        assert page.evaluate('() => window.reviewPlayerBeforeSave===document.querySelector(".detail-video")')
        stored=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries[0]")
        image=next(asset for asset in stored['mediaAssets'] if asset['kind']=='image' and asset.get('usage')!='poster')
        assert image['derivedFromAssetId']=='regression-video' and image['frameTimeMs']==900,image
        assert len(stored['timeNotes'])==2,'one-click screenshot must not create a fabricated note'
        assert stored['text']==entry['text']
        original=page.evaluate("async()=>{const{getMediaBlob}=await import('./media-store.js');return Array.from(new Uint8Array(await(await getMediaBlob('regression-video')).arrayBuffer()))}")
        assert hashlib.sha256(bytes(original)).digest()==hashlib.sha256(video).digest()
        def geometry():return page.locator('.detail-visual-stage').evaluate('e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}')
        video_geometry=geometry();page.locator('.detail-visual-thumb').nth(1).click();expect(page.locator('.detail-image')).to_be_visible()
        assert all(abs(a-b)<1 for a,b in zip(geometry(),video_geometry)),(geometry(),video_geometry)
        # Mixed-case document and differently shaped images share the exact same stage.
        page.evaluate("""async()=>{const{saveMediaBlob}=await import('./media-store.js');const c=document.createElement('canvas');c.width=50;c.height=500;await saveMediaBlob('tall',await new Promise(r=>c.toBlob(r,'image/png')));await saveMediaBlob('doc',new Blob(['资料正文'],{type:'text/plain'}));const{entries}=await chrome.storage.local.get('entries');entries[0].mediaAssets.push({id:'tall',kind:'image',storageMode:'managed',mimeType:'image/png',width:50,height:500},{id:'doc',kind:'document',storageMode:'managed',mimeType:'text/plain',sourceTitle:'资料.txt'});await chrome.storage.local.set({entries})}""")
        page.reload();page.locator('.case-card').click();expect(page.locator('.detail-visual-thumb')).to_have_count(4)
        initial=geometry()
        for index in [2,3,0,1,2,0]:
            page.locator('.detail-visual-thumb').nth(index).click()
            page.wait_for_function('(i)=>document.querySelector(".detail-visual-gallery").dataset.displayedAssetId===i',arg=['regression-video',image['id'],'tall','doc'][index])
            assert all(abs(a-b)<1 for a,b in zip(geometry(),initial)),(index,geometry(),initial)
        # Member galleries use the same stable layout outside the immersive drawer.
        page.locator('.detail-visual-gallery').evaluate("e=>e.classList.remove('is-immersive')")
        initial=geometry()
        for index in [2,3,1,0]:
            page.locator('.detail-visual-thumb').nth(index).click()
            assert all(abs(a-b)<1 for a,b in zip(geometry(),initial)),('member gallery',index,geometry(),initial)
        page.locator('.detail-visual-gallery').evaluate("e=>e.classList.add('is-immersive')")
        page.get_by_role('button',name='播放视频',exact=True).click()
        page.wait_for_function("() => document.querySelector('.detail-video').readyState>=2")
        page.locator('.detail-video').evaluate('v=>{v.pause();v.currentTime=.6}')
        page.locator('[data-review-point=out]').click()
        page.locator('[data-review-feedback]').click()
        expect(page.locator('.review-feedback-panel').get_by_role('button',name='使用入出点区间',exact=True)).to_be_hidden()
        page.locator('[data-review-clear]').click()
        page.locator('.review-feedback-panel').get_by_role('button',name='收起备注',exact=True).click()
        if artifact:page.screenshot(path=str(Path(artifact)/'review-toolbar.png'))
        print(json.dumps({'pausedIdleMutations':idle,'playingIconStable':stable,'defaultCurrentTime':True,'explicitRangeSaved':True,'rangeCleared':True,'partialRangeNotUsed':True,'consecutiveTimeNotes':True,'draggableUnobstructedNotes':True,'standaloneFrame':True,'originalUnchanged':True,'mixedMediaStable':True,'memberMediaStable':True,'originalOutsideEditor':True}))

if __name__=='__main__':main()
