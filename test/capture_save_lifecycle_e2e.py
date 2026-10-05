"""Close/reopen/cancel/continue through the real collector and background worker."""
import hashlib
import json
from playwright.sync_api import expect
from capture_organization_progress_e2e import main as with_download


def scenario(run, page, worker, out, video):
    page.close()
    page=run.open_page('collector.html')
    expect(page.locator('#feedback')).to_contain_text('49%',timeout=10000)
    expect(page.locator('#page-capture-save')).to_have_text('取消保存')
    expect(page.locator('#page-capture-save')).to_be_enabled()
    before=page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_CASE_LIBRARY_STATE'})")
    assert before['ok'] and len(before['entries'])==0
    note=page.evaluate("async()=>chrome.runtime.sendMessage({type:'CREATE_QUICK_NOTE',title:'下载期间新建的笔记',text:'用户同期编辑必须保留'})")
    assert note['ok'],note
    library=run.open_page('library.html')
    expect(library.locator('body')).to_have_attribute('data-library-state','ready',timeout=10000)
    library.close()
    page.screenshot(path=str(out/'reopened-download.png'))
    page.locator('#page-capture-save').click()
    page.wait_for_function("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task?.status==='cancelled'",timeout=10000)
    assert worker.evaluate('()=>captureFixture.requests[0].signal.aborted')
    expect(page.locator('#page-capture-save')).to_have_text('保存案例')
    expect(page.locator('#page-capture-save')).to_be_enabled()
    assert len(page.evaluate("async()=>(await chrome.storage.local.get('entries')).entries"))==1
    expect(page.locator('#feedback')).to_contain_text('待保存内容已保留')
    expect(page.locator('#page-capture-help')).to_have_text('')
    page.screenshot(path=str(out/'cancelled-retained.png'))
    page.close()
    page=run.open_page('collector.html')
    expect(page.locator('#page-capture')).to_be_visible()
    expect(page.locator('#page-capture-save')).to_be_enabled()
    page.evaluate('()=>{chrome.permissions.request=async()=>true;}')
    page.locator('#page-capture-save').click()
    page.wait_for_function("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task?.status==='running'",timeout=10000)
    worker.evaluate('''async()=>{for(let i=0;i<100;i++){if(captureFixture.requests.length===2&&captureFixture.gates.has("video"))return;await new Promise(r=>setTimeout(r,20));}throw new Error("resume did not reach the network stream");}''')
    worker.evaluate('()=>captureFixture.gates.get("video")()')
    expect(page.locator('#feedback')).to_contain_text('正在入库',timeout=30000)
    response=page.evaluate("async()=>{const {task}=await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'});return chrome.runtime.sendMessage({type:'CANCEL_CAPTURE_SAVE',id:task.id});}")
    assert not response['ok'],response
    expect(page.locator('#page-capture-save')).to_be_disabled()
    page.close()
    worker.evaluate('()=>captureFixture.gates.get("commit")()')
    saved=run.open_page('collector.html')
    expect(saved.locator('#page-capture')).to_be_hidden(timeout=30000)
    saved.wait_for_function("async()=>!(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task",timeout=10000)
    state=saved.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
    assert len(state['entries'])==2,state['entries']
    assert any(entry['text']=='用户同期编辑必须保留' for entry in state['entries'])
    entry=next(entry for entry in state['entries'] if any(asset['kind']=='video' for asset in entry.get('mediaAssets',[])))
    asset=next(asset for asset in entry.get('mediaAssets',[]) if asset['kind']=='video')
    readback=saved.evaluate("""async id=>{
      const blob=await(await import('./media-store.js')).getMediaBlob(id);
      const sha=await(await import('./blob-digest.js')).sha256Blob(blob);
      return {bytes:blob.size,sha};
    }""",asset['id'])
    assert readback=={'bytes':len(video),'sha':hashlib.sha256(video).hexdigest()},readback
    draft=saved.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})).draft")
    assert not draft['fragments'] and not draft['visuals'],draft
    saved.screenshot(path=str(out/'reopened-saved-receipt.png'))
    result={'closeContinuesAndReopenRestores':True,'libraryOpensWhileDownloading':True,
        'cancelAbortsNetworkAndRetainsPending':True,'reopenAfterCancelCanContinue':True,
        'receiptRestoredAfterClosingBeforeCommit':True,'concurrentCasePreserved':True,
        'originalReadback':readback,'pendingDraftCleanedOnlyAfterSave':True,'pageErrors':run.page_errors}
    (out/'lifecycle-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    assert not run.page_errors,run.page_errors
    print(result,flush=True)


if __name__=='__main__':with_download(scenario)
