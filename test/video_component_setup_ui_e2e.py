"""Real collector UI: permission denial, missing installer, browser review and explicit cancellation."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, wait_for_async_condition


def main():
    evidence = Path(os.environ.get('VIDEO_SETUP_UI_EVIDENCE', tempfile.mkdtemp(prefix='video-setup-ui-')))
    evidence.mkdir(parents=True, exist_ok=True)
    with extension_session('video-component-ui-') as run:
        page = run.open_page('collector.html')
        run.seed_storage(page, {'entries': [], 'dataSafetyOnboardingSeen': True})
        result = page.evaluate("""async()=>{
          const {normalizePageCaptureBatch}=await import('./page-capture.js'); const url='https://www.youtube.com/watch?v=jNQXAC9IVRw';
          const batch=normalizePageCaptureBatch({sourceUrl:url,sessionMediaAllowed:false,candidates:[{id:'selected',title:'Selected video',canonicalUrl:url,contentText:'Full original source',pageType:'video',media:[{id:'v',kind:'video',url}]}],selections:[{candidateId:'selected',includeText:true,selectedMediaIds:['v'],mediaDecision:'confirmed'}]});
          return chrome.runtime.sendMessage({type:'COMMIT_PAGE_CAPTURE',batch});
        }""")
        assert result.get('code') == 'video_component_required', result
        page.reload()
        expect(page.locator('#video-component-setup')).to_be_visible()
        page.evaluate("""async()=>{
          const {createVideoComponentView}=await import('./video-component-view.js');
          window.fixtureCalls=[];
          window.fixtureView=createVideoComponentView(document.querySelector('#video-component-setup'),{primary:true,
            permission:async()=>false,send:async()=>{throw Error('Denied permission must not start a download')}});
          fixtureView.render({phase:'idle'});
        }""")
        page.locator('#video-component-setup button').click()
        expect(page.locator('#video-component-setup')).to_contain_text('未开启组件连接权限')
        expect(page.locator('#video-component-setup button')).to_have_text('开启权限')
        page.screenshot(path=str(evidence / 'permission-denied.png'))
        task = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
        assert task['status'] == 'waiting-component' and task['input']['batch']['candidates'][0]['contentText'] == 'Full original source'
        page.evaluate("""async()=>{
          const {createVideoComponentView}=await import('./video-component-view.js');
          window.fixtureView=createVideoComponentView(document.querySelector('#video-component-setup'),{primary:true,
            permission:async()=>true,send:async message=>{fixtureCalls.push(message);return {ok:true,state:{phase:message.restart?'downloading':'installing',downloadId:88}}},
            open:async()=>{throw Error('Installer file was moved. Download it again.')},showDownloads:()=>fixtureCalls.push('show-downloads')});
          fixtureView.render({phase:'idle'});
        }""")
        page.locator('#video-component-setup button').click()
        expect(page.locator('#video-component-setup button')).to_have_text('打开安装包')
        page.locator('#video-component-setup button').click()
        expect(page.locator('#video-component-setup button')).to_have_text('重新下载')
        for width in [390, 1280]:
            page.set_viewport_size({'width':width,'height':850})
            page.screenshot(path=str(evidence / f'installer-moved-{width}.png'))
        page.locator('#video-component-setup button').click()
        expect(page.locator('#video-component-setup')).to_contain_text('正在下载安装包')
        calls = page.evaluate('fixtureCalls')
        assert calls[-1]['restart'] is True, calls
        for locale, theme in [('zh-CN', 'dark'), ('en', 'light')]:
            page.evaluate("async preferences=>chrome.runtime.sendMessage({type:'UPDATE_UI_PREFERENCES',preferences})", {'locale':locale,'theme':theme})
            page.reload()
            expect(page.locator('#video-component-setup')).to_be_visible()
            page.evaluate("""async()=>{
              const {createVideoComponentView}=await import('./video-component-view.js');window.fixtureCalls=[];
              window.fixtureView=createVideoComponentView(document.querySelector('#video-component-setup'),{primary:true,showDownloads:()=>fixtureCalls.push('show-downloads')});
              fixtureView.render({phase:'review'});
            }""")
            expect(page.locator('#video-component-setup button')).to_have_text('View downloads' if locale == 'en' else '查看下载')
            for width in [390, 1280]:
                page.set_viewport_size({'width':width,'height':850})
                page.screenshot(path=str(evidence / f'review-{locale}-{width}.png'))
            page.locator('#video-component-setup button').click()
            assert page.evaluate('fixtureCalls.at(-1)') == 'show-downloads'
        page.locator('#page-capture-save').click()
        wait_for_async_condition(page, "async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task?.status==='cancelled'")
        assert page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.length") == 0
        print(json.dumps({'permissionDenialPreservesCapture':True,'missingFileRetry':True,'browserReviewIsExplicit':True,'cancelStopsAutoSave':True}), evidence)


if __name__ == '__main__':
    main()
