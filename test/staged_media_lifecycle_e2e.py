"""Actual UI close/cancel, duplicate reuse, failure isolation and worker recovery."""
import base64
import json
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, wait_for_async_condition

PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')
FILE = {'name': 'original.png', 'mimeType': 'image/png', 'buffer': PNG}
SNAP = '''async()=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('prompt-case-collector');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 const rows=await new Promise((resolve,reject)=>{const tx=db.transaction('media','readonly'),s=tx.objectStore('media'),rows=[];const r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return resolve(rows);rows.push({id:c.key,size:c.value.size});c.continue()};r.onerror=()=>reject(r.error)});db.close();
 const s=await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get(['entries','stagedMediaWrites']));return {rows,entries:s.entries||[],stages:s.stagedMediaWrites||{}};
}'''

def settled(page):
    wait_for_async_condition(page, "async()=>!Object.keys((await chrome.storage.local.get('stagedMediaWrites')).stagedMediaWrites||{}).length")

def ready(page):
    expect(page.locator("body[data-library-state='ready']")).to_be_visible()

def prepare(page, file=FILE):
    page.locator('#media-file').set_input_files(file)
    expect(page.locator('#import-confirmation')).to_be_visible()
    expect(page.locator('#import-supported-count')).to_have_text('1')

with extension_session('pd-staged-media-') as run:
    page = run.open_page('library.html'); ready(page)
    prepare(page)
    before = page.evaluate(SNAP)
    assert len(before['rows']) == 1 and len(before['stages']) == 1 and not before['entries'], before
    page.close()
    page = run.open_page('library.html'); ready(page); settled(page)
    assert not page.evaluate(SNAP)['rows'], 'closing preview must remove its uncommitted bytes'
    prepare(page); page.reload(); ready(page); settled(page)
    assert not page.evaluate(SNAP)['rows'], 'reloading the same tab must retire its old document ownership'
    prepare(page); page.locator('#import-cancel').click()
    expect(page.locator('#import-dialog')).not_to_be_visible(); settled(page)
    assert not page.evaluate(SNAP)['rows']

    # Fail one registration. The same batch can skip that file and save the next.
    page.evaluate('''()=>{window.realSend=chrome.runtime.sendMessage.bind(chrome.runtime);let failed=false;
      chrome.runtime.sendMessage=async(...args)=>{if(args[0]?.type==='REGISTER_STAGED_MEDIA'&&!failed){failed=true;return{ok:false,message:'fixture registration failure'}};return window.realSend(...args)};}''')
    page.locator('#media-file').set_input_files([{'name':'failed.png','mimeType':'image/png','buffer':PNG}, FILE])
    expect(page.locator('#import-supported-count')).to_have_text('1')
    expect(page.locator('#import-skipped-count')).to_have_text('1')
    page.locator('#import-start').click()
    wait_for_async_condition(page, "async()=>(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries?.length===1")
    expect(page.locator('#import-dialog')).not_to_be_visible(); settled(page)
    assert page.locator('dialog[open]').count() == 0, 'no failure modal should trap the user'
    page.evaluate('()=>{chrome.runtime.sendMessage=window.realSend}')
    saved = page.evaluate(SNAP)
    assert len(saved['rows']) == 1
    page.reload(); ready(page)
    prepare(page); expect(page.locator('#import-duplicate-count')).to_have_text('1')
    assert len(page.evaluate(SNAP)['rows']) == 1, 'known duplicates must not copy another original during preview'
    page.locator('#import-file-list input').check(); page.locator('#import-start').click()
    wait_for_async_condition(page, "async()=>(await import(chrome.runtime.getURL('library-storage.js')).then(({getLibraryStorage}) => getLibraryStorage().get('entries'))).entries?.length===2")
    expect(page.locator('#import-dialog')).not_to_be_visible(); settled(page)
    copies = page.evaluate(SNAP)
    assert len(copies['rows']) == 1 and len({e['id'] for e in copies['entries']}) == 2, copies
    assert len({e['mediaAssets'][0]['id'] for e in copies['entries']}) == 1, copies
    response = page.evaluate('''async id=>{await chrome.runtime.sendMessage({type:'BATCH_MOVE_TO_TRASH',entryIds:[id]});return chrome.runtime.sendMessage({type:'EMPTY_TRASH'})}''', copies['entries'][0]['id'])
    assert response['ok'], response
    assert len(page.evaluate(SNAP)['rows']) == 1, 'deleting one duplicate must preserve the other original'

    # Local review registration succeeds, but the subsequent preparation message fails.
    error = page.evaluate('''async()=>{const {prepareReviewFile}=await import('./review-file-transfer.js');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const blob=await new Promise(r=>canvas.toBlob(r));
      const api={runtime:{sendMessage:m=>m.type==='REVIEW_LOCAL_FILE'?Promise.reject(new Error('fixture preparation failure')):chrome.runtime.sendMessage(m)}};
      try{await prepareReviewFile(new File([blob],'review.png',{type:'image/png'}),api)}catch(e){return e.message}}''')
    assert error == 'fixture preparation failure'; settled(page)
    assert len(page.evaluate(SNAP)['rows']) == 1

    # A real IndexedDB cleanup failure keeps a retry record without blocking cancel.
    prepare(page, {'name':'another.png','mimeType':'image/png','buffer':PNG})
    worker = run.context.service_workers[0]
    worker.evaluate('''()=>{const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...args){
      if(mode==='readwrite'&&Array.isArray(stores)&&stores.includes('derived-media'))throw new Error('fixture cleanup failure');return original.call(this,stores,mode,...args)};}''')
    page.locator('#import-cancel').click()
    expect(page.locator('#import-dialog')).not_to_be_visible()
    wait_for_async_condition(page,"async()=>Object.values((await chrome.storage.local.get('stagedMediaWrites')).stagedMediaWrites||{}).some(x=>x.released)")
    assert page.locator('dialog[open]').count() == 0
    assert page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_STATE'})).ok")
    cdp = run.context.new_cdp_session(page)
    cdp.send('ServiceWorker.enable'); cdp.send('ServiceWorker.stopAllWorkers'); cdp.detach()
    page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})"); settled(page)
    assert len(page.evaluate(SNAP)['rows']) == 1
    # Preparation owns a stable poster identity before the offscreen bytes land.
    review = page.evaluate("""async data=>{
      const {prepareReviewFile}=await import('./review-file-transfer.js');
      return prepareReviewFile(new File([Uint8Array.from(atob(data), c=>c.charCodeAt(0))],'motion.gif',{type:'image/gif'}));
    }""", base64.b64encode((Path(__file__).parent/'fixtures/transfer-media/original.gif').read_bytes()).decode())
    assert review['transferId'], review
    settled(page)
    poster = page.evaluate("""async id=>{const r=(await chrome.storage.local.get('agentUpload:'+id))['agentUpload:'+id];
      const {getMediaBlob}=await import('./media-store.js');return {id:r.prepared.poster.id,expected:r.assetId+':poster',exists:!!await getMediaBlob(r.prepared.poster.id)}}""", review['transferId'])
    assert poster['id'] == poster['expected'] and poster['exists'], poster
    page.evaluate("async id=>chrome.runtime.sendMessage({type:'REVIEW_TRANSFER',operation:'abort_transfer',input:{id}})",review['transferId'])
    assert len(page.evaluate(SNAP)['rows']) == 1, 'aborting temporary review must also reclaim its derived poster'
    print(json.dumps({'closed_and_reloaded_preview_cleaned':True,'cancel_nonblocking':True,'failed_file_skipped_next_saved':True,
      'duplicate_bytes_reused_two_cases':True,'delete_shared_owner_safe':True,'review_message_failure_cleaned':True,'cleanup_failure_retried_after_worker_restart':True,'offscreen_poster_owned_and_reclaimed':True}))
