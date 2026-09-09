"""Reproduce saved video references leaving the capture sidebar uncleared. Isolated fixture."""
import re
from playwright.sync_api import expect
from e2e_support import extension_session
from page_capture_e2e import fixture_png


def main():
    with extension_session('capture-partial-save-', viewport={'width':390,'height':844}) as run:
        run.context.route('https://pbs.twimg.com/**', lambda route: route.fulfill(body=fixture_png(route.request.url), content_type='image/png'))
        page=run.open_page('collector.html')
        run.seed_storage(page, {'entries':[], 'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-07T00:00:00Z','clipboardIncluded':True}})
        page.evaluate("""async () => {
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          const {createCaptureDraft}=await import('./capture-draft.js');
          await send({type:'UPDATE_CAPTURE_DRAFT',draft:createCaptureDraft({fragments:[{id:'clipboard-fragment',text:'用户补充的剪贴板文字，已入库后应从侧栏清除。',sourceUrl:'https://x.com/director/status/123'}]})});
          chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;
          chrome.tabs.query=async()=>[{id:999,url:'https://x.com/director/status/123'}];
          chrome.runtime.sendMessage=async m=>{
            if(m.type==='COMMIT_PAGE_CAPTURE' && window.forceSaveFailure)return {ok:false,message:'模拟保存失败'};
            if(m.type==='START_PAGE_CAPTURE') return {ok:true,batch:{sourceUrl:'https://x.com/director/status/123',candidates:[{
              id:'partial-video',title:'Video prompt fixture',canonicalUrl:'https://x.com/director/status/123',pageType:'post',
              contentText:'Prompt: a cinematic martial arts scene.',textBlocks:[{id:'text',kind:'section',text:'Prompt: a cinematic martial arts scene.'}],
              media:[{id:'video',kind:'video',url:'',posterUrl:'https://pbs.twimg.com/video-poster.png',placement:'inline',sourceKind:'video-element'}],
              articleDocument:{version:1,blocks:[{id:'text',kind:'paragraph',text:'Prompt: a cinematic martial arts scene.'},{id:'video-block',kind:'video',assetId:'video'}]},
              sourceFacts:{provider:'x',pageType:'post'}
            }]}};
            if(['PREVIEW_PAGE_CAPTURE_REGION','CLEAR_PAGE_CAPTURE_MARKERS'].includes(m.type)) return {ok:true};
            const result=await send(m);
            if(m.type==='COMMIT_PAGE_CAPTURE')window.saveResult=result;
            return result;
          };
        }""")
        page.evaluate("()=>window.dispatchEvent(new Event('focus'))")
        page.locator('#add-page-capture').click()
        page.locator('.page-capture-confirm').click()
        page.locator('#page-capture-save').click()
        page.wait_for_function('()=>Boolean(window.saveResult)')
        result=page.evaluate('window.saveResult')
        assert result['ok'] and result['results'][0]['status']=='partial', result
        entries=page.evaluate("async()=> (await chrome.storage.local.get('entries')).entries")
        assert len(entries)==1 and any(asset['kind']=='video' for asset in entries[0]['mediaAssets']),entries
        assert entries[0]['sourceFacts']['captureWarnings'], entries
        expect(page.locator('#page-capture')).to_be_hidden()
        expect(page.locator('#feedback')).to_contain_text('已保存')
        assert len(page.evaluate("async()=> (await chrome.storage.local.get('entries')).entries"))==1
        expect(page.locator('#feedback')).not_to_have_class(re.compile(r'\berror\b'))
        workspace=page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})")
        assert workspace['draft']['fragments']==[],workspace
        page.evaluate('()=>window.forceSaveFailure=true')
        page.locator('#start-page-capture').click()
        page.locator('.page-capture-confirm').click()
        page.locator('#page-capture-save').click()
        expect(page.locator('#feedback')).to_contain_text('模拟保存失败')
        expect(page.locator('#page-capture')).to_be_visible()
        assert len(page.evaluate("async()=> (await chrome.storage.local.get('entries')).entries"))==1
        print({'case_saved':True,'warning_retained':True,'saved_sidebar_cleared':True,'unsaved_content_preserved':True})


if __name__=='__main__':main()
