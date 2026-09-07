"""Capture transports are fixtures; draft writes, merge, media storage and final save are real."""
from playwright.sync_api import expect
from pathlib import Path
import tempfile
from e2e_support import extension_session

def main():
    with extension_session('capture-additions-', viewport={'width':390,'height':844}) as run:
        page=run.open_page('collector.html')
        run.seed_storage(page,{'entries':[], 'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-07T00:00:00Z','clipboardIncluded':True}})
        page.evaluate("""async()=>{
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          const {createCaptureDraft,addDraftFragment,addDraftVisual}=await import('./capture-draft.js');
          const {saveScreenshotBlob}=await import('./image-store.js');
          async function image(id,color) {
            const canvas=document.createElement('canvas');canvas.width=100;canvas.height=120;
            const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,100,120);
            const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));await saveScreenshotBlob(id,blob);
            return {id,mimeType:'image/png',width:100,height:120,sourceTitle:id};
          }
          const first=await image('first-image','#336699'), extra=await image('extra-image','#996633');
          window.makeImage=image;window.extraImage=extra; window.captureKinds=[];window.cancelScreenshot=false;
          const initial=createCaptureDraft({title:'已有草稿',fragments:[{id:'first-text',text:'已有的选中文字，必须与网页内容保存在同一个案例。',sourceUrl:'https://example.com/first'}],visuals:[first],customLabels:['保留标签']});
          await send({type:'UPDATE_CAPTURE_DRAFT',draft:initial});
          const snapshot={id:'web-batch',sourceUrl:'https://example.com/post',candidates:[{id:'main',canonicalUrl:'https://example.com/post',title:'网页的案例',pageType:'post',contentText:'网页主帖原始提示词：主体在漫展中自然行动，镜头记录人物与环境。',textBlocks:[{id:'main-text',kind:'section',text:'网页主帖原始提示词：主体在漫展中自然行动，镜头记录人物与环境。'}],media:[],sourceFacts:{provider:'example.com',pageType:'post'}}],selections:[]};
          window.webSnapshot=snapshot;
          chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;
          const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async q=>q.active?[{id:999,url:'https://example.com/post'}]:query(q);
          Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>[{types:['text/plain'],getType:async()=>new Blob(['剪贴板补充：保持动作连续。'],{type:'text/plain'})}]}});
          chrome.runtime.sendMessage=async m=>{
            if(m.type==='START_PAGE_CAPTURE')return {ok:true,batch:window.webSnapshot};
            if(m.type==='PREVIEW_PAGE_CAPTURE_REGION'||m.type==='CLEAR_PAGE_CAPTURE_MARKERS')return {ok:true};
            if(m.type==='START_SMART_VISUAL_SELECTION')return {ok:true,session:{sessionId:'smart',selectedCount:1,candidateCount:1}};
            if(m.type==='CANCEL_SMART_VISUAL_SELECTION')return {ok:true};
            if(['ADD_ACTIVE_SELECTION_TO_DRAFT','CONFIRM_SMART_VISUAL_SELECTION','CAPTURE_ACTIVE_TAB_TO_DRAFT'].includes(m.type)) {
              window.captureKinds.push(m.type);
              if(m.type==='CAPTURE_ACTIVE_TAB_TO_DRAFT'&&window.cancelScreenshot)return {ok:false,message:'已取消框选截图'};
              const current=(await send({type:'GET_CAPTURE_WORKSPACE'})).draft;
              const next=m.type==='ADD_ACTIVE_SELECTION_TO_DRAFT'
                ? addDraftFragment(current,{id:'selected-extra',text:'网页高亮补充：使用自然光与清晰构图。',sourceUrl:'https://example.com/post'}).draft
                :addDraftVisual(current,extra);
              return send({type:'UPDATE_CAPTURE_DRAFT',draft:next});
            }
            return send(m);
          };
        }""")
        # Trigger ordinary focus refresh without losing transport fixtures.
        page.evaluate("()=>window.dispatchEvent(new Event('focus'))")
        expect(page.locator('#preview-state')).to_be_visible()
        page.locator('#add-page-capture').click()
        page.locator('.page-capture-confirm').click()
        expect(page.locator('.page-capture-excerpt')).to_contain_text('已有的选中文字')
        expect(page.locator('.page-capture-thumbnails img')).to_have_count(1)
        expect(page.locator('#page-capture #capture-add-more-actions')).to_be_visible()
        for width in (320,390):
            page.set_viewport_size({'width':width,'height':844})
            boxes=page.locator('#capture-add-more-actions > button').evaluate_all('es=>es.map(e=>({top:e.getBoundingClientRect().top,h:e.getBoundingClientRect().height,overflow:e.scrollWidth>e.clientWidth}))')
            assert len(boxes)==5 and len({b['top'] for b in boxes})==1 and len({b['h'] for b in boxes})==1 and not any(b['overflow'] for b in boxes),boxes
        page.locator('#add-selection').click()
        expect(page.locator('.page-capture-excerpt')).to_contain_text('网页高亮补充')
        page.locator('#add-clipboard').click()
        expect(page.locator('.page-capture-excerpt')).to_contain_text('剪贴板补充')
        page.locator('#add-smart-visuals').click()
        expect(page.locator('#smart-selection')).to_be_visible()
        expect(page.locator('#page-capture')).to_be_hidden()
        page.locator('#smart-selection-cancel').click()
        expect(page.locator('#page-capture')).to_be_visible()
        expect(page.locator('.page-capture-thumbnails img')).to_have_count(1)
        page.locator('#add-smart-visuals').click();page.locator('#smart-selection-confirm').click()
        expect(page.locator('.page-capture-thumbnails img')).to_have_count(2)
        page.evaluate('()=>window.cancelScreenshot=true')
        page.locator('#add-screenshot').click()
        expect(page.locator('#page-capture')).to_be_visible()
        expect(page.locator('.page-capture-thumbnails img')).to_have_count(2)
        page.evaluate('()=>window.cancelScreenshot=false')
        page.locator('#add-screenshot').click()
        expect(page.locator('.page-capture-thumbnails img')).to_have_count(2)
        expect(page.locator('#page-capture')).to_be_visible()
        # Supplementary webpage cancel and confirmation both retain the current case.
        page.locator('#add-page-capture').click();page.locator('#page-capture-cancel').click()
        expect(page.locator('.page-capture-excerpt')).to_contain_text('剪贴板补充')
        page.locator('#add-page-capture').click();page.locator('.page-capture-confirm').click()
        expect(page.locator('.page-capture-thumbnails img')).to_have_count(2)
        expect(page.locator('.page-capture-excerpt')).to_contain_text('网页高亮补充')
        for width in (320,390):
            page.set_viewport_size({'width':width,'height':844})
            page.locator('#capture-add-more-actions').scroll_into_view_if_needed()
            page.screenshot(path=str(Path(tempfile.gettempdir()) / f'pd-capture-additions-{width}.png'))
        page.locator('#content-type').select_option('content:prompt:image')
        page.locator('#capture-collection').select_option('new-collection')
        page.locator('#capture-new-collection-name').fill('采集补充测试')
        page.locator('#page-capture-save').click()
        expect(page.locator('#page-capture')).to_be_hidden(timeout=15000)
        saved=page.evaluate("async()=>{const s=await chrome.runtime.sendMessage({type:'GET_STATE'});return s.entries}")
        assert len(saved)==1,saved
        entry=saved[0]
        for text in ['已有的选中文字','网页主帖','网页高亮补充','剪贴板补充']:assert text in entry['text'],entry['text']
        assert len(entry['mediaAssets'])==2,entry['mediaAssets']
        assert '保留标签' in entry['customLabels'],entry
        assert entry['classification']['pathIds']==['content:prompt:image'],entry['classification']
        projects=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).organizerState.collections")
        assert any(p['name']=='采集补充测试' and entry['id'] in p['entryIds'] for p in projects),projects
        blobs=page.evaluate("async ids=>{const {getMediaBlob}=await import('./media-store.js');return Promise.all(ids.map(async id=>(await getMediaBlob(id))?.size))}",[m['id'] for m in entry['mediaAssets']])
        assert all(blobs),blobs
        draft=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})).draft")
        assert not draft['fragments'] and not draft['visuals'],draft
        # Text-only save must leave unsaved image bytes available in the draft.
        page.evaluate('''async()=>{
          const image=await window.makeImage('pending-image','#551133');
          const {createCaptureDraft}=await import('./capture-draft.js');
          await chrome.runtime.sendMessage({type:'UPDATE_CAPTURE_DRAFT',draft:createCaptureDraft({visuals:[image]})});
          window.webSnapshot={...window.webSnapshot,candidates:window.webSnapshot.candidates.map(c=>({...c,id:'second',canonicalUrl:'https://example.com/second'}))};
          window.dispatchEvent(new Event('focus'));
        }''')
        expect(page.locator('#preview-state')).to_be_visible()
        page.locator('#add-page-capture').click();page.locator('.page-capture-confirm').click()
        page.locator('#page-capture-save-text-only').click()
        expect(page.locator('#page-capture')).to_be_hidden()
        remaining=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})).draft")
        assert [v['id'] for v in remaining['visuals']]==['pending-image'],remaining
        assert page.evaluate("async()=>(await (await import('./image-store.js')).getScreenshotBlob('pending-image')).size")>0
        print({'text_only_keeps_image':True,'project_saved':True,'manual_type_saved':True})
        print({'one_case':True,'all_five_methods':True,'cancel_preserved':True,'duplicate_ignored':True,'media_readback':blobs,'tags_preserved':True,'widths':[320,390]})
if __name__=='__main__':main()
