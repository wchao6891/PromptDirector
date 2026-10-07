"""Synthetic local originals: real displayed frames, shared loops and Premiere keys."""
import json, os
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session


def timestamps(path):
    fixture = Path(__file__).parent / 'fixtures/review-frame-timestamps.json'
    return json.loads(fixture.read_text())['frames'][path.name]


def main():
    root = Path(__file__).parent / 'fixtures'
    files = [root / name for name in ['review-workspace-smoke.mp4', 'review-ntsc-bframes.mp4',
        'review-variable-frames.mp4', 'review-frames.webm']]
    with extension_session('pd-video-frame-controls-', viewport={'width':1280,'height':900}) as run:
        page = run.open_page('library.html')
        entry = {'id':'frames', 'title':'视频逐帧验证', 'text':'原件与资料保持', 'mediaAssets':[
            {'id':f'frame-{i}', 'kind':'video', 'storageMode':'managed', 'mimeType':'video/webm' if path.suffix=='.webm' else 'video/mp4', 'width':160, 'height':90}
            for i,path in enumerate(files)], 'primaryMediaId':'frame-0'}
        run.seed_storage(page, {'entries':[entry]})
        for i,path in enumerate(files):
            page.evaluate("""async ({id,bytes,type})=>{const{saveMediaBlob}=await import('./media-store.js');await saveMediaBlob(id,new Blob([new Uint8Array(bytes)],{type}))}""", {'id':f'frame-{i}','bytes':list(path.read_bytes()),'type':entry['mediaAssets'][i]['mimeType']})
        page.reload(); page.locator('.case-card').click()
        measured = []
        for i,path in enumerate(files):
            if i: page.get_by_role('button', name='下一项媒体', exact=True).click()
            page.get_by_role('button', name='播放视频', exact=True).click()
            player = page.locator('.detail-video')
            page.wait_for_function("()=>document.querySelector('.detail-video').readyState>=2")
            player.evaluate("""v=>{v.pause();window.framePTS=null; const cb=(_,m)=>{window.framePTS=m.mediaTime;v.requestVideoFrameCallback(cb)};v.requestVideoFrameCallback(cb)}""")
            coded_pts = timestamps(path)
            pts = coded_pts; index = 13
            start = (pts[index] + pts[index+1])/2
            player.evaluate('async (v,t)=>{await new Promise(r=>{v.addEventListener("seeked",r,{once:true});v.currentTime=t})}', start)
            # Button and keyboard share exactly the same frame positioning.
            page.locator('[data-review-frame=next]').click()
            page.wait_for_function('expected=>Math.abs(window.framePTS-expected)<.00002', arg=pts[index+1])
            assert player.evaluate('v=>v.paused')
            page.keyboard.press('ArrowLeft')
            page.wait_for_function('expected=>Math.abs(window.framePTS-expected)<.00002', arg=pts[index])
            page.keyboard.press('ArrowLeft')
            page.wait_for_function('expected=>Math.abs(window.framePTS-expected)<.00002', arg=pts[index-1])
            page.keyboard.press('ArrowRight')
            page.wait_for_function('expected=>Math.abs(window.framePTS-expected)<.00002', arg=pts[index])
            player.evaluate('async v=>{await new Promise(r=>{v.addEventListener("seeked",r,{once:true});v.currentTime=0})}')
            page.keyboard.press('ArrowLeft')
            page.wait_for_function('expected=>Math.abs(window.framePTS-expected)<.00002',arg=pts[0])
            player.evaluate('async v=>{await new Promise(r=>{v.addEventListener("seeked",r,{once:true});v.currentTime=v.duration})}')
            # Chromium may refine VFR duration after loading its tail. Query
            # the actual endpoint now, not the earlier metadata estimate.
            displayed_pts = [time for time in coded_pts if time < player.evaluate('v=>v.duration')]
            page.keyboard.press('ArrowRight')
            try:page.wait_for_function('expected=>Math.abs(window.framePTS-expected)<.00002',arg=displayed_pts[-1],timeout=5000)
            except Exception:
                print({'endpoint':path.name,'expected':displayed_pts[-1],'actual':player.evaluate('v=>({pts:window.framePTS,time:v.currentTime,duration:v.duration,paused:v.paused,seeking:v.seeking,error:document.querySelector("#workspace-agent-activity").textContent})')},flush=True)
                raise
            # Repeated presses serialize frame seeks rather than dropping key steps.
            for _ in range(3):page.keyboard.press('ArrowLeft')
            try:page.wait_for_function('expected=>Math.abs(window.framePTS-expected)<.00002',arg=displayed_pts[-4],timeout=5000)
            except Exception:
                print({'repeat':path.name,'expected':displayed_pts[-4],'actual':player.evaluate('v=>({pts:window.framePTS,time:v.currentTime,paused:v.paused,seeking:v.seeking,error:document.querySelector("#workspace-agent-activity").textContent})')},flush=True)
                raise
            assert page.locator('[data-review-loop]').count()==1
            if i==0:
                loop = page.locator('[data-review-loop]'); loop.click()
                expect(loop).to_have_attribute('aria-pressed','true')
                assert player.evaluate('v=>v.loop&&!v.paused')
                player.evaluate('v=>v.currentTime=v.duration-.12')
                page.wait_for_function("()=>document.querySelector('.detail-video').currentTime<.5&&!document.querySelector('.detail-video').paused")
                loop.click(); assert not player.evaluate('v=>v.loop')
                player.evaluate('v=>{v.pause();v.currentTime=.25}')
                page.keyboard.press('i')
                player.evaluate('v=>v.currentTime=.75');page.keyboard.press('o')
                loop.click(); assert player.evaluate('v=>!v.paused&&!v.loop')
                player.evaluate('v=>v.currentTime=.72')
                page.wait_for_function("()=>document.querySelector('.detail-video').currentTime<.5&&!document.querySelector('.detail-video').paused")
                page.keyboard.press('ArrowRight'); assert player.evaluate('v=>v.paused')
                player.evaluate('async v=>{await new Promise(r=>{v.addEventListener("seeked",r,{once:true});v.currentTime=v.duration})}')
                assert player.evaluate('v=>v.paused'), 'a paused seek to the end must not restart range playback'
                page.locator('[data-review-point=out]').click()
                # A range ending at the real video end must still loop.
                loop.click();player.evaluate('v=>v.currentTime=v.duration-.1')
                page.wait_for_function("()=>document.querySelector('.detail-video').currentTime<.8&&!document.querySelector('.detail-video').paused")
                player.evaluate('v=>v.pause()')
                page.locator('[data-review-clear]').click()
                expect(loop).to_have_attribute('aria-pressed','false')
                assert not player.evaluate('v=>v.loop')
                # Markers survive entering/exiting review; frame stepping remains available.
                page.locator('.review-transport').get_by_role('button',name='审片',exact=True).click()
                page.keyboard.press('ArrowRight');page.wait_for_function("()=>document.querySelector('.detail-video').paused")
                position = player.evaluate('v=>v.currentTime')
                page.locator('.review-transport').get_by_role('button',name='退出审片',exact=True).click()
                assert abs(player.evaluate('v=>v.currentTime')-position)<.00001
                # Arrows in authored text keep their native cursor behavior.
                page.locator('[data-review-feedback]').click()
                text = page.locator('.review-feedback-panel textarea');text.fill('测试');text.press('ArrowLeft')
                assert abs(player.evaluate('v=>v.currentTime')-position)<.00001
                text.fill('');page.get_by_role('button',name='收起备注',exact=True).click()
                for width in [1280,390]:
                    page.set_viewport_size({'width':width,'height':900})
                    spread = page.locator('.review-transport-row').evaluate("""row=>{const r=[...row.querySelectorAll('button')].filter(b=>b.getClientRects().length).map(b=>{const x=b.getBoundingClientRect();return x.y+x.height/2});return Math.max(...r)-Math.min(...r)}""")
                    assert spread<1 and page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                    artifact=os.environ.get('PD_E2E_ARTIFACT_DIR')
                    if artifact:page.screenshot(path=str(Path(artifact)/f'frame-controls-{width}.png'))
                page.set_viewport_size({'width':1280,'height':900})
                # Enable before switching: the next original must not inherit a loop.
                loop.click()
            measured.append({'file':path.name,'codedFrames':len(coded_pts),'displayableFrames':len(displayed_pts),'displayedFrame':pts[index]})
            if i>0:
                assert not player.evaluate('v=>v.loop')
                expect(page.locator('[data-review-loop]')).to_have_attribute('aria-pressed','false')
        player.evaluate('v=>v.pause()')
        page.locator('#detail-close').click()
        page.locator('#open-settings').click();page.locator('[data-settings-tab=shortcuts]').click()
        expect(page.locator('#shortcut-previousFrame')).to_have_value('←')
        expect(page.locator('#shortcut-nextFrame')).to_have_value('→')
        page.locator('#settings-dialog').evaluate('d=>d.close()')
        # The same controls work for temporary local review without saving a case.
        page.locator('#temporary-review-file').set_input_files(str(files[-1]))
        expect(page.locator('#temporary-review-dialog')).to_be_visible()
        page.wait_for_function("()=>document.querySelector('#temporary-review-media video').readyState>=2")
        page.locator('#temporary-review-media video').evaluate('v=>{v.pause();v.currentTime=.25}')
        page.keyboard.press('ArrowRight')
        page.wait_for_function("()=>document.querySelector('#temporary-review-media video').currentTime>.29")
        page.locator('#temporary-review-actions [data-review-loop]').click()
        assert page.locator('#temporary-review-media video').evaluate('v=>v.loop&&!v.paused')
        page.locator('#temporary-review-close').click()
        saved=page.evaluate("async()=> (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
        assert len(saved)==1 and saved[0]['text']==entry['text']
        for i,path in enumerate(files):
            raw=page.evaluate("async id=>{const{getMediaBlob}=await import('./media-store.js');return Array.from(new Uint8Array(await(await getMediaBlob(id)).arrayBuffer()))}",f'frame-{i}')
            assert bytes(raw)==path.read_bytes()
        print(json.dumps({'realPresentationTimestamps':measured,'wholeAndRangeLoop':True,'premiereArrows':True,'singleRowWideNarrow':True,'temporaryReview':True,'sourceReadbackUnchanged':True}))


if __name__=='__main__':main()
