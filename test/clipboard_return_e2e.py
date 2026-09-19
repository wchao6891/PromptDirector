"""Clipboard bytes and active-tab lookup are fixtures; selection read, save and draft state are production."""
from playwright.sync_api import expect
from e2e_support import extension_session

TEXT='剪贴板保存后返回原网页，旧高亮不能自动成为新的待保存案例。'

def main():
    with extension_session('clipboard-return-') as run:
        run.context.route('https://wchao6891.github.io/saved-selection', lambda route: route.fulfill(body=f'<html><meta charset="utf-8"><body><p id="source">{TEXT}</p></body></html>',content_type='text/html'))
        source=run.context.new_page();source.goto('https://wchao6891.github.io/saved-selection')
        worker=run.context.service_workers[0]
        worker.evaluate('''async()=>{const query=chrome.tabs.query.bind(chrome.tabs);const [tab]=await query({url:'https://wchao6891.github.io/saved-selection'});
          chrome.tabs.query=async q=>q.active?[tab]:query(q); }''')
        collector=run.open_page('collector.html')
        run.seed_storage(collector,{'entries':[],'capturePermissionOnboarding':{'version':1,'acknowledgedAt':'2026-09-19T00:00:00Z','clipboardIncluded':True}})
        collector.evaluate('''text=>{
          chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;
          window.clipboardReads=0;
          Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>{window.clipboardReads++;return [{types:['text/plain'],getType:async()=>new Blob([text],{type:'text/plain'})}]}}});
        }''',TEXT)
        collector.locator('#start-clipboard').click()
        expect(collector.locator('#quick-preview')).to_contain_text(TEXT)
        source.evaluate("()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#source'));const s=getSelection();s.removeAllRanges();s.addRange(range)}")
        collector.locator('#save-draft').click()
        expect(collector.locator('#start-state')).to_be_visible()
        library=run.open_page('library.html')
        library.locator('.case-card').first.click()
        expect(library.locator('#detail-drawer')).to_be_visible()
        source.bring_to_front()
        collector.evaluate("()=>window.dispatchEvent(new Event('focus'))")
        # Query the same automatic path explicitly to ensure its async work has settled.
        result=collector.evaluate("async()=>chrome.runtime.sendMessage({type:'TRY_ACTIVE_SELECTION_TO_DRAFT'})")
        workspace=collector.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})")
        assert workspace['draft']['fragments']==[],(result,workspace['draft'])
        assert collector.evaluate('window.clipboardReads')==1
        expect(collector.locator('#preview-state')).to_be_hidden()
        # Explicit extraction remains available even for identical text.
        collector.locator('#start-selection').click()
        source.locator('#source').click()
        expect(collector.locator('#page-capture')).to_contain_text(TEXT)
        print({'saveOpenCaseReturnNoOldDraft':True,'explicitSelectionStillAvailable':True,'noClipboardWrites':True})

if __name__=='__main__': main()
