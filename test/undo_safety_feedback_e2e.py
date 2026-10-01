"""Undo must preserve later material, recoverability, and short-lived UI feedback."""
from __future__ import annotations
import json
import re
import tempfile
from pathlib import Path
from playwright.sync_api import expect
from e2e_support import base_entry, extension_session


def state(page):
    return page.evaluate("() => chrome.runtime.sendMessage({type:'GET_STATE'})")


def main():
    screenshots = []
    with extension_session('pd-undo-safety-', viewport={'width': 1440, 'height': 1000}) as run:
        setup = run.open_page('collector.html')
        first = base_entry('first', '原案例', '原词必须保留', 'content:prompt:image')
        later = base_entry('later', '后来采集', '后来新增原词', 'content:prompt:image')
        later['schemaVersion'] = 28
        run.seed_storage(setup, {'schemaVersion': 28, 'entries': [first]})
        page = run.context.new_page()
        page.clock.install()
        page.goto(f'chrome-extension://{run.extension_id}/library.html')
        expect(page.locator('body')).to_have_attribute('data-library-state', 'ready')
        page.locator('#manage-facets').click()
        page.locator('[data-manager-tab="vocabulary"]').click()
        page.locator('#new-node-name').fill('撤回验收标签')
        page.locator('#create-node-form button').click()
        expect(page.locator('#facet-recovery-actions')).to_have_attribute('open', '')
        expect(page.locator('#manager-feedback')).to_contain_text('已创建')
        assert not page.locator('#feedback').inner_text(), '标签管理反馈不能同时出现两次'
        page.mouse.move(1200, 800)
        page.locator('#new-node-name').focus()
        page.clock.fast_forward(31000)
        expect(page.locator('#facet-recovery-actions')).not_to_have_attribute('open', '')
        expect(page.locator('#manager-feedback')).to_be_hidden()
        page.locator('#facet-recovery-actions summary').click()
        # Add after the historical snapshot, then use the actual undo button.
        setup.evaluate("async entry => {const s=await chrome.storage.local.get('entries');await chrome.storage.local.set({entries:[...s.entries,entry]});}", later)
        page.locator('#undo-facet').click()
        expect(page.locator('#manager-feedback')).to_contain_text('已撤回')
        current = state(setup)
        assert {entry['id'] for entry in current['entries']} == {'first', 'later'}, current
        assert next(entry for entry in current['entries'] if entry['id']=='later')['text'] == later['text']
        # A repeated name produces a real validation error which expires cleanly.
        page.locator('#new-node-name').fill('重复标签')
        page.locator('#create-node-form button').click()
        expect(page.locator('#manager-feedback')).to_contain_text('已创建')
        page.locator('#new-node-name').fill('重复标签')
        page.locator('#create-node-form button').click()
        expect(page.locator('#manager-feedback')).to_have_class(re.compile(r'(?=.*\bmanager-feedback\b)(?=.*\berror\b)'))
        page.mouse.move(1200, 800)
        page.locator('#new-node-name').focus()
        page.clock.fast_forward(8100)
        expect(page.locator('#manager-feedback')).to_be_hidden()
        assert 'error' not in page.locator('#manager-feedback').get_attribute('class')
        # Closing and reopening must never bring a previous result or open undo back.
        page.locator('#manager-close').click()
        page.locator('#manage-facets').click()
        page.locator('[data-manager-tab="vocabulary"]').click()
        expect(page.locator('#facet-recovery-actions')).not_to_have_attribute('open', '')
        screenshot = Path(tempfile.gettempdir())/'pd-undo-tags.png'
        page.screenshot(path=str(screenshot))
        screenshots.append(str(screenshot))
        page.locator('#manager-close').click()
        # A previous exact recovery point remains reachable, initially folded.
        setup.evaluate("""async () => {
          const {createLibraryReplacementRecoveryPoint}=await import('./library-recovery-point.js');
          const saved=await chrome.runtime.sendMessage({type:'GET_FOLDER_BACKUP_STATE'});
          await chrome.storage.local.set({libraryReplacementRecoveryPoint:createLibraryReplacementRecoveryPoint(saved)});
        }""")
        page.locator('#open-settings').click()
        expect(page.locator('#library-recovery-actions')).to_be_visible()
        expect(page.locator('#restore-library-replacement-point')).to_be_hidden()
        page.locator('#library-recovery-actions summary').click()
        expect(page.locator('#restore-library-replacement-point')).to_be_visible()
        page.locator('#sync-settings summary').click()
        page.locator('#sync-now').is_visible()  # Inspect without connecting anything.
        page.locator('#settings-close').click()
        page.locator('#open-settings').click()
        expect(page.locator('#restore-library-replacement-point')).to_be_hidden()
        screenshot = Path(tempfile.gettempdir())/'pd-undo-settings.png'
        page.screenshot(path=str(screenshot))
        screenshots.append(str(screenshot))
        page.close()
        # Saving undo moves only its own unchanged case into recoverable trash.
        proof = setup.evaluate("""async () => {
          const media = await import('./media-store.js');
          const history = await import('./save-history.js');
          const s = await chrome.runtime.sendMessage({type:'GET_STATE'});
          const entry = {...structuredClone(s.entries[0]), id:'just-saved', title:'撤回保存',
            mediaAssets:[{id:'retained-media',kind:'image',storageMode:'managed',mimeType:'image/png'}],primaryMediaId:'retained-media'};
          await media.saveMediaBlob('retained-media', new Blob(['original-media'],{type:'image/png'}));
          await chrome.storage.local.set({entries:[...s.entries,entry],lastSaveUndo:history.createEntrySaveUndo(entry)});
          const undo = await chrome.runtime.sendMessage({type:'UNDO_LAST'});
          if (!undo.ok) throw new Error(undo.message);
          const after = await chrome.runtime.sendMessage({type:'GET_STATE'});
          const item = after.trashState.items.find(item=>item.targetId===entry.id);
          const restore = await chrome.runtime.sendMessage({type:'RESTORE_TRASH_ITEMS',itemIds:[item.id]});
          const blob = await media.getMediaBlob('retained-media');
          return {undo, remaining:after.entries.map(entry=>entry.id), item, restore, original:await blob.text()};
        }""")
        assert proof['undo']['ok'] and proof['remaining'] == ['first', 'later'], proof
        assert proof['restore']['ok'] and proof['original'] == 'original-media', proof
        # A later manual edit prevents saved-case undo; nothing is removed.
        conflict = setup.evaluate("""async () => {
          const {createEntrySaveUndo}=await import('./save-history.js');
          const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
          const entry=s.entries.find(entry=>entry.id==='just-saved');
          const undo=createEntrySaveUndo(entry);
          await chrome.storage.local.set({entries:s.entries.map(item=>item.id===entry.id?{...item,text:'用户后来编辑'}:item),lastSaveUndo:undo});
          const result=await chrome.runtime.sendMessage({type:'UNDO_LAST'});
          return {result,entries:(await chrome.runtime.sendMessage({type:'GET_STATE'})).entries};
        }""")
        assert not conflict['result']['ok'] and len(conflict['entries'])==3, conflict
        assert next(entry for entry in conflict['entries'] if entry['id']=='just-saved')['text']=='用户后来编辑'
        # Concurrent project movement must be rejected by the backend, not only UI.
        project = setup.evaluate("""async () => {
          const {collectionStructureSnapshot}=await import('./organizer.js');
          await chrome.storage.local.set({organizerState:{collections:[
            {id:'a',name:'A',parentId:null,order:0,entryIds:['first']},
            {id:'b',name:'B',parentId:null,order:1,entryIds:['later']}]}});
          const moved=await chrome.runtime.sendMessage({type:'MOVE_COLLECTION',collectionId:'a',parentId:'b',index:0});
          const expectedStructure=collectionStructureSnapshot(moved.organizerState);
          await chrome.runtime.sendMessage({type:'MOVE_COLLECTION',collectionId:'a',parentId:null,index:1});
          const before=await chrome.runtime.sendMessage({type:'GET_STATE'});
          const undo=await chrome.runtime.sendMessage({type:'MOVE_COLLECTION',collectionId:'a',parentId:null,index:0,undoing:true,expectedStructure});
          const after=await chrome.runtime.sendMessage({type:'GET_STATE'});
          return {undo,unchanged:JSON.stringify(before.organizerState)===JSON.stringify(after.organizerState),count:after.entries.length};
        }""")
        assert not project['undo']['ok'] and project['unchanged'] and project['count']==3, project
        # Stored batch snapshots must round-trip without mistaking key order for edits.
        batch = setup.evaluate("""async () => {
          const api=await import('./analysis-batch.js');
          const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
          const job=await api.createAnalysisBatchJob(s.entries.filter(entry=>entry.id==='first'),{id:'batch:undo-proof',mode:'missing',catalogRevision:s.facetCatalog.revision});
          const baseline=api.createAnalysisBatchUndo(job,s);
          const changed={...s,entries:s.entries.map(entry=>entry.id==='first'?{...entry,customLabels:['本批分析'],analysisPending:false,analyzedAt:'2026-10-01T00:00:00.000Z'}:entry)};
          const sealed=api.sealAnalysisBatchUndo(baseline,changed,['first']);
          job.status='completed';job.items=job.items.map(item=>({...item,status:'succeeded'}));job.resultCatalogRevision=s.facetCatalog.revision;
          await chrome.storage.local.set({entries:changed.entries,batchJob:job,analysisBatchUndo:sealed});
          return {before:s.entries.map(entry=>entry.id),later:s.entries.find(entry=>entry.id==='later')};
        }""")
        task_page=run.open_page('library.html')
        expect(task_page.locator('body')).to_have_attribute('data-library-state','ready')
        task_page.locator('#open-settings').click()
        task_page.locator('[data-settings-tab="tasks"]').click()
        expect(task_page.locator('#analysis-recovery-actions')).to_be_visible()
        expect(task_page.locator('#undo-analysis-batch')).to_be_hidden()
        task_page.locator('#analysis-recovery-actions summary').click()
        task_page.locator('#undo-analysis-batch').click()
        expect(task_page.locator('#feedback')).to_contain_text('已撤回本次批量分析')
        after_batch=state(setup)
        assert [entry['id'] for entry in after_batch['entries']]==batch['before']
        assert next(entry for entry in after_batch['entries'] if entry['id']=='later')==batch['later']
        assert next(entry for entry in after_batch['entries'] if entry['id']=='first')['customLabels']==[]
        task_page.close()
        image=setup.evaluate("""async () => {
          const {applyVisionAnalysis}=await import('./analysis-candidates.js');
          const {updateEntryVisual}=await import('./visuals.js');
          const s=await chrome.runtime.sendMessage({type:'GET_STATE'});
          const applied=applyVisionAnalysis(s,'just-saved',{reconstructionPrompt:'用于撤回验收的逆光人物画面',tags:[{g:'light.direction',t:'逆光'}]},
            {visualId:'retained-media',imageFingerprint:'undo-fixture',locale:'zh-CN',providerType:'openai',model:'fixture'});
          const entry=applied.state.entries.find(entry=>entry.id==='just-saved');
          const analysis=entry.visionAnalysis;delete entry.visionAnalysis;
          applied.state.entries=applied.state.entries.map(item=>item.id===entry.id?updateEntryVisual(entry,'retained-media',visual=>({...visual,visionAnalysis:analysis})):item);
          await chrome.storage.local.set({entries:applied.state.entries,facetCatalog:applied.state.facetCatalog,visionAnalysisUndo:{'just-saved':applied.undo}});
          const undo=await chrome.runtime.sendMessage({type:'UNDO_VISION_ANALYSIS',entryId:'just-saved'});
          const after=await chrome.runtime.sendMessage({type:'GET_STATE'});
          const blob=await (await import('./media-store.js')).getMediaBlob('retained-media');
          return {undo,ids:after.entries.map(entry=>entry.id),original:await blob.text(),entry:after.entries.find(entry=>entry.id==='just-saved')};
        }""")
        assert image['undo']['ok'] and len(image['ids'])==3 and image['original']=='original-media',image
        assert image['entry']['text']=='用户后来编辑',image
    print(json.dumps({'tagUndoRetainsLaterCase':True,'errorExpires':True,'recoveryRemainsReachable':True,
      'saveUndoTrashAndOriginalReadback':True,'laterEditRejected':True,'staleProjectUndoRejected':True,'batchUndoUiReadback':True,'imageUndoReadback':True,'screenshots':screenshots},ensure_ascii=False))

if __name__ == '__main__':
    main()
