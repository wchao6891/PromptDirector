"""A real worker stop and wake recover the task and completed original file."""
import hashlib
import json
from playwright.sync_api import expect
from e2e_support import wait_for_async_condition
from capture_organization_progress_e2e import main as with_download


def scenario(run,page,worker,out,video):
    worker.evaluate('()=>captureFixture.gates.get("video")()')
    wait_for_async_condition(page, "async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task?.status==='committing'", timeout=30000)
    task=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
    assert len(task['checkpoints'])==1
    assert len(page.evaluate("async()=>(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries"))==0
    # Stop only the service worker in this disposable test profile, keeping the
    # installed extension and persistent cache. The next collector wakes it.
    cdp=run.context.new_cdp_session(page)
    versions=[]
    cdp.on('ServiceWorker.workerVersionUpdated',lambda event: versions.extend(event['versions']))
    cdp.send('ServiceWorker.enable')
    for _ in range(50):
        if any(item.get('scriptURL','').startswith(f'chrome-extension://{run.extension_id}/') for item in versions):break
        page.wait_for_timeout(20)
    current=next(item for item in reversed(versions) if item.get('scriptURL','').startswith(f'chrome-extension://{run.extension_id}/'))
    cdp.send('ServiceWorker.stopWorker',{'versionId':current['versionId']})
    cdp.detach()
    page.close()
    page=run.open_page('collector.html')
    expect(page.locator('#feedback')).to_contain_text('下载中断',timeout=15000)
    expect(page.locator('#page-capture-help')).to_have_text('')
    expect(page.locator('#page-capture')).to_be_visible()
    recovered=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
    assert recovered['id']==task['id'] and recovered['status']=='interrupted'
    page.screenshot(path=str(out/'worker-interrupted.png'))
    page.evaluate('()=>{chrome.permissions.request=async()=>true;}')
    # There is no fetch fixture in the restarted worker. The invalid source host
    # cannot supply this file; successful exact readback proves checkpoint reuse.
    page.locator('#page-capture-save').click()
    expect(page.locator('#page-capture')).to_be_hidden(timeout=30000)
    state=page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
    assert len(state['entries'])==1
    entry=state['entries'][0]
    asset=next(asset for asset in entry['mediaAssets'] if asset['kind']=='video')
    actual=page.evaluate("""async id=>{
      const blob=await(await import('./media-store.js')).getMediaBlob(id);
      return {bytes:blob.size,sha:await(await import('./blob-digest.js')).sha256Blob(blob)};
    }""",asset['id'])
    assert actual=={'bytes':len(video),'sha':hashlib.sha256(video).hexdigest()},actual
    taskAfter=page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
    assert taskAfter is None
    result={'realWorkerStopInterruptedTaskRestored':True,'completedOriginalReusedWithoutNetwork':actual,
        'onlyOneCaseAfterResume':True,'checkpointReleasedAfterReceipt':True,'pageErrors':run.page_errors}
    (out/'restart-checks.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
    assert not run.page_errors,run.page_errors
    print(result,flush=True)


if __name__=='__main__':with_download(scenario)
