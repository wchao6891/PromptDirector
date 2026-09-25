from __future__ import annotations
import json
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session, wait_for_async_condition


def main():
    with extension_session('pd-folder-ownership-', viewport={'width': 1440, 'height': 1000}) as session:
        setup = session.open_page('collector.html')
        a = base_entry('a', '原案例', '原始提示词', 'content:prompt:image')
        a['mediaAssets'] = [{'id': 'asset:a', 'kind': 'image', 'storageMode': 'managed', 'mimeType': 'image/png', 'width': 8, 'height': 8}]
        a['primaryMediaId'] = 'asset:a'
        session.seed_storage(setup, {'schemaVersion': 28, 'entries': [a], 'organizerState': {'version': 7, 'collections': [
            {'id': 'p', 'name': '项目一', 'entryIds': ['a']}, {'id': 'q', 'name': '项目二', 'entryIds': ['a']},
            {'id': 'r', 'name': '项目三', 'entryIds': []}
        ]}})
        setup.evaluate('''async () => {
          const {saveMediaBlob} = await import(chrome.runtime.getURL('media-store.js'));
          const canvas = document.createElement('canvas'); canvas.width=8; canvas.height=8;
          canvas.getContext('2d').fillRect(0,0,8,8);
          await saveMediaBlob('asset:a', await new Promise(r => canvas.toBlob(r)), {checkCapacity:false});
        }''')
        library = session.open_page('library.html')
        expect(library.locator("body[data-library-state='ready']")).to_be_visible()
        expect(library.locator('#project-search')).to_have_count(0)
        initial = library.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert len(initial['entries']) == 2, initial
        assert 'folderOwnershipBackup' not in initial
        q_id = next(c for c in initial['organizerState']['collections'] if c['id'] == 'q')['entryIds'][0]
        assert q_id != 'a'
        stored = library.evaluate("async () => (await chrome.storage.local.get('folderOwnershipBackup')).folderOwnershipBackup")
        assert len(stored['state']['entries']) == 1
        library.reload()
        expect(library.locator("body[data-library-state='ready']")).to_be_visible()
        assert library.evaluate("async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.length") == 2
        # Native dragging from the library overview into the left project tree.
        library.locator('.case-card[data-entry-id="a"]').drag_to(library.locator('.project-row[data-collection-id="r"] .project-filter'))
        wait_for_async_condition(library, """async () => {
          const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
          return s.organizerState.collections.find(c=>c.id==='r').entryIds.includes('a');
        }""")
        moved = library.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert next(c for c in moved['organizerState']['collections'] if c['id']=='p')['entryIds'] == []
        assert next(c for c in moved['organizerState']['collections'] if c['id']=='q')['entryIds'] == [q_id]
        # A case can leave a project by dropping onto Unassigned, without deletion.
        library.locator('.project-row[data-collection-id="r"] .project-filter').click()
        library.locator('.case-card[data-entry-id="a"]').drag_to(library.locator('#workspace-unassigned'))
        wait_for_async_condition(library, """async () => {
          const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
          return s.organizerState.collections.every(c=>!c.entryIds.includes('a'));
        }""")
        expect(library.locator('.case-card[data-entry-id="a"]')).to_have_count(0)
        library.locator('#workspace-unassigned').click()
        expect(library.locator('.case-card[data-entry-id="a"]')).to_be_visible()
        unassigned = library.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert len(unassigned['entries']) == 2
        assert next(c for c in unassigned['organizerState']['collections'] if c['id']=='q')['entryIds'] == [q_id]
        assert library.evaluate("async () => (await (await import('./media-store.js')).getMediaBlob('asset:a')).size") > 0
        # Dropping an already unassigned case is harmless; it can be moved back.
        library.mouse.move(700, 600)
        library.locator('.case-card[data-entry-id="a"]').drag_to(library.locator('#workspace-unassigned'))
        library.locator('.case-card[data-entry-id="a"]').drag_to(library.locator('.project-row[data-collection-id="r"] .project-filter'))
        wait_for_async_condition(library, """async () => {
          const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
          return s.organizerState.collections.find(c=>c.id==='r').entryIds.includes('a');
        }""")
        library.locator('.project-row[data-collection-id="r"] .project-filter').click()
        # Native trash drop is recoverable deletion, including original project membership.
        library.locator('.case-card[data-entry-id="a"]').drag_to(library.locator('#open-trash'))
        wait_for_async_condition(library, "async () => !(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.some(e=>e.id==='a')")
        expect(library.locator('.case-card[data-entry-id="a"]')).to_have_count(0)
        assert library.evaluate("async () => (await (await import('./media-store.js')).getMediaBlob('asset:a')).size") > 0
        library.locator('#open-trash').click()
        library.locator('#trash-list button[aria-label="恢复：原案例"]').click()
        wait_for_async_condition(library, """async () => {
          const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
          return s.entries.some(e=>e.id==='a') && s.organizerState.collections.find(c=>c.id==='r').entryIds.includes('a');
        }""")
        library.locator('#trash-close').click()
        expect(library.locator('.case-card[data-entry-id="a"]')).to_be_visible()
        # Exercise the visible Copy action, then check independent metadata.
        library.locator('#select-cases').click()
        library.locator('.case-card[data-entry-id="a"]').click()
        library.locator('#selection-project-menu summary').click()
        library.locator('#selection-project-target').select_option('r')
        library.locator('#selection-copy-project').click()
        wait_for_async_condition(library, "async () => (await chrome.runtime.sendMessage({type:'GET_STATE'})).entries.length===3")
        copied = library.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
        copy_id = next(e['id'] for e in copied['entries'] if e['id'] not in ['a', q_id])
        result = library.evaluate("async id => chrome.runtime.sendMessage({type:'UPDATE_ENTRY_TITLE',entryId:id,title:'副本编辑'})", copy_id)
        assert result['ok'], result
        result = library.evaluate("async () => chrome.runtime.sendMessage({type:'BATCH_MOVE_TO_TRASH',entryIds:['a']})")
        assert result['ok'], result
        result = library.evaluate("async () => chrome.runtime.sendMessage({type:'EMPTY_TRASH'})")
        assert result['ok'], result
        final = library.evaluate("async () => chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert next(e for e in final['entries'] if e['id']==q_id)['title'] == '原案例'
        assert next(e for e in final['entries'] if e['id']==copy_id)['title'] == '副本编辑'
        blob_size = library.evaluate("async () => (await (await import(chrome.runtime.getURL('media-store.js'))).getMediaBlob('asset:a')).size")
        assert blob_size > 0
        undo_check = library.evaluate("""async () => {
          const {saveMediaBlob,getMediaBlob} = await import('./media-store.js');
          const {createScreenshotSaveUndo} = await import('./save-history.js');
          const stored=await chrome.storage.local.get('entries');
          const entry={...structuredClone(stored.entries[0]),id:'legacy-shot',screenshotUpdatedAt:'2026-09-23T00:00:00.000Z',
            mediaAssets:[{id:'legacy-shot',kind:'image',storageMode:'managed',mimeType:'image/png'}],primaryMediaId:'legacy-shot'};
          const copy={...structuredClone(entry),id:'legacy-copy'};
          await saveMediaBlob('legacy-shot',new Blob(['new-image'],{type:'image/png'}));
          await saveMediaBlob('backup:legacy-shot',new Blob(['old-image'],{type:'image/png'}));
          await chrome.storage.local.set({entries:[...stored.entries,entry,copy],lastSaveUndo:createScreenshotSaveUndo(
            entry.id,{hasScreenshot:true},entry.screenshotUpdatedAt,true,'backup:legacy-shot')});
          const response=await chrome.runtime.sendMessage({type:'UNDO_LAST'});
          if(!response.ok) throw new Error(response.message);
          const id=response.entry.primaryMediaId;
          const original=await getMediaBlob(id), retained=await getMediaBlob('legacy-shot');
          return {id,original:await original.text(),copy:await retained.text(),hash:response.entry.mediaAssets[0].contentHash};
        }""")
        assert undo_check['id'] != 'legacy-shot' and undo_check['original']=='old-image' and undo_check['copy']=='new-image',undo_check
        assert len(undo_check['hash'])==64,undo_check
        screenshot = Path(tempfile.gettempdir()) / 'promptdirector-folder-ownership.png'
        library.screenshot(path=str(screenshot))
        assert not session.page_errors, session.page_errors
        print(json.dumps({'migration':True,'idempotent':True,'drag_move':True,'copy_ui':True,'independent_edit':True,'delete_preserves_original':blob_size,'screenshot':str(screenshot)},ensure_ascii=False))

def check_failed_migration():
    with extension_session('pd-folder-failure-') as session:
        page = session.open_page('collector.html')
        page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        worker = session.context.service_workers[0]
        worker.evaluate("""() => {
          globalThis.originalSet = chrome.storage.local.set.bind(chrome.storage.local);
          chrome.storage.local.set = async payload => {
            if (payload.folderOwnershipBackup) throw new Error('模拟迁移空间不足');
            return originalSet(payload);
          };
        }""")
        entry=base_entry('original','旧案例','不能丢失','content:prompt:text')
        page.evaluate("""async entry=>chrome.storage.local.set({entries:[entry],organizerState:{version:7,collections:[
          {id:'p',name:'P',entryIds:['original']},{id:'q',name:'Q',entryIds:['original']}
        ]},compoundCases:[]})""",entry)
        result=page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert not result['ok'],result
        stored=page.evaluate("async()=>chrome.storage.local.get(['entries','organizerState','folderOwnershipBackup'])")
        assert len(stored['entries'])==1 and 'folderOwnershipBackup' not in stored,stored
        assert [c['entryIds'] for c in stored['organizerState']['collections']]==[['original'],['original']]
        worker.evaluate("() => {chrome.storage.local.set=originalSet}")
        result=page.evaluate("async()=>chrome.runtime.sendMessage({type:'GET_STATE'})")
        assert result['ok'] and len(result['entries'])==2,result
        print('迁移写入失败保持旧案例及两个位置；重试成功且只创建一份副本')

if __name__=='__main__':
    main()
    check_failed_migration()
