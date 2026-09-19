"""Entry/permissions/extraction fixtures; production collector selection, save and library readback."""
from pathlib import Path
import os
from playwright.sync_api import expect
from e2e_support import extension_session
from page_capture_e2e import fixture_png

SETUP = '''({count,permission=true})=>{
  window.scanCount=0;window.clickCount=0;
  document.addEventListener('click',()=>window.clickCount++,true);
  const send=chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.permissions.contains=async()=>permission;
  chrome.tabs.query=async()=>[{id:999,url:'https://example.com/quick',windowId:1}];
  chrome.runtime.sendMessage=async m=>{
    if(m.type==='TRY_ACTIVE_SELECTION_TO_DRAFT')return {ok:true,added:false};
    if(m.type==='PREVIEW_PAGE_CAPTURE_REGION'||m.type==='CLEAR_PAGE_CAPTURE_MARKERS')return {ok:true};
    if(m.type==='START_PAGE_CAPTURE'){
      window.scanCount++;
      return {ok:true,batch:{id:'quick',sourceUrl:'https://example.com/quick',candidates:Array.from({length:count},(_,i)=>({
        id:'case-'+i,title:'自动识别案例 '+i,canonicalUrl:'https://example.com/quick/'+i,pageType:'post',
        contentText:'保留完整提示词 '+i,textBlocks:[{id:'text-'+i,kind:'section',text:'保留完整提示词 '+i}],
        media:i===0?[{id:'image',kind:'image',placement:'inline',url:'https://wchao6891.github.io/quick-entry-image.png',width:800,height:600}]:[],sourceFacts:{provider:'example.com',pageType:'post'}
      }))}};
    }
    return send(m);
  };
}'''


def main():
    with extension_session('capture-quick-',viewport={'width':390,'height':844}) as run:
        run.context.route('https://wchao6891.github.io/quick-entry-image.png',lambda route:route.fulfill(body=fixture_png('quick-entry-image'),content_type='image/png'))
        setup=run.open_page('collector.html')
        for count in [1,2]:
            run.seed_storage(setup,{'entries':[],'uiPreferences':{'theme':'dark','motion':'reduced'},'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-19T00:00:00Z'}})
            page=run.context.new_page()
            page.add_init_script('('+SETUP+')('+str({'count':count}).replace("'",'"')+')')
            page.goto(f'chrome-extension://{run.extension_id}/collector.html')
            expect(page.locator('.page-capture-item')).to_have_count(count)
            if count==2:
                expect(page.locator('#page-capture-save')).to_be_disabled()
                page.locator('.page-capture-confirm').nth(1).click()
            expect(page.locator('#page-capture-save')).to_be_enabled()
            assert page.evaluate('window.scanCount')==1
            if count==1:
                out=Path(os.environ.get('PD_TEST_SCREENSHOTS','/tmp/pd-quick-entry'));out.mkdir(parents=True,exist_ok=True)
                for theme in ['dark','light']:
                    page.evaluate('(v)=>document.documentElement.dataset.theme=v',theme)
                    for width in [390,1280]:
                        page.set_viewport_size({'width':width,'height':844})
                        page.screenshot(path=str(out/f'quick-{theme}-{width}.png'),animations='disabled')
            page.locator('#page-capture-save').click()
            expect(page.locator('#page-capture')).to_be_hidden()
            clicks=page.evaluate('window.clickCount')
            assert clicks==count,clicks
            entries=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries")
            assert len(entries)==1 and entries[0]['text']=='保留完整提示词 '+str(count-1),entries
            if count==1:
                assert len(entries[0]['mediaAssets'])==1 and entries[0]['classification']['pathIds']==['content:prompt:image'],entries
            page.evaluate("()=>window.dispatchEvent(new Event('focus'))")
            expect(page.locator('#page-capture')).to_be_hidden()
            assert page.evaluate('window.scanCount')==1
            print({'candidates':count,'collectorClicks':clicks,'toolbarOpenPlusCollector':clicks+1,'focusNoRescan':True},flush=True)
            if count==1:
                window_id=page.evaluate('async()=>(await chrome.windows.getCurrent()).id')
                run.context.service_workers[0].evaluate("async windowId=>{await chrome.runtime.sendMessage({type:'OPEN_PAGE_CAPTURE',windowId}).catch(()=>{})}",window_id)
                expect(page.locator('#page-capture-save')).to_be_enabled()
                assert page.evaluate('window.scanCount')==2
                page.locator('#page-capture-cancel').click()
                print({'existingPanelToolbarReopen':True},flush=True)
            page.close()
        # A durable draft wins over automatic page discovery.
        run.seed_storage(setup,{'entries':[]})
        setup.evaluate("""async()=>{const {createCaptureDraft}=await import('./capture-draft.js');await chrome.runtime.sendMessage({type:'UPDATE_CAPTURE_DRAFT',draft:createCaptureDraft({fragments:[{id:'old',text:'用户未保存的内容'}]})})}""")
        page=run.context.new_page();page.add_init_script('('+SETUP+')({count:1})')
        page.goto(f'chrome-extension://{run.extension_id}/collector.html')
        expect(page.locator('#quick-preview')).to_contain_text('用户未保存的内容')
        assert page.evaluate('window.scanCount')==0
        page.close()
        # First-use permission remains a real permission step, not an empty automatic scan.
        run.seed_storage(setup,{'entries':[]})
        page=run.context.new_page();page.add_init_script('('+SETUP+')({count:1,permission:false})')
        page.goto(f'chrome-extension://{run.extension_id}/collector.html')
        expect(page.locator('#capture-permission-onboarding')).to_be_visible()
        assert page.evaluate('window.scanCount')==0
        page.locator('#capture-permission-cancel').click()
        expect(page.locator('#capture-permission-onboarding')).to_be_hidden()
        page.close()
        # No candidate leaves existing manual capture actions available.
        run.seed_storage(setup,{'entries':[]})
        page=run.context.new_page();page.add_init_script('('+SETUP+')({count:0})')
        page.goto(f'chrome-extension://{run.extension_id}/collector.html')
        expect(page.locator('#page-capture-help')).to_contain_text('未识别到内容')
        expect(page.locator('#page-capture-save')).to_be_disabled()
        page.locator('#page-capture-cancel').click()
        expect(page.locator('#start-clipboard')).to_be_visible()
        print({'draftPreserved':True,'firstPermissionExplicit':True,'emptyPageRecoverable':True})

if __name__=='__main__':main()
