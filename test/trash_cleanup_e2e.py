"""Permanent deletion removes stored bytes and resumes an interrupted cleanup."""
import json
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session, wait_for_async_condition


def main():
    with extension_session('pd-trash-cleanup-') as session:
        page = session.open_page('collector.html')
        gone = base_entry('gone', '永久删除验证', '原始正文', 'content:prompt:image')
        live = base_entry('live', '保留共用原件', '保留正文', 'content:prompt:image')
        asset = lambda id: {'id': id, 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png'}
        gone['mediaAssets'] = [asset('exclusive'), asset('shared')]
        gone['primaryMediaId'] = 'exclusive'
        live['mediaAssets'] = [asset('shared')]
        live['primaryMediaId'] = 'shared'
        session.seed_storage(page, {'entries': [gone, live]})
        page.evaluate('''async gone => {
          const {saveMediaBlob,saveDerivedMedia,saveDerivedMetadata} = await import('./media-store.js');
          const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;
          canvas.getContext('2d').fillRect(0,0,8,8);
          const blob=await new Promise(resolve=>canvas.toBlob(resolve));
          for (const id of ['exclusive','shared','old-exclusive','unrelated-old','retry']) {
            await saveMediaBlob(id,blob,{checkCapacity:false});
            await saveDerivedMedia(id,{thumbnail:blob});
            await saveDerivedMetadata(id,{width:8,height:8});
          }
          const old={...gone,mediaAssets:[{id:'old-exclusive',kind:'image',storageMode:'managed'}]};
          const state={entries:[old,{...old,id:'unrelated',mediaAssets:[{id:'unrelated-old',kind:'image',storageMode:'managed'}]}]};
          await chrome.storage.local.set({folderOwnershipBackup:{state},
            libraryReplacementRecoveryPoint:{version:1,id:'test-recovery',createdAt:new Date().toISOString(),state,retainedAssetIds:['old-exclusive','unrelated-old']}});
        }''', gone)
        response = page.evaluate("async()=>chrome.runtime.sendMessage({type:'BATCH_MOVE_TO_TRASH',entryIds:['gone']})")
        assert response['ok'], response
        library = session.open_page('library.html')
        expect(library.locator("body[data-library-state='ready']")).to_be_visible()
        library.locator('#open-trash').click()
        library.locator('#trash-empty').click()
        library.get_by_role('button', name='永久清空', exact=True).click()
        expect(library.locator('#trash-dialog')).not_to_be_visible()
        result = library.evaluate('''async()=>{
          const {getMediaBlob,getDerivedMedia,getDerivedMetadata}=await import('./media-store.js');
          const state=await chrome.storage.local.get(['trashState','folderOwnershipBackup','libraryReplacementRecoveryPoint','pendingTrashCleanup','legacyEntries']);
          const files={};for(const id of ['exclusive','old-exclusive','shared','unrelated-old']) files[id]={
            original:!!await getMediaBlob(id),derived:!!await getDerivedMedia(id),metadata:!!await getDerivedMetadata(id)};
          return {state,files};
        }''')
        for id in ['exclusive', 'old-exclusive']:
            assert result['files'][id] == {'original': False, 'derived': False, 'metadata': False}, result
        for id in ['shared', 'unrelated-old']:
            assert result['files'][id] == {'original': True, 'derived': True, 'metadata': True}, result
        assert not result['state']['trashState']['items'], result
        assert 'pendingTrashCleanup' not in result['state'], result
        assert [e['id'] for e in result['state']['folderOwnershipBackup']['state']['entries']] == ['unrelated'], result
        assert [e['id'] for e in result['state']['libraryReplacementRecoveryPoint']['state']['entries']] == ['unrelated'], result
        assert [e['id'] for e in result['state']['legacyEntries']] == ['live'], result
        # Deleting the last live owner must now release the previously shared file.
        await_result = library.evaluate("async()=>{await chrome.runtime.sendMessage({type:'BATCH_MOVE_TO_TRASH',entryIds:['live']});return chrome.runtime.sendMessage({type:'EMPTY_TRASH'});}")
        assert await_result['ok'], await_result
        assert library.evaluate("async()=>!await (await import('./media-store.js')).getMediaBlob('shared')")

        # Force a real IndexedDB failure after metadata commits, then restart the worker.
        retry = {**gone, 'id': 'retry-case', 'mediaAssets': [asset('retry')], 'primaryMediaId': 'retry'}
        library.evaluate("async entry=>(await import('./library-storage.js')).getLibraryStorage().set({entries:[entry]})", retry)
        library.evaluate("async()=>chrome.runtime.sendMessage({type:'BATCH_MOVE_TO_TRASH',entryIds:['retry-case']})")
        worker = session.context.service_workers[0]
        worker.evaluate('''()=>{
          const original=IDBDatabase.prototype.transaction;
          IDBDatabase.prototype.transaction=function(stores,mode,...args){
            if(mode==='readwrite'&&Array.isArray(stores)&&stores.includes('derived-media')) throw new Error('fixture disk failure');
            return original.call(this,stores,mode,...args);
          };
        }''')
        response = library.evaluate("async()=>chrome.runtime.sendMessage({type:'EMPTY_TRASH'})")
        assert not response['ok'], response
        pending = library.evaluate("async()=>(await chrome.storage.local.get('pendingTrashCleanup')).pendingTrashCleanup")
        assert pending['mediaIds'] == ['retry'], pending
        cdp = session.context.new_cdp_session(library)
        versions = []
        cdp.on('ServiceWorker.workerVersionUpdated', lambda event: versions.extend(event['versions']))
        cdp.send('ServiceWorker.enable')
        for _ in range(50):
            if any(item.get('scriptURL', '').startswith(f'chrome-extension://{session.extension_id}/') for item in versions):
                break
            library.wait_for_timeout(20)
        current = next(item for item in reversed(versions) if item.get('scriptURL', '').startswith(f'chrome-extension://{session.extension_id}/'))
        cdp.send('ServiceWorker.stopWorker', {'versionId': current['versionId']})
        cdp.detach()
        library.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        wait_for_async_condition(library, "async()=>!(await chrome.storage.local.get('pendingTrashCleanup')).pendingTrashCleanup")
        assert library.evaluate("async()=>!await (await import('./media-store.js')).getMediaBlob('retry')")
        assert library.evaluate("async()=>(await chrome.storage.local.get('trashState')).trashState.items.length") == 0
        print(json.dumps({'visible_empty_trash': True, 'original_and_derived_removed': True,
            'shared_and_unrelated_backup_preserved': True, 'last_owner_releases_shared': True,
            'real_worker_restart_cleanup': True}))


if __name__ == '__main__':
    main()
