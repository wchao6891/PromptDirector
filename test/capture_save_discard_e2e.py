"""Explicit page exit releases a durable save without touching other user material."""
import json
import os
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import extension_session, wait_for_async_condition


def main():
    out = Path(os.environ.get('PD_E2E_ARTIFACT_DIR') or tempfile.mkdtemp(prefix='pd-discard-evidence-'))
    out.mkdir(parents=True, exist_ok=True)
    with extension_session('pd-discard-', viewport={'width': 468, 'height': 800}) as run:
        page = run.open_page('collector.html')
        run.seed_storage(page, {'entries': [], 'uiPreferences': {'locale': 'zh-CN', 'theme': 'dark', 'motion': 'reduced'},
            'capturePermissionOnboarding': {'version': 1, 'acknowledgedAt': '2026-10-05T00:00:00Z', 'clipboardIncluded': True}})
        saved = page.evaluate("async()=>chrome.runtime.sendMessage({type:'CREATE_QUICK_NOTE',title:'先前已入库案例',text:'必须保留'})")
        assert saved['ok'], saved
        results = []
        for status in ['failed', 'cancelled', 'pending']:
            # Restore the same durable records produced by failure, cancellation and partial acknowledgement.
            page.evaluate('''async status=>{
              const {normalizePageCaptureBatch}=await import('./page-capture.js');
              const {createCaptureDraft}=await import('./capture-draft.js');
              const draft=createCaptureDraft({fragments:status==='pending'?[{id:'separate',text:'另一份待保存原词'}]:[]});
              await chrome.runtime.sendMessage({type:'UPDATE_CAPTURE_DRAFT',draft});
              const batch=normalizePageCaptureBatch({id:'old-'+status,status:'preview',sourceUrl:'https://example.com/old',
                candidates:[{id:'old',canonicalUrl:'https://example.com/old',title:'尚未保存的网页',pageType:'post',
                  contentText:'待保存原词',textBlocks:[{id:'text',text:'待保存原词'}],media:[]}],
                selections:[{candidateId:'old',textBlockIds:['text'],mediaIds:[]}]});
              const cacheUrl='https://promptdirector.invalid/capture-save/old/'+status;
              await(await caches.open('promptdirector-capture-save')).put(cacheUrl,new Response('完整下载检查点'));
              await chrome.storage.local.set({captureSaveTask:{id:status,status,canCancel:false,assetIds:[],
                checkpoints:[{key:'original',cacheUrl}],message:'未完成保存'},
                captureSaveInput:{type:'COMMIT_PAGE_CAPTURE',saveRequestId:status,batch}});
            }''', status)
            page.reload()
            expect(page.locator('#page-capture')).to_be_visible()
            if status != 'pending':
                expect(page.locator('#collector-footer')).to_be_hidden()
            before = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})).draft")
            page.locator('#page-capture-cancel').click()
            dialog = page.locator('#promptdirector-app-dialog')
            expect(dialog).to_contain_text('放弃未保存内容？')
            if status == 'failed':
                page.screenshot(path=str(out / 'discard-confirmation.png'))
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            dialog.get_by_role('button', name='取消', exact=True).click()
            expect(page.locator('#page-capture')).to_be_visible()
            assert page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task.id") == status
            assert page.evaluate("async()=>(await(await caches.open('promptdirector-capture-save')).keys()).length") == 1
            page.locator('#page-capture-cancel').click()
            dialog.get_by_role('button', name='放弃并退出', exact=True).click()
            expect(page.locator('#page-capture')).to_be_hidden()
            assert not page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
            assert page.evaluate("async()=>(await(await caches.open('promptdirector-capture-save')).keys()).length") == 0
            after = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CAPTURE_WORKSPACE'})).draft")
            assert before == after, (before, after)
            entries = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CASE_LIBRARY_STATE'})).entries")
            assert any(entry['text'] == '必须保留' for entry in entries), entries
            page.reload()
            expect(page.locator('#page-capture')).to_be_hidden()
            # A new visible capture now proceeds through the real save service and library commit.
            page.evaluate('''status=>{
              const send=chrome.runtime.sendMessage.bind(chrome.runtime), query=chrome.tabs.query.bind(chrome.tabs);
              chrome.permissions.contains=async()=>true;chrome.permissions.request=async()=>true;
              chrome.tabs.query=async q=>q.active?[{id:999,url:'https://example.com/new/'+status}]:query(q);
              chrome.runtime.sendMessage=async message=>{
                if(message.type==='START_PAGE_CAPTURE')return {ok:true,batch:{id:'new-'+status,sourceUrl:'https://example.com/new/'+status,
                  candidates:[{id:'new',canonicalUrl:'https://example.com/new/'+status,title:'后续网页 '+status,pageType:'post',
                    contentText:'后续原词 '+status,textBlocks:[{id:'new-text',text:'后续原词 '+status}],media:[]}],selections:[]}};
                if(['CLEAR_PAGE_CAPTURE_MARKERS','PREVIEW_PAGE_CAPTURE_REGION'].includes(message.type))return {ok:true};
                return send(message);
              };
            }''', status)
            page.locator('#add-page-capture' if status == 'pending' else '#start-page-capture').click()
            page.locator('.page-capture-confirm').click()
            page.locator('#page-capture-save').click()
            expect(page.locator('#page-capture')).to_be_hidden(timeout=30000)
            wait_for_async_condition(page, "async()=>!(await chrome.runtime.sendMessage({type:'GET_CAPTURE_SAVE_TASK'})).task")
            entries = page.evaluate("async()=>(await chrome.runtime.sendMessage({type:'GET_CASE_LIBRARY_STATE'})).entries")
            new_case = next(entry for entry in entries if entry['url'] == 'https://example.com/new/'+status)
            expected_text = ('另一份待保存原词\n\n' if status == 'pending' else '') + '后续原词 '+status
            assert new_case['text'] == expected_text, new_case
            results.append({'status': status, 'dismissRetainsTaskAndCheckpoint': True, 'exitReleasesTask': True,
                'savedCaseAndSeparateDraftPreserved': True, 'nextCaptureSaved': True})
        assert not run.page_errors, run.page_errors
        print(json.dumps({'scenarios': results, 'evidence': str(out)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
