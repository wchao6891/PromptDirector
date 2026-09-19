"""Synthetic page and missing local image; production save, receipts and collector cleanup."""
from playwright.sync_api import expect
from e2e_support import extension_session
from pathlib import Path
import os


def main():
    with extension_session('capture-partial-', viewport={'width':390,'height':844}) as run:
        run.context.route('https://wchao6891.github.io/page-saved-selection', lambda route: route.fulfill(body='<html><meta charset="utf-8"><p id="source">必须保留的补充提示词</p></html>', content_type='text/html'))
        source=run.context.new_page();source.goto('https://wchao6891.github.io/page-saved-selection')
        source.evaluate('()=>{const range=document.createRange();range.selectNodeContents(document.querySelector("#source"));getSelection().addRange(range)}')
        run.context.service_workers[0].evaluate('''async()=>{const query=chrome.tabs.query.bind(chrome.tabs);const [tab]=await query({url:'https://wchao6891.github.io/page-saved-selection'});chrome.tabs.query=async q=>q.active?[tab]:query(q)}''')
        page=run.open_page('collector.html')
        run.seed_storage(page,{'entries':[], 'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-19T00:00:00Z','clipboardIncluded':True}})
        page.evaluate('''async()=>{
          const send=chrome.runtime.sendMessage.bind(chrome.runtime);
          const {createCaptureDraft}=await import('./capture-draft.js');
          const {saveScreenshotBlob}=await import('./image-store.js');
          const {sha256Blob}=await import('./blob-digest.js');
          window.restoreImage=async(id,color)=>{
            const canvas=document.createElement('canvas');canvas.width=80;canvas.height=100;
            canvas.getContext('2d').fillStyle=color;canvas.getContext('2d').fillRect(0,0,80,100);
            const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
            await saveScreenshotBlob(id,blob);
            return {id,mimeType:'image/png',contentHash:await sha256Blob(blob),width:80,height:100};
          };
          const good=await window.restoreImage('good','#336699');
          await send({type:'UPDATE_CAPTURE_DRAFT',draft:createCaptureDraft({
            fragments:[{id:'supplement',text:'必须保留的补充提示词'}],
            visuals:[good,{id:'missing',mimeType:'image/png',width:80,height:100}]
          })});
          chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;
          const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async q=>q.active?[{id:999,url:'https://example.com/partial'}]:query(q);
          chrome.runtime.sendMessage=async m=>{
            if(m.type==='START_PAGE_CAPTURE')return {ok:true,batch:{id:'partial',sourceUrl:'https://example.com/partial',candidates:[{
              id:'main',canonicalUrl:'https://example.com/partial',title:'部分媒体保存',pageType:'post',contentText:'原始正文',
              textBlocks:[{id:'body',kind:'section',text:'原始正文'}],media:[],sourceFacts:{provider:'example.com',pageType:'post'}
            }]}};
            if(['PREVIEW_PAGE_CAPTURE_REGION','CLEAR_PAGE_CAPTURE_MARKERS'].includes(m.type))return {ok:true};
            const result=await send(m);if(m.type==='COMMIT_PAGE_CAPTURE')window.lastSave=result;return result;
          };
          window.dispatchEvent(new Event('focus'));
        }''')
        expect(page.locator('#preview-state')).to_be_visible()
        page.locator('#add-page-capture').click();page.locator('.page-capture-confirm').click()
        page.locator('#page-capture-save').click()
        page.wait_for_function('()=>Boolean(window.lastSave)')
        snapshot=page.evaluate('''async()=>({result:window.lastSave,
          draft:(await chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})).draft,
          entries:(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries})''')
        print({'firstSave':snapshot},flush=True)
        expect(page.locator('#page-capture')).to_be_visible()
        assert [v['id'] for v in snapshot['draft']['visuals']]==['missing'],snapshot['draft']
        assert not snapshot['draft']['fragments']
        assert len(snapshot['entries'])==1 and len(snapshot['entries'][0]['mediaAssets'])==1
        expect(page.locator('#page-capture-save')).to_be_enabled()
        out=Path(os.environ.get('PD_TEST_SCREENSHOTS','/tmp/pd-capture-partial'));out.mkdir(parents=True,exist_ok=True)
        for theme in ['dark','light']:
            page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
            for width in [390,1280]:
                page.set_viewport_size({'width':width,'height':844})
                page.screenshot(path=str(out/f'partial-{theme}-{width}.png'),animations='disabled')
        page.evaluate("()=>window.restoreImage('missing','#993366')")
        page.evaluate('()=>window.lastSave=null')
        page.locator('#page-capture-save').click()
        expect(page.locator('#page-capture')).to_be_hidden()
        final=page.evaluate('''async()=>({draft:(await chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})).draft,
          entries:(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries})''')
        assert len(final['entries'])==1 and len(final['entries'][0]['mediaAssets'])==2,final
        assert len([b for b in final['entries'][0]['articleDocument']['blocks'] if b.get('kind')=='image'])==2,final['entries'][0]['articleDocument']
        assert final['entries'][0]['text'].count('必须保留的补充提示词')==1
        assert not final['draft']['visuals'] and not final['draft']['fragments'],final['draft']
        returned=page.evaluate("async()=>chrome.runtime.sendMessage({type:'TRY_ACTIVE_SELECTION_TO_DRAFT'})")
        assert returned.get('added') is False and returned.get('reason')=='already-saved-selection',returned
        print({'pageSavedSelectionSuppressed':True,'partialRetained':True,'retrySameCase':True,'savedMediaPreserved':True,'completedDraftCleared':True})

if __name__=='__main__':main()
